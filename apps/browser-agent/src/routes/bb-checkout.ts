/**
 * BrowserBase Checkout Routes — Persistent session checkout actions
 * WITH human behavior simulation (anti-bot detection)
 *
 * POST /bb/create-context   — Create a new BrowserBase Context
 * POST /bb/open-session     — Open session with context, navigate, check login
 * POST /bb/action           — Perform checkout action (add_to_cart, proceed_to_checkout, place_order)
 * POST /bb/close-session    — Release session
 */

import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  createContext,
  openSession as bbOpenSession,
  closeSession as bbCloseSession,
  checkLoginStatus,
} from "../services/bb-context.service.js";
import {
  setupHumanBehavior,
  humanClick,
  humanNavigate,
  humanScroll,
  humanReadPage,
  humanWait,
  humanMouseMove,
  preActionJitter,
} from "../services/human-simulator.js";

// Active Playwright connections (bbSessionId → { browser, page })
const activeSessions = new Map<
  string,
  { browser: Browser; page: Page; openedAt: number }
>();

// Auto-cleanup sessions after 10 min
const SESSION_TTL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of activeSessions) {
    if (now - sess.openedAt > SESSION_TTL) {
      console.log(`[bb-checkout] Auto-closing stale session ${id.slice(0, 8)}`);
      try { sess.browser.close(); } catch { /* ignore */ }
      activeSessions.delete(id);
    }
  }
}, 60_000);

