/**
 * Generic Store Checkout Routes — Stagehand AI-powered checkout for any US store
 *
 * Uses the same Stagehand act()/extract() AI primitives as Amazon checkout,
 * but with generic prompts that work on any e-commerce site (Nike, Walmart, Target, etc.)
 *
 * Flow: navigate → add_to_cart → fill_shipping → fill_payment → screenshot → place_order
 *
 * SAFETY: NEVER places an order without explicit user confirmation via screenshot review.
 */

import type { FastifyInstance } from "fastify";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { createContext, getLiveUrl } from "../services/bb-context.service.js";
import path from "node:path";
import fs from "node:fs";

// Reuse active sessions map from bb-checkout (shared across routes)
const genericSessions = new Map<
  string,
  { stagehand: Stagehand; openedAt: number; store: string }
>();

// Auto-cleanup after 5 min (shorter than Amazon since we want tighter control)
const GENERIC_SESSION_TTL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of genericSessions) {
    if (now - sess.openedAt > GENERIC_SESSION_TTL) {
      console.log(`[CHECKOUT][TIMEOUT] Auto-closing stale generic session ${id.slice(0, 8)} (store: ${sess.store})`);
      try { sess.stagehand.close(); } catch { /* ignore */ }
      genericSessions.delete(id);
    }
  }
}, 30_000);

// Stagehand model config (same as bb-checkout)
const STAGEHAND_MODEL = process.env.OPENAI_API_KEY
  ? "openai/gpt-4o-mini"
  : process.env.ANTHROPIC_API_KEY
    ? "anthropic/claude-sonnet-4-5-20250929"
    : "google/gemini-2.5-flash";

// Screenshot storage
const SCREENSHOT_DIR = "/tmp/checkout-screenshots";
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });


type CheckoutShippingAddress = {
  fullName?: string;
  name?: string;
  address?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  postalCode?: string;
  phone?: string;
};

type CheckoutPaymentRef = {
  provider?: string;
  method?: string;
  payment_method_id?: string;
  wallet_reference?: string;
  handoff_required?: boolean;
  brand?: string | null;
  last4?: string | null;
};

type CheckoutMandates = {
  cart_mandate_id?: string | null;
  cart_mandate_hash?: string | null;
  payment_mandate_id?: string | null;
  payment_mandate_hash?: string | null;
};

function normalizeShipping(body: { shipping?: CheckoutShippingAddress; shippingAddress?: CheckoutShippingAddress }): CheckoutShippingAddress | null {
  const raw = body.shippingAddress || body.shipping;
  if (!raw) return null;
  return {
    fullName: raw.fullName || raw.name,
    address: raw.address || raw.address1,
    city: raw.city,
    state: raw.state,
    zip: raw.zip || raw.postalCode,
    phone: raw.phone,
  };
}

function normalizePayment(body: { payment?: CheckoutPaymentRef & { method?: string }; paymentMethod?: CheckoutPaymentRef }): CheckoutPaymentRef | null {
  const raw = body.paymentMethod || body.payment;
  if (!raw) return null;
  const provider = raw.provider || raw.method;
  return { ...raw, provider };
}

function handoffResponse(sessionId: string, obstacleType: string, message: string, details: Record<string, unknown> = {}) {
  return {
    success: false,
    error: obstacleType,
    code: obstacleType,
    needsHandoff: true,
    message,
    sessionId,
    ...details,
  };
}

