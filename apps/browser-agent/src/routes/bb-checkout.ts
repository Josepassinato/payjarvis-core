/**
 * BrowserBase Checkout Routes — Stagehand AI-powered checkout
 *
 * Stagehand replaces raw Playwright selectors with AI-driven actions.
 * Uses act(), extract(), observe() primitives for self-healing automation.
 *
 * POST /bb/create-context   — Create a persistent BrowserBase Context (cookies)
 * POST /bb/open-session     — Open Stagehand session, navigate, check login
 * POST /bb/action           — Perform checkout action (add_to_cart, proceed_to_checkout, place_order)
 * POST /bb/close-session    — Release session
 */

import type { FastifyInstance } from "fastify";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { createContext, getLiveUrl } from "../services/bb-context.service.js";

// Active Stagehand sessions
const activeSessions = new Map<
  string,
  { stagehand: Stagehand; openedAt: number }
>();

// Auto-cleanup sessions after 10 min
const SESSION_TTL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of activeSessions) {
    if (now - sess.openedAt > SESSION_TTL) {
      console.log(`[bb-checkout] Auto-closing stale session ${id.slice(0, 8)}`);
      try { sess.stagehand.close(); } catch { /* ignore */ }
      activeSessions.delete(id);
    }
  }
}, 60_000);

// ── Stagehand model config ──────────────────────────
const STAGEHAND_MODEL = process.env.OPENAI_API_KEY
  ? "openai/gpt-4o-mini"
  : process.env.ANTHROPIC_API_KEY
    ? "anthropic/claude-sonnet-4-5-20250929"
    : "google/gemini-2.5-flash";