export async function bbCheckoutRoutes(app: FastifyInstance) {
  // ── POST /bb/create-context ───────────────────────
  app.post("/bb/create-context", async (_request, reply) => {
    try {
      const result = await createContext();
      return { success: true, bbContextId: result.bbContextId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create context";
      app.log.error(err, "[bb-checkout] create-context error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── POST /bb/open-session ─────────────────────────
  app.post("/bb/open-session", async (request, reply) => {
    const body = request.body as {
      bbContextId?: string;
      storeUrl?: string;
      purpose?: string;
    };

    if (!body?.bbContextId || !body?.storeUrl) {
      return reply.status(400).send({
        success: false,
        error: "bbContextId and storeUrl are required",
      });
    }

    try {
      const result = await bbOpenSession(
        body.bbContextId,
        body.storeUrl,
        body.purpose,
      );

      // Apply human stealth setup to new page
      await setupHumanBehavior(result.page);

      // Check login status
      const loginCheck = await checkLoginStatus(result.page, "amazon");

      // Store the connection for subsequent actions
      activeSessions.set(result.bbSessionId, {
        browser: result.browser,
        page: result.page,
        openedAt: Date.now(),
      });

      return {
        success: true,
        bbSessionId: result.bbSessionId,
        liveUrl: result.liveUrl,
        loggedIn: loginCheck.loggedIn,
        userName: loginCheck.userName,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open session";
      app.log.error(err, "[bb-checkout] open-session error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── POST /bb/action ───────────────────────────────
  app.post("/bb/action", async (request, reply) => {
    const body = request.body as {
      bbSessionId?: string;
      action?: string;
      asin?: string;
      quantity?: number;
    };

    if (!body?.bbSessionId || !body?.action) {
      return reply.status(400).send({
        success: false,
        error: "bbSessionId and action are required",
      });
    }

    const sess = activeSessions.get(body.bbSessionId);
    if (!sess) {
      return reply.status(404).send({
        success: false,
        error: "Session not found. It may have expired.",
      });
    }

    const { page } = sess;

    try {
      switch (body.action) {
        case "add_to_cart":
          return await addToCart(page, body.asin!, body.quantity ?? 1);

        case "proceed_to_checkout":
          return await proceedToCheckout(page);

        case "place_order":
          return await placeOrder(page);

        default:
          return reply.status(400).send({
            success: false,
            error: `Unknown action: ${body.action}`,
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      app.log.error(err, `[bb-checkout] action ${body.action} error`);
      return { success: false, error: message };
    }
  });

  // ── POST /bb/close-session ────────────────────────
  app.post("/bb/close-session", async (request, reply) => {
    const body = request.body as { bbSessionId?: string };
    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    const sess = activeSessions.get(body.bbSessionId);
    if (sess) {
      try {
        await bbCloseSession(body.bbSessionId, sess.browser);
      } catch { /* ignore */ }
      activeSessions.delete(body.bbSessionId);
    }

    return { success: true };
  });
}

// ═══════════════════════════════════════════════════════
// CHECKOUT ACTIONS (Playwright + Human Simulation)
// ═══════════════════════════════════════════════════════

async function addToCart(
  page: Page,
  asin: string,
  quantity: number,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const t0 = Date.now();
  console.log(`[bb-checkout] addToCart asin=${asin} qty=${quantity}`);

  try {
    // Navigate to product page if not already there
    const currentUrl = page.url();
    if (!currentUrl.includes(`/dp/${asin}`)) {
      await humanNavigate(page, `https://www.amazon.com/dp/${asin}`);
    }

    // Simulate reading the product page
    await humanReadPage(page);

    // Scroll down to see the Add to Cart area
    await humanScroll(page, "down", 300);
    await humanWait(400, 1000);

    // Wait for add to cart button
    const addBtnSelector =
      '#add-to-cart-button, #add-to-cart-button-ubb, input[name="submit.add-to-cart"]';
    const addBtn = await page.waitForSelector(addBtnSelector, { timeout: 10_000 }).catch(() => null);

    if (!addBtn) {
      const outOfStock = await page.$('#outOfStock, .a-color-unavailable');
      if (outOfStock) {
        return { success: false, error: "Product is out of stock" };
      }
      return { success: false, error: "Add to Cart button not found" };
    }

    // Set quantity if > 1
    if (quantity > 1) {
      const qtySelector = await page.$('#quantity');
      if (qtySelector) {
        await preActionJitter(page);
        await qtySelector.selectOption(String(quantity));
        await humanWait(400, 900);
      }
    }

    // Human-like click on Add to Cart
    await preActionJitter(page);
    const clicked = await humanClick(
      page,
      '#add-to-cart-button, #add-to-cart-button-ubb, input[name="submit.add-to-cart"]',
    );
    if (!clicked) {
      // Fallback: direct click
      await addBtn.click();
    }

    // Wait for cart confirmation (human-like variable wait)
    await humanWait(1500, 3500);

    await page.waitForSelector(
      '#sw-atc-details-single-container, #huc-v2-order-row-confirm-text, #NATC_SMART_WAGON_CONF_MSG_SUCCESS, .a-size-medium-plus',
      { timeout: 10_000 },
    ).catch(() => null);

    // Brief read of confirmation
    await humanWait(500, 1200);

    // Verify item was added
    const cartText = await page.textContent('body') ?? '';
    const added =
      cartText.includes('Added to Cart') ||
      cartText.includes('Subtotal') ||
      cartText.includes('added to your cart') ||
      cartText.includes('Cart subtotal');

    console.log(`[bb-checkout] addToCart completed in ${Date.now() - t0}ms — added=${added}`);

    if (!added) {
      return { success: false, error: "Could not confirm item was added to cart" };
    }

    return { success: true, data: { added: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Add to cart failed";
    console.error(`[bb-checkout] addToCart FAILED in ${Date.now() - t0}ms — ${message}`);
    return { success: false, error: message };
  }
}

async function proceedToCheckout(
  page: Page,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const t0 = Date.now();
  console.log("[bb-checkout] proceedToCheckout");

  try {
    const proceedSelector =
      '#sc-buy-box-ptc-button input, a[name="proceedToRetailCheckout"], #hlb-ptc-btn-native, #sc-buy-box-ptc-button a, input[name="proceedToRetailCheckout"]';
    const proceedBtn = await page.$(proceedSelector);

    if (proceedBtn) {
      await preActionJitter(page);
      const clicked = await humanClick(page, proceedSelector);
      if (!clicked) {
        await proceedBtn.click();
      }
    } else {
      await humanNavigate(
        page,
        "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1",
      );
    }

    // Human-like wait for checkout page load
    await humanWait(2000, 4500);

    // Check if we're on checkout page
    const url = page.url();
    const isCheckout =
      url.includes("/buy/") ||
      url.includes("/checkout/") ||
      url.includes("spc/handlers");

    if (!isCheckout) {
      if (url.includes("/ap/signin") || url.includes("/ap/cvf")) {
        return { success: false, error: "Amazon requires re-authentication at checkout" };
      }
      return { success: false, error: "Could not reach checkout page" };
    }

    // Simulate reading the checkout summary
    await humanReadPage(page);
    await humanScroll(page, "down", 200);
    await humanWait(500, 1500);

    // Extract checkout summary
    const summary = await page.evaluate(() => {
      const getText = (selectors: string[]): string => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return "";
      };

      const address = getText([
        ".displayAddressDiv",
        ".ship-to-this-address",
        "#address-book-entry-0 .displayAddressLI",
        ".shipping-address",
      ]);

      const payment = getText([
        ".pmts-instrument-description",
        ".payment-info",
        ".pmts-account-radio-button",
      ]);

      const delivery = getText([
        ".delivery-option .a-text-bold",
        ".ship-option .a-text-bold",
        "#delivery-message",
        ".arrival-date",
      ]);

      const total = getText([
        ".grand-total-price",
        "#subtotals-marketplace-table .a-color-price",
        ".order-summary-line-item-amount",
      ]);

      const items: string[] = [];
      document
        .querySelectorAll(
          ".item-title, .sc-product-title, .shipping-group-item-title",
        )
        .forEach((el) => {
          const text = el.textContent?.trim();
          if (text && text.length > 3) items.push(text.substring(0, 120));
        });

      return { address, payment, delivery, total, items };
    });

    const priceMatch = summary.total?.match(/[\d,]+\.\d{2}/);
    const price = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, "")) : undefined;

    console.log(`[bb-checkout] proceedToCheckout completed in ${Date.now() - t0}ms`);

    return {
      success: true,
      data: {
        summary: {
          title: summary.items[0] ?? "Amazon Order",
          price,
          address: summary.address || undefined,
          paymentMethod: summary.payment || undefined,
          estimatedDelivery: summary.delivery || undefined,
          total: summary.total || undefined,
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout navigation failed";
    console.error(`[bb-checkout] proceedToCheckout FAILED in ${Date.now() - t0}ms — ${message}`);
    return { success: false, error: message };
  }
}

async function placeOrder(
  page: Page,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const t0 = Date.now();
  console.log("[bb-checkout] placeOrder");

  try {
    // Check we're on checkout page
    const url = page.url();
    if (!url.includes("/buy/") && !url.includes("/checkout/") && !url.includes("spc/handlers")) {
      await humanNavigate(
        page,
        "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1",
      );
      await humanWait(1500, 3000);
    }

    // Simulate reviewing the order one last time
    await humanReadPage(page);
    await humanScroll(page, "down", 150);
    await humanWait(800, 2000);

    // Find "Place your order" button
    const placeSelector =
      '#submitOrderButtonId input, #placeYourOrder input, input[name="placeYourOrder1"], #bottomSubmitOrderButtonId input, .place-your-order-button';
    const placeBtn = await page.$(placeSelector);

    if (!placeBtn) {
      return { success: false, error: "Place your order button not found" };
    }

    // Human-like final click — with deliberate pause (this is a big decision)
    await preActionJitter(page);
    await humanWait(500, 1500);
    const clicked = await humanClick(page, placeSelector);
    if (!clicked) {
      await placeBtn.click();
    }

    // Wait for confirmation (longer human wait — watching the spinner)
    await humanWait(4000, 7000);

    // Wait for confirmation page
    await page.waitForSelector(
      '.a-box.a-alert-success, #thank-you-page, .a-alert-success, [data-testid="order-confirmation"]',
      { timeout: 15_000 },
    ).catch(() => null);

    // Read the confirmation page
    await humanWait(1000, 2500);

    // Extract confirmation details
    const confirmation = await page.evaluate(() => {
      const body = document.body?.textContent ?? "";

      const orderMatch = body.match(
        /(?:order|pedido)\s*(?:#|number|número)?\s*[:.]?\s*(\d{3}-\d{7}-\d{7})/i,
      );

      const deliveryMatch = body.match(
        /(?:delivery|entrega|arriving)\s*(?:by|:)?\s*([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i,
      );

      const totalMatch = body.match(
        /(?:order total|total do pedido|grand total)[:\s]*\$?([\d,]+\.\d{2})/i,
      );

      const confirmed =
        body.includes("Thank you") ||
        body.includes("order has been placed") ||
        body.includes("Obrigado") ||
        !!orderMatch;

      return {
        confirmed,
        amazonOrderId: orderMatch?.[1] ?? null,
        estimatedDelivery: deliveryMatch?.[1] ?? null,
        total: totalMatch ? `$${totalMatch[1]}` : null,
        url: window.location.href,
      };
    });

    console.log(
      `[bb-checkout] placeOrder completed in ${Date.now() - t0}ms — confirmed=${confirmation.confirmed}, orderId=${confirmation.amazonOrderId}`,
    );

    if (confirmation.confirmed) {
      return {
        success: true,
        data: {
          confirmed: true,
          amazonOrderId: confirmation.amazonOrderId,
          estimatedDelivery: confirmation.estimatedDelivery,
          total: confirmation.total,
        },
      };
    }

    const errorText = await page.evaluate(() => {
      const alerts = document.querySelectorAll(".a-alert-content, .a-color-error");
      const texts: string[] = [];
      alerts.forEach((el) => {
        const t = el.textContent?.trim();
        if (t && t.length > 5) texts.push(t.substring(0, 200));
      });
      return texts.join(" | ");
    });

    return {
      success: false,
      error: errorText || "Order confirmation not detected. Check your Amazon account.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Place order failed";
    console.error(`[bb-checkout] placeOrder FAILED in ${Date.now() - t0}ms — ${message}`);
    return { success: false, error: message };
  }
}