async function detectCheckoutObstacle(page: any) {
  try {
    return await page.evaluate(() => {
      const body = (document.body?.innerText || '').toLowerCase();
      const url = window.location.href.toLowerCase();
      const hasSelector = (selector: string) => Boolean(document.querySelector(selector));

      if (
        hasSelector('iframe[src*="recaptcha"]') ||
        hasSelector('iframe[src*="hcaptcha"]') ||
        hasSelector('[class*="captcha" i]') ||
        hasSelector('[id*="captcha" i]') ||
        body.includes('captcha') ||
        body.includes('security check') ||
        body.includes('verify you are human')
      ) {
        return { blocked: true, code: 'NEEDS_CAPTCHA', message: 'Security challenge or CAPTCHA requires user handoff.' };
      }

      if (
        hasSelector('input[type="password"]') ||
        url.includes('/login') ||
        url.includes('/signin') ||
        url.includes('/sign-in') ||
        body.includes('sign in') ||
        body.includes('log in')
      ) {
        return { blocked: true, code: 'NEEDS_LOGIN', message: 'Merchant login is required.' };
      }

      if (
        body.includes('two-factor') ||
        body.includes('2fa') ||
        body.includes('multi-factor') ||
        body.includes('verification code') ||
        body.includes('one-time code') ||
        hasSelector('input[autocomplete="one-time-code"]')
      ) {
        return { blocked: true, code: 'NEEDS_2FA', message: 'Two-factor authentication is required.' };
      }

      if (
        hasSelector('input[name*="cvv" i]') ||
        hasSelector('input[id*="cvv" i]') ||
        hasSelector('input[name*="cvc" i]') ||
        hasSelector('input[id*="cvc" i]') ||
        body.includes('security code') ||
        body.includes('cvv') ||
        body.includes('cvc')
      ) {
        return { blocked: true, code: 'NEEDS_CVV', message: 'CVV/security code requires user handoff.' };
      }

      return { blocked: false };
    });
  } catch {
    return { blocked: false };
  }
}

function mandateSummary(mandates?: CheckoutMandates | null) {
  if (!mandates) return null;
  return {
    cart_mandate_id: mandates.cart_mandate_id || null,
    cart_mandate_hash: mandates.cart_mandate_hash || null,
    payment_mandate_id: mandates.payment_mandate_id || null,
    payment_mandate_hash: mandates.payment_mandate_hash || null,
  };
}