export async function bbCheckoutRoutes(app: FastifyInstance) {
  // ── POST /bb/create-context ───────────────────────
  app.post("/bb/create-context", async (_request, reply) => {
    try {
      const projectId = process.env.BROWSERBASE_PROJECT_ID ?? 'unknown';
      console.log(`[BB-CHECKOUT] create-context: projectId=${projectId}`);
      const result = await createContext();
      console.log(`[BB-CHECKOUT] create-context: contextId=${result.bbContextId}`);
      return { success: true, bbContextId: result.bbContextId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create context";
      console.error(`[BB-CHECKOUT] create-context: ERROR — ${message}`);
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

    const isLoginSession = body.purpose === "login";
    const t0 = Date.now();

    try {
      console.log(`[BB-CHECKOUT] open-session: purpose=${body.purpose}, contextId=${body.bbContextId.slice(0, 8)}, storeUrl=${body.storeUrl}`);

      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        model: STAGEHAND_MODEL,
        browserbaseSessionCreateParams: {
          browserSettings: {
            context: { id: body.bbContextId, persist: true },
          },
          keepAlive: isLoginSession,
          timeout: 1800,
        },
        verbose: 1,
      });

      await stagehand.init();
      const sessionId = stagehand.browserbaseSessionID!;
      console.log(`[BB-CHECKOUT] open-session: sessionId=${sessionId.slice(0, 8)}, connecting CDP...`);
      const page = stagehand.context.pages()[0];

      // Navigate to store
      console.log(`[BB-CHECKOUT] open-session: Navigating to ${body.storeUrl}`);
      await page.goto(body.storeUrl, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
      const pageTitle = await page.title();
      console.log(`[BB-CHECKOUT] open-session: Navigated to Amazon, title="${pageTitle}"`);

      // Check login status using AI extraction
      const loginCheck = await stagehand.extract(
        "Check if the user is logged into Amazon. Look for a greeting like 'Hello, [Name]' in the navigation bar, or a 'Sign in' button. If on a sign-in page, the user is NOT logged in.",
        z.object({
          loggedIn: z.boolean().describe("true if user is logged in, false if sign-in page or 'Sign in' button visible"),
          userName: z.string().optional().describe("The user's name if visible in nav bar"),
        }),
      );

      // Get live view URL with embedded auth token (works without BrowserBase login)
      let liveUrl: string;
      try {
        liveUrl = await getLiveUrl(sessionId);
      } catch {
        liveUrl = `https://www.browserbase.com/sessions/${sessionId}/live-view`;
      }

      console.log(`[BB-CHECKOUT] open-session: Login check result — loggedIn=${loginCheck.loggedIn}, userName=${loginCheck.userName ?? 'N/A'}`);
      console.log(`[BB-CHECKOUT] open-session: Session ${sessionId.slice(0, 8)} opened in ${Date.now() - t0}ms`);

      if (isLoginSession) {
        // Release Stagehand so user can interact via Live View / connect page
        console.log(`[BB-CHECKOUT] open-session: Login session ${sessionId.slice(0, 8)} — releasing for user interaction`);
        await stagehand.close();
      } else {
        // Keep for automated actions
        activeSessions.set(sessionId, {
          stagehand,
          openedAt: Date.now(),
        });
      }

      return {
        success: true,
        bbSessionId: sessionId,
        liveUrl,
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

    // Try active session first, or reconnect
    console.log(`[BB-CHECKOUT] action: type=${body.action}, sessionId=${body.bbSessionId.slice(0, 8)}`);
    let sess = activeSessions.get(body.bbSessionId);
    if (!sess) {
      // Reconnect to existing BrowserBase session
      try {
        console.log(`[BB-CHECKOUT] action: Reconnecting to session ${body.bbSessionId.slice(0, 8)}`);
        const stagehand = new Stagehand({
          env: "BROWSERBASE",
          browserbaseSessionID: body.bbSessionId,
          model: STAGEHAND_MODEL,
          verbose: 1,
        });
        await stagehand.init();
        sess = { stagehand, openedAt: Date.now() };
        activeSessions.set(body.bbSessionId, sess);
      } catch (err) {
        return reply.status(404).send({
          success: false,
          error: "Session not found or expired. Please start a new checkout.",
        });
      }
    }

    const { stagehand } = sess;

    try {
      console.log(`[BB-CHECKOUT] action: stagehand.act() calling for action=${body.action}...`);
      let result: any;
      switch (body.action) {
        case "add_to_cart":
          result = await addToCart(stagehand, body.asin!, body.quantity ?? 1);
          console.log(`[BB-CHECKOUT] action: result=${JSON.stringify(result)}`);
          return result;

        case "proceed_to_checkout":
          result = await proceedToCheckout(stagehand);
          console.log(`[BB-CHECKOUT] action: result=${JSON.stringify(result)}`);
          return result;

        case "place_order":
          result = await placeOrder(stagehand);
          console.log(`[BB-CHECKOUT] action: result=${JSON.stringify(result)}`);
          return result;

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

  // ── POST /bb/inject-cookies ──────────────────────
  // Injects vault cookies into a BB Context via a temporary Playwright session
  app.post("/bb/inject-cookies", async (request, reply) => {
    const body = request.body as { bbContextId?: string; cookies?: any[] };
    if (!body?.bbContextId || !body?.cookies?.length) {
      return reply.status(400).send({ success: false, error: "bbContextId and cookies[] required" });
    }

    const t0 = Date.now();
    console.log(`[BB-CHECKOUT] inject-cookies: contextId=${body.bbContextId.slice(0, 8)}, cookieCount=${body.cookies.length}`);

    try {
      // Open a temporary session with the context
      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        model: STAGEHAND_MODEL,
        browserbaseSessionCreateParams: {
          browserSettings: {
            context: { id: body.bbContextId, persist: true },
          },
          timeout: 300,
        },
        verbose: 0,
      });

      await stagehand.init();
      const page = stagehand.context.pages()[0];

      // Navigate to Amazon first (cookies need matching domain)
      await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded", timeoutMs: 30_000 });

      // Inject cookies via Playwright context
      const browserContext = stagehand.context;
      const cookiesToAdd = body.cookies
        .filter((c: any) => c.name && c.value && c.domain)
        .map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || "/",
          secure: c.secure ?? true,
          httpOnly: c.httpOnly ?? false,
          sameSite: (c.sameSite === "None" ? "None" : c.sameSite === "Lax" ? "Lax" : "Strict") as "None" | "Lax" | "Strict",
          ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
        }));

      await browserContext.addCookies(cookiesToAdd);
      console.log(`[BB-CHECKOUT] inject-cookies: Injected ${cookiesToAdd.length} cookies`);

      // Reload to apply cookies
      await page.reload({ waitUntil: "domcontentloaded", timeoutMs: 15_000 });

      // Verify login
      const loginCheck = await stagehand.extract(
        "Check if the user is logged into Amazon. Look for 'Hello, [Name]' in the nav bar.",
        z.object({
          loggedIn: z.boolean(),
          userName: z.string().optional(),
        }),
      );

      console.log(`[BB-CHECKOUT] inject-cookies: After injection — loggedIn=${loginCheck.loggedIn}, userName=${loginCheck.userName ?? 'N/A'}, took ${Date.now() - t0}ms`);

      // Close session — cookies are persisted in the Context
      await stagehand.close();

      return {
        success: true,
        loggedIn: loginCheck.loggedIn,
        userName: loginCheck.userName,
        cookiesInjected: cookiesToAdd.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cookie injection failed";
      console.error(`[BB-CHECKOUT] inject-cookies: ERROR — ${message}`);
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── POST /bb/close-session ────────────────────────
  app.post("/bb/close-session", async (request, reply) => {
    const body = request.body as { bbSessionId?: string };
    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    console.log(`[BB-CHECKOUT] close-session: sessionId=${body.bbSessionId.slice(0, 8)}`);
    const sess = activeSessions.get(body.bbSessionId);
    if (sess) {
      try { await sess.stagehand.close(); } catch { /* ignore */ }
      activeSessions.delete(body.bbSessionId);
      console.log(`[BB-CHECKOUT] close-session: Session closed and removed from active map`);
    } else {
      console.log(`[BB-CHECKOUT] close-session: Session not found in active map (already closed?)`);
    }

    return { success: true };
  });
}

// ═══════════════════════════════════════════════════════
// CHECKOUT ACTIONS (Stagehand AI)
// ═══════════════════════════════════════════════════════

async function addToCart(
  stagehand: Stagehand,
  asin: string,
  quantity: number,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const t0 = Date.now();
  console.log(`[bb-checkout] addToCart asin=${asin} qty=${quantity}`);

  try {
    const page = stagehand.context.pages()[0];

    // Navigate to product page
    const currentUrl = page.url();
    if (!currentUrl.includes(`/dp/${asin}`)) {
      await page.goto(`https://www.amazon.com/dp/${asin}`, {
        waitUntil: "domcontentloaded",
        timeoutMs: 30_000,
      });
    }

    // Check availability using AI
    const availability = await stagehand.extract(
      "Check if this product is available for purchase. Look for 'In Stock', 'Add to Cart' button, or 'Currently unavailable' / 'Out of Stock' messages.",
      z.object({
        available: z.boolean().describe("true if product can be purchased"),
        price: z.string().optional().describe("Current price if visible"),
      }),
    );

    if (!availability.available) {
      return { success: false, error: "Product is out of stock" };
    }

    // Set quantity if > 1
    if (quantity > 1) {
      try {
        await stagehand.act(`Select quantity ${quantity} from the quantity dropdown`);
      } catch { /* quantity selector may not exist */ }
    }

    // Add to cart using AI action
    await stagehand.act("Click the 'Add to Cart' button");

    // Wait for cart confirmation
    await page.waitForTimeout(2000);

    // Verify item was added
    const cartStatus = await stagehand.extract(
      "Check if the item was successfully added to the cart. Look for 'Added to Cart', 'Subtotal', cart confirmation messages, or 'Proceed to checkout' button.",
      z.object({
        added: z.boolean().describe("true if item was added to cart successfully"),
        cartSubtotal: z.string().optional().describe("Cart subtotal if visible"),
      }),
    );

    console.log(`[bb-checkout] addToCart completed in ${Date.now() - t0}ms — added=${cartStatus.added}`);

    if (!cartStatus.added) {
      return { success: false, error: "Could not confirm item was added to cart" };
    }

    return { success: true, data: { added: true, cartSubtotal: cartStatus.cartSubtotal } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Add to cart failed";
    console.error(`[bb-checkout] addToCart FAILED in ${Date.now() - t0}ms — ${message}`);
    return { success: false, error: message };
  }
}

async function proceedToCheckout(
  stagehand: Stagehand,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const t0 = Date.now();
  console.log("[bb-checkout] proceedToCheckout");

  try {
    const page = stagehand.context.pages()[0];

    // Try to proceed to checkout
    try {
      await stagehand.act("Click 'Proceed to checkout' or 'Proceed to Buy' button");
    } catch {
      // Fallback: navigate directly
      await page.goto(
        "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1",
        { waitUntil: "domcontentloaded", timeoutMs: 30_000 },
      );
    }

    await page.waitForTimeout(3000);

    // Check if we're on checkout page
    const url = page.url();
    if (url.includes("/ap/signin") || url.includes("/ap/cvf")) {
      return { success: false, error: "Amazon requires re-authentication at checkout" };
    }

    // Extract checkout summary using AI
    const summary = await stagehand.extract(
      "Extract the complete checkout summary from this Amazon checkout page. Get the shipping address, payment method, delivery estimate, item names, and order total.",
      z.object({
        title: z.string().describe("Main item name"),
        price: z.number().optional().describe("Order total as a number"),
        address: z.string().optional().describe("Shipping address"),
        paymentMethod: z.string().optional().describe("Payment method (card ending in XXXX)"),
        estimatedDelivery: z.string().optional().describe("Estimated delivery date"),
        total: z.string().optional().describe("Order total as displayed (e.g. '$12.99')"),
      }),
    );

    console.log(`[bb-checkout] proceedToCheckout completed in ${Date.now() - t0}ms`);

    return {
      success: true,
      data: { summary },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout navigation failed";
    console.error(`[bb-checkout] proceedToCheckout FAILED in ${Date.now() - t0}ms — ${message}`);
    return { success: false, error: message };
  }
}

async function placeOrder(
  stagehand: Stagehand,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const t0 = Date.now();
  console.log("[bb-checkout] placeOrder");

  try {
    const page = stagehand.context.pages()[0];

    // Verify we're on checkout page
    const url = page.url();
    if (!url.includes("/buy/") && !url.includes("/checkout/") && !url.includes("spc/handlers")) {
      await page.goto(
        "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1",
        { waitUntil: "domcontentloaded", timeoutMs: 30_000 },
      );
      await page.waitForTimeout(2000);
    }

    // Place the order using AI action
    await stagehand.act("Click the 'Place your order' button to finalize the purchase");

    // Wait for confirmation page
    await page.waitForTimeout(5000);

    // Extract order confirmation using AI
    const confirmation = await stagehand.extract(
      "Extract the order confirmation details. Look for 'Thank you', order number (format: 123-1234567-1234567), estimated delivery date, and order total. If this is NOT a confirmation page, set confirmed to false.",
      z.object({
        confirmed: z.boolean().describe("true if order was placed successfully"),
        amazonOrderId: z.string().optional().describe("Amazon order number (123-1234567-1234567 format)"),
        estimatedDelivery: z.string().optional().describe("Estimated delivery date"),
        total: z.string().optional().describe("Order total"),
      }),
    );

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

    // Check for errors on page
    const errorInfo = await stagehand.extract(
      "Check if there are any error messages on this page, such as payment issues, address problems, or other checkout errors.",
      z.object({
        hasError: z.boolean(),
        errorMessage: z.string().optional(),
      }),
    );

    return {
      success: false,
      error: errorInfo.errorMessage || "Order confirmation not detected. Check your Amazon account.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Place order failed";
    console.error(`[bb-checkout] placeOrder FAILED in ${Date.now() - t0}ms — ${message}`);
    return { success: false, error: message };
  }
}