export async function genericCheckoutRoutes(app: FastifyInstance) {

  // ── POST /generic/start — Open session, navigate to product URL ──
  app.post("/generic/start", async (request, reply) => {
    const body = request.body as {
      productUrl: string;
      store: string;
      bbContextId?: string;
    };

    if (!body?.productUrl || !body?.store) {
      return reply.status(400).send({ success: false, error: "productUrl and store are required" });
    }

    const t0 = Date.now();
    const tag = `[CHECKOUT][1-START]`;

    try {
      // Create or reuse BB context
      let bbContextId = body.bbContextId;
      if (!bbContextId) {
        const ctx = await createContext();
        bbContextId = ctx.bbContextId;
        console.log(`${tag} Created new BB context: ${bbContextId.slice(0, 8)}`);
      }

      console.log(`${tag} store=${body.store}, url=${body.productUrl.slice(0, 80)}, contextId=${bbContextId.slice(0, 8)}`);

      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        model: STAGEHAND_MODEL,
        browserbaseSessionCreateParams: {
          browserSettings: {
            context: { id: bbContextId, persist: true },
          },
          timeout: 600, // 10 min max
        },
        verbose: 1,
      });

      await stagehand.init();
      const sessionId = stagehand.browserbaseSessionID!;
      const page = stagehand.context.pages()[0];

      console.log(`${tag} Session opened: ${sessionId.slice(0, 8)}, navigating...`);

      // Navigate to product URL
      await page.goto(body.productUrl, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
      const pageTitle = await page.title();
      console.log(`${tag} Navigated: title="${pageTitle}", took ${Date.now() - t0}ms`);

      // Extract product info from page
      const productInfo = await stagehand.extract(
        "Extract product information from this page: product name, price (as number), currency symbol, availability (in stock or not), and any size/color options visible.",
        z.object({
          productName: z.string().describe("Product name"),
          price: z.number().describe("Price as a number (e.g. 59.97)"),
          currency: z.string().describe("Currency symbol ($ or R$)"),
          inStock: z.boolean().describe("true if product is available for purchase"),
          hasOptions: z.boolean().describe("true if size/color selection is needed before adding to cart"),
          optionsDescription: z.string().optional().describe("What options need to be selected (e.g. 'Size: select from 7-13')"),
        }),
      );

      console.log(`${tag} Product: ${productInfo.productName}, $${productInfo.price}, inStock=${productInfo.inStock}`);

      if (!productInfo.inStock) {
        await stagehand.close();
        return { success: false, error: "Product is out of stock", productInfo };
      }

      // Store session for later steps
      genericSessions.set(sessionId, {
        stagehand,
        openedAt: Date.now(),
        store: body.store,
      });

      // Get live view URL
      let liveUrl: string;
      try {
        liveUrl = await getLiveUrl(sessionId);
      } catch {
        liveUrl = `https://www.browserbase.com/sessions/${sessionId}/live-view`;
      }

      return {
        success: true,
        bbSessionId: sessionId,
        bbContextId,
        liveUrl,
        productInfo,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start generic checkout";
      console.error(`${tag} ERROR — ${message}`);
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── POST /generic/add-to-cart — AI-driven "Add to Cart" on any store ──
  app.post("/generic/add-to-cart", async (request, reply) => {
    const body = request.body as {
      bbSessionId: string;
      size?: string;
      color?: string;
      quantity?: number;
    };

    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    const tag = `[CHECKOUT][2-CART]`;
    const t0 = Date.now();
    const sess = genericSessions.get(body.bbSessionId);

    if (!sess) {
      return reply.status(404).send({ success: false, error: "Session not found or expired" });
    }

    try {
      const { stagehand } = sess;
      const page = stagehand.context.pages()[0];

      console.log(`${tag} store=${sess.store}, session=${body.bbSessionId.slice(0, 8)}`);

      // Select size if provided
      if (body.size) {
        console.log(`${tag} Selecting size: ${body.size}`);
        await stagehand.act(`Select size "${body.size}" from the size options`);
        await page.waitForTimeout(1500);
      }

      // Select color if provided
      if (body.color) {
        console.log(`${tag} Selecting color: ${body.color}`);
        await stagehand.act(`Select color "${body.color}" from the color options`);
        await page.waitForTimeout(1500);
      }

      // Set quantity if > 1
      if (body.quantity && body.quantity > 1) {
        try {
          await stagehand.act(`Set quantity to ${body.quantity}`);
          await page.waitForTimeout(1000);
        } catch { /* quantity selector may not exist */ }
      }

      // Click "Add to Cart" / "Add to Bag" using AI
      console.log(`${tag} Clicking add to cart...`);
      await stagehand.act(
        "Click the button to add this product to the shopping cart or bag. " +
        "Look for buttons labeled 'Add to Cart', 'Add to Bag', 'Buy Now', or similar. " +
        "If there's a popup asking about warranties or extras, click 'No thanks' or 'Skip'."
      );

      await page.waitForTimeout(3000);

      // Verify item was added
      const cartStatus = await stagehand.extract(
        "Check if the item was successfully added to the cart/bag. Look for confirmation messages like 'Added to Cart', 'Added to Bag', a cart icon with updated count, or a 'Proceed to Checkout' / 'View Cart' button. Also check for any error messages.",
        z.object({
          added: z.boolean().describe("true if item appears to be in the cart"),
          cartMessage: z.string().optional().describe("Confirmation or error message"),
          cartTotal: z.string().optional().describe("Cart total if visible"),
        }),
      );

      console.log(`${tag} Result: added=${cartStatus.added}, msg=${cartStatus.cartMessage}, took ${Date.now() - t0}ms`);

      if (!cartStatus.added) {
        return { success: false, error: cartStatus.cartMessage || "Could not confirm item was added to cart" };
      }

      return { success: true, data: cartStatus };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Add to cart failed";
      console.error(`${tag} ERROR — ${message}`);
      return { success: false, error: message };
    }
  });

  // ── POST /generic/checkout — Navigate to checkout page, optionally fill shipping/payment ──
  app.post("/generic/checkout", async (request, reply) => {
    const body = request.body as {
      bbSessionId: string;
      shipping?: CheckoutShippingAddress;
      shippingAddress?: CheckoutShippingAddress;
      payment?: CheckoutPaymentRef & { method?: string; cardNumber?: string; expiry?: string; cvv?: string };
      paymentMethod?: CheckoutPaymentRef;
      mandates?: CheckoutMandates;
      email?: string;
    };

    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    const tag = `[CHECKOUT][3-SHIPPING]`;
    const t0 = Date.now();
    const sess = genericSessions.get(body.bbSessionId);

    if (!sess) {
      return reply.status(404).send({ success: false, error: "Session not found or expired" });
    }

    try {
      const { stagehand } = sess;
      const page = stagehand.context.pages()[0];
      const shipping = normalizeShipping(body);
      const paymentRef = normalizePayment(body);

      console.log(`${tag} store=${sess.store}, session=${body.bbSessionId.slice(0, 8)}, mandates=${JSON.stringify(mandateSummary(body.mandates))}`);

      // Navigate to checkout
      console.log(`${tag} Navigating to checkout...`);
      try {
        await stagehand.act(
          "Navigate to the checkout page. Click 'Checkout', 'Proceed to Checkout', 'View Cart' then 'Checkout', or similar. " +
          "If you see a cart sidebar or popup, look for the checkout button there."
        );
      } catch {
        // Some stores have direct checkout URLs
        console.log(`${tag} Direct checkout click failed, trying cart page...`);
        await stagehand.act("Click on the shopping cart icon or 'View Cart' link");
        await page.waitForTimeout(2000);
        await stagehand.act("Click the 'Checkout' or 'Proceed to Checkout' button");
      }

      await page.waitForTimeout(3000);

      const initialObstacle = await detectCheckoutObstacle(page);
      if (initialObstacle.blocked && initialObstacle.code !== 'NEEDS_LOGIN') {
        return handoffResponse(body.bbSessionId, initialObstacle.code, initialObstacle.message, { currentUrl: page.url() });
      }

      // Check if we need to sign in (guest checkout option)
      const pageState = await stagehand.extract(
        "What is on this page? Check for: (1) a login/sign-in form, (2) a 'Guest Checkout' or 'Continue as Guest' option, (3) a shipping address form, (4) a payment form, (5) an order review page.",
        z.object({
          needsLogin: z.boolean().describe("true if the page requires login"),
          hasGuestOption: z.boolean().describe("true if there's a guest checkout option"),
          hasShippingForm: z.boolean().describe("true if shipping address form is visible"),
          hasPaymentForm: z.boolean().describe("true if payment form is visible"),
          isOrderReview: z.boolean().describe("true if this is the final order review page"),
          pageDescription: z.string().describe("Brief description of what's on the page"),
        }),
      );

      console.log(`${tag} Page state: ${JSON.stringify(pageState)}`);

      // Handle guest checkout
      if (pageState.needsLogin && pageState.hasGuestOption) {
        console.log(`${tag} Selecting guest checkout...`);
        await stagehand.act("Click 'Guest Checkout', 'Continue as Guest', or 'Checkout without account' button");
        await page.waitForTimeout(2000);
      } else if (pageState.needsLogin && !pageState.hasGuestOption) {
        return handoffResponse(body.bbSessionId, "NEEDS_LOGIN", "This store requires account login before checkout.", { currentUrl: page.url() });
      }

      // Fill email if needed
      if (body.email) {
        try {
          console.log(`${tag} Filling email...`);
          await stagehand.act(`Type "${body.email}" into the email address field`);
          await page.waitForTimeout(1000);
        } catch { /* email might already be filled or not needed */ }
      }

      // Fill shipping address if provided
      if (shipping) {
        const s = shipping;
        console.log(`[CHECKOUT][3-SHIPPING] Filling shipping: ${s.fullName}, ${s.city} ${s.state}`);

        const shippingInstructions = [
          s.fullName ? `Type "${s.fullName}" into the full name or first name + last name fields` : null,
          s.address ? `Type "${s.address}" into the street address field` : null,
          s.city ? `Type "${s.city}" into the city field` : null,
          s.state ? `Select or type "${s.state}" for the state field` : null,
          s.zip ? `Type "${s.zip}" into the ZIP code or postal code field` : null,
        ].filter(Boolean) as string[];
        if (s.phone) {
          shippingInstructions.push(`Type "${s.phone}" into the phone number field`);
        }

        for (const instruction of shippingInstructions) {
          try {
            await stagehand.act(instruction);
            await page.waitForTimeout(500);
          } catch (e) {
            console.log(`${tag} Shipping field skip: ${(e as Error).message.slice(0, 60)}`);
          }
        }

        // Click continue/next after shipping
        try {
          await stagehand.act("Click the 'Continue', 'Next', 'Continue to Payment', or 'Save Address' button");
          await page.waitForTimeout(3000);
        } catch { /* might auto-advance */ }
      }

      const prePaymentObstacle = await detectCheckoutObstacle(page);
      if (prePaymentObstacle.blocked) {
        return handoffResponse(body.bbSessionId, prePaymentObstacle.code, prePaymentObstacle.message, { currentUrl: page.url() });
      }

      if (paymentRef?.handoff_required || paymentRef?.provider === 'manual_handoff') {
        return handoffResponse(body.bbSessionId, 'NEEDS_PAYMENT_HANDOFF', 'Payment method requires user handoff before final checkout.', { currentUrl: page.url(), mandates: mandateSummary(body.mandates) });
      }

      // Raw card entry is intentionally refused. Use a tokenized wallet/payment method or handoff.
      if (body.payment?.method === "card" && body.payment.cardNumber) {
        return handoffResponse(body.bbSessionId, 'RAW_CARD_REFUSED', 'Raw card entry is not allowed. Use a tokenized wallet/payment method or handoff.', { currentUrl: page.url() });
      }

      // If PayPal selected, click PayPal button
      if (paymentRef?.provider === "paypal") {
        const tagPay = `[CHECKOUT][4-PAYMENT]`;
        console.log(`${tagPay} Selecting PayPal...`);
        try {
          await stagehand.act("Click the PayPal payment option or PayPal button");
          await page.waitForTimeout(3000);
        } catch (e) {
          console.log(`${tagPay} PayPal selection failed: ${(e as Error).message.slice(0, 60)}`);
        }
      }

      console.log(`${tag} Checkout navigation completed in ${Date.now() - t0}ms`);

      const finalObstacle = await detectCheckoutObstacle(page);
      if (finalObstacle.blocked) {
        return handoffResponse(body.bbSessionId, finalObstacle.code, finalObstacle.message, { currentUrl: page.url() });
      }

      return { success: true, pageState, mandates: mandateSummary(body.mandates), currentUrl: page.url() };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout navigation failed";
      console.error(`${tag} ERROR — ${message}`);
      return { success: false, error: message };
    }
  });

  // ── POST /generic/screenshot — Take screenshot of checkout page for user confirmation ──
  app.post("/generic/screenshot", async (request, reply) => {
    const body = request.body as { bbSessionId: string };

    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    const tag = `[CHECKOUT][5-REVIEW]`;
    const t0 = Date.now();
    const sess = genericSessions.get(body.bbSessionId);

    if (!sess) {
      return reply.status(404).send({ success: false, error: "Session not found or expired" });
    }

    try {
      const { stagehand } = sess;
      const page = stagehand.context.pages()[0];

      console.log(`${tag} Taking screenshot for confirmation, session=${body.bbSessionId.slice(0, 8)}`);

      // Extract order summary from page
      const summary = await stagehand.extract(
        "Extract the order summary from this checkout page. Get: product name, quantity, unit price, shipping cost, tax, total price, shipping address, payment method, and estimated delivery.",
        z.object({
          productName: z.string().describe("Product name"),
          quantity: z.number().optional().describe("Quantity"),
          unitPrice: z.number().optional().describe("Unit price as number"),
          shipping: z.string().optional().describe("Shipping cost or 'Free'"),
          tax: z.string().optional().describe("Tax amount"),
          total: z.number().describe("Order total as number"),
          totalDisplay: z.string().describe("Total as displayed (e.g. '$64.47')"),
          shippingAddress: z.string().optional().describe("Shipping address"),
          paymentMethod: z.string().optional().describe("Payment method"),
          estimatedDelivery: z.string().optional().describe("Estimated delivery date"),
        }),
      );

      // Take screenshot
      const screenshotId = `checkout-${body.bbSessionId.slice(0, 8)}-${Date.now()}`;
      const screenshotPath = path.join(SCREENSHOT_DIR, `${screenshotId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      console.log(`${tag} Screenshot saved: ${screenshotPath}, summary: $${summary.total}, took ${Date.now() - t0}ms`);

      return {
        success: true,
        summary,
        screenshotPath,
        screenshotId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Screenshot failed";
      console.error(`${tag} ERROR — ${message}`);
      return { success: false, error: message };
    }
  });

  // ── POST /generic/place-order — Click the final "Place Order" button ──
  // SAFETY: Only call after user explicitly confirms via screenshot review
  app.post("/generic/place-order", async (request, reply) => {
    const body = request.body as {
      bbSessionId: string;
      expectedTotal: number; // Price the user confirmed — must match within 10%
      shippingAddress?: CheckoutShippingAddress;
      paymentMethod?: CheckoutPaymentRef;
      mandates?: CheckoutMandates;
    };

    if (!body?.bbSessionId || body.expectedTotal == null) {
      return reply.status(400).send({ success: false, error: "bbSessionId and expectedTotal required" });
    }

    const tag = `[CHECKOUT][6-CONFIRM]`;
    const t0 = Date.now();
    const sess = genericSessions.get(body.bbSessionId);

    if (!sess) {
      return reply.status(404).send({ success: false, error: "Session not found or expired" });
    }

    try {
      const { stagehand } = sess;
      const page = stagehand.context.pages()[0];

      console.log(`${tag} Placing order, store=${sess.store}, expectedTotal=$${body.expectedTotal}, session=${body.bbSessionId.slice(0, 8)}, mandates=${JSON.stringify(mandateSummary(body.mandates))}`);

      const paymentRef = normalizePayment({ paymentMethod: body.paymentMethod });
      if (paymentRef?.handoff_required || paymentRef?.provider === 'manual_handoff') {
        return handoffResponse(body.bbSessionId, 'NEEDS_PAYMENT_HANDOFF', 'Payment method requires user handoff before placing the order.', { currentUrl: page.url(), mandates: mandateSummary(body.mandates) });
      }

      const obstacle = await detectCheckoutObstacle(page);
      if (obstacle.blocked) {
        return handoffResponse(body.bbSessionId, obstacle.code, obstacle.message, { currentUrl: page.url(), mandates: mandateSummary(body.mandates) });
      }

      // Extract current total from page to verify
      const priceCheck = await stagehand.extract(
        "Extract the order total from this page.",
        z.object({
          total: z.number().describe("Order total as a number"),
        }),
      );

      // Price divergence check (>10% = abort)
      const priceDiff = Math.abs(priceCheck.total - body.expectedTotal) / body.expectedTotal;
      if (priceDiff > 0.10) {
        console.log(`${tag} PRICE DIVERGENCE: expected=$${body.expectedTotal}, actual=$${priceCheck.total}, diff=${(priceDiff * 100).toFixed(1)}%`);
        return {
          success: false,
          error: "PRICE_CHANGED",
          message: `Price changed from $${body.expectedTotal.toFixed(2)} to $${priceCheck.total.toFixed(2)} (${(priceDiff * 100).toFixed(0)}% difference). Aborting for safety.`,
          expectedTotal: body.expectedTotal,
          actualTotal: priceCheck.total,
        };
      }

      // Click "Place Order" / "Submit Order" / "Complete Purchase"
      console.log(`${tag} Price verified ($${priceCheck.total}), clicking place order...`);
      await stagehand.act(
        "Click the final button to place/submit the order. " +
        "Look for 'Place Order', 'Submit Order', 'Complete Purchase', 'Place Your Order', 'Buy Now', or similar. " +
        "This is the FINAL confirmation button that completes the purchase."
      );

      // Wait for confirmation
      await page.waitForTimeout(5000);

      // Extract order confirmation
      const tagComplete = `[CHECKOUT][7-COMPLETE]`;
      const confirmation = await stagehand.extract(
        "Check if the order was placed successfully. Look for 'Thank you', 'Order confirmed', 'Order placed', an order/confirmation number, estimated delivery date. If this is NOT a confirmation page, set confirmed to false.",
        z.object({
          confirmed: z.boolean().describe("true if order was placed successfully"),
          orderNumber: z.string().optional().describe("Order or confirmation number"),
          estimatedDelivery: z.string().optional().describe("Estimated delivery date"),
          total: z.string().optional().describe("Order total as displayed"),
          confirmationMessage: z.string().optional().describe("Confirmation message from the store"),
        }),
      );

      // Take confirmation screenshot + evidence package (Sniffer #4)
      const confirmScreenshotId = `confirm-${body.bbSessionId.slice(0, 8)}-${Date.now()}`;
      const confirmPath = path.join(SCREENSHOT_DIR, `${confirmScreenshotId}.png`);
      let screenshotBase64: string | undefined;
      try {
        await page.screenshot({ path: confirmPath, fullPage: false });
        // Captura também base64 pro brain validar diretamente (não depender de disco compartilhado)
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;
      } catch { /* non-blocking */ }

      // Extract page text snippet — prova textual da página de confirmação
      let pageTextSnippet: string | undefined;
      let pageUrl: string | undefined;
      try {
        pageUrl = page.url();
        pageTextSnippet = await page.evaluate(() =>
          (document.body?.innerText || "").slice(0, 500).trim()
        );
      } catch { /* non-blocking */ }

      console.log(`${tagComplete} confirmed=${confirmation.confirmed}, order=${confirmation.orderNumber}, total=${confirmation.total}, took ${Date.now() - t0}ms`);

      // Close session
      try { await stagehand.close(); } catch { /* ignore */ }
      genericSessions.delete(body.bbSessionId);

      if (confirmation.confirmed) {
        // Markers verificáveis pelo VPC hard-gate (sniffer brain)
        const confirmedAt = new Date().toISOString();
        const markers = {
          hasOrderNumber: !!confirmation.orderNumber,
          hasThankYouText: /thank\s*you|order\s*(confirmed|placed|received)|pedido\s*(confirmado|realizado|recebido)/i
            .test(`${confirmation.confirmationMessage || ""} ${pageTextSnippet || ""}`),
          hasEstimatedDelivery: !!confirmation.estimatedDelivery,
          hasTotalDisplayed: !!confirmation.total,
          hasScreenshot: !!screenshotBase64,
          hasPageUrl: !!pageUrl,
        };
        return {
          success: true,
          data: {
            confirmed: true,
            orderNumber: confirmation.orderNumber,
            orderId: confirmation.orderNumber,
            merchant_order_id: confirmation.orderNumber,
            estimatedDelivery: confirmation.estimatedDelivery,
            total: confirmation.total,
            confirmationMessage: confirmation.confirmationMessage,
            confirmScreenshotPath: confirmPath,
            // Evidence package — consumido pelo sniffer brain VPC hard-gate (Item #4)
            evidence: {
              pageUrl,
              confirmedAt,
              pageTextSnippet,
              screenshotBase64,
              markers,
              mandates: mandateSummary(body.mandates),
            },
          },
        };
      }

      // Check for errors
      const errorInfo = await stagehand.extract(
        "Check for error messages on this page — payment declined, address issues, out of stock, etc.",
        z.object({
          hasError: z.boolean(),
          errorMessage: z.string().optional(),
        }),
      );

      return {
        success: false,
        error: errorInfo.errorMessage || "Order confirmation not detected. Check the store website.",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Place order failed";
      console.error(`${tag} ERROR — ${message}`);
      // Don't delete session on error — user might retry
      return { success: false, error: message };
    }
  });

  // ── POST /generic/cancel — Close session without placing order ──
  app.post("/generic/cancel", async (request, reply) => {
    const body = request.body as { bbSessionId: string };

    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    const sess = genericSessions.get(body.bbSessionId);
    if (sess) {
      console.log(`[CHECKOUT][CANCEL] Closing session ${body.bbSessionId.slice(0, 8)} (store: ${sess.store})`);
      try { await sess.stagehand.close(); } catch { /* ignore */ }
      genericSessions.delete(body.bbSessionId);
    }

    return { success: true, message: "Checkout cancelled" };
  });

  // ── GET /generic/screenshot/:id — Serve screenshot image ──
  app.get("/generic/screenshot/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = path.join(SCREENSHOT_DIR, `${id}.png`);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: "Screenshot not found" });
    }

    const buffer = fs.readFileSync(filePath);
    return reply.type("image/png").send(buffer);
  });
}
