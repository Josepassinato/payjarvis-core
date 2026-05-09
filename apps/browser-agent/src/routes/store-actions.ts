/**
 * Store Actions Routes — Universal store search & cart operations
 *
 * POST /browser/store/search       — Search products in any store
 * POST /browser/store/add-to-cart  — Add product to cart
 * GET  /browser/store/auth-status  — Check if Context is authenticated
 *
 * Also exposes Context management proxy routes for the API server:
 * POST /browser/context/create        — Create new Browserbase Context
 * POST /browser/context/open-session  — Open session with Context
 * POST /browser/context/close-session — Close a session
 * POST /browser/context/delete        — Delete a Context
 *
 * Design: Stateless — each request opens session, does action, closes session.
 */

import type { FastifyInstance } from "fastify";
import {
  createContext,
  openSession,
  closeSession,
  checkLoginStatus,
  deleteContext,
} from "../services/bb-context.service.js";

// ─── Search URL templates per store ──────────────────

const SEARCH_URLS: Record<string, (query: string) => string> = {
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  walmart: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  target: (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,
  bestbuy: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,
  ebay: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  shopify: (q) => `/search?q=${encodeURIComponent(q)}`,
};

// ─── Add to cart selectors per store ─────────────────

const ADD_TO_CART_SELECTORS: Record<string, string> = {
  amazon: "#add-to-cart-button",
  walmart: "[data-tl-id='CartAdd'], button[data-testid='add-to-cart']",
  target: "[data-test='orderPickupButton'], [data-test='shipItButton']",
  bestbuy: ".add-to-cart-button, button[data-button-state='ADD_TO_CART']",
  ebay: "#atcBtn_btn_1, a[data-testid='x-atc-action']",
  shopify: "form[action*='/cart/add'] button[type='submit'], button[name='add'], [data-add-to-cart], .product-form__submit",
};

const DEFAULT_ADD_SELECTOR = "button:has-text('Add to Cart'), button:has-text('Add to Bag'), button:has-text('Add to cart')";
const LOGIN_REQUIRED_FOR_CART = new Set(["amazon", "walmart", "target", "bestbuy"]);

function normalizeStoreUrl(storeUrl: string): string {
  return storeUrl.replace(/\/$/, "");
}

export async function storeActionRoutes(app: FastifyInstance) {

  // ── Context management proxy routes ─────────────────

  app.post("/browser/context/create", async (_request, reply) => {
    const t0 = Date.now();
    app.log.info("[store-actions] POST /browser/context/create — start");
    try {
      const result = await createContext();
      app.log.info(`[store-actions] /browser/context/create — done in ${Date.now() - t0}ms`);
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create context";
      app.log.error({ err }, `[store-actions] /browser/context/create — FAILED in ${Date.now() - t0}ms`);
      return reply.status(500).send({ success: false, error: message });
    }
  });

  app.post("/browser/context/open-session", async (request, reply) => {
    const t0 = Date.now();
    const body = request.body as {
      bbContextId: string;
      storeUrl: string;
      purpose?: string;
    };

    if (!body.bbContextId || !body.storeUrl) {
      return reply.status(400).send({ success: false, error: "bbContextId and storeUrl are required" });
    }

    app.log.info({ bbContextId: body.bbContextId?.slice(0, 8), storeUrl: body.storeUrl, purpose: body.purpose }, "[store-actions] POST /browser/context/open-session — start");
    try {
      const result = await openSession(body.bbContextId, body.storeUrl, body.purpose);
      // Don't close the session here — caller will use it (login flow)
      // But we do close the browser connection since the session stays alive in Browserbase
      try { await result.browser.close(); } catch { /* ignore */ }
      app.log.info(`[store-actions] /browser/context/open-session — done in ${Date.now() - t0}ms, liveUrl=${result.liveUrl?.slice(0, 60)}`);
      return {
        success: true,
        data: {
          bbSessionId: result.bbSessionId,
          liveUrl: result.liveUrl,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open session";
      app.log.error({ err }, `[store-actions] /browser/context/open-session — FAILED in ${Date.now() - t0}ms`);
      return reply.status(500).send({ success: false, error: message });
    }
  });

  app.post("/browser/context/close-session", async (request, reply) => {
    const body = request.body as { bbSessionId: string };
    if (!body.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId is required" });
    }

    try {
      // We don't have the browser handle here — just release via API
      const Browserbase = (await import("@browserbasehq/sdk")).default;
      const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
      await client.sessions.update(body.bbSessionId, { status: "REQUEST_RELEASE" });
      return { success: true };
    } catch {
      return { success: true }; // Best effort
    }
  });

  app.post("/browser/context/delete", async (request, reply) => {
    const body = request.body as { bbContextId: string };
    if (!body.bbContextId) {
      return reply.status(400).send({ success: false, error: "bbContextId is required" });
    }

    try {
      await deleteContext(body.bbContextId);
      return { success: true };
    } catch {
      return { success: true }; // Best effort
    }
  });

  // ── POST /browser/store/search ──────────────────────
  app.post("/browser/store/search", async (request, reply) => {
    const body = request.body as {
      bbContextId: string;
      storeUrl: string;
      store: string;
      query: string;
      maxResults?: number;
    };

    if (!body.bbContextId || !body.store || !body.query) {
      return reply.status(400).send({
        success: false,
        error: "bbContextId, store, and query are required",
      });
    }

    const maxResults = body.maxResults ?? 5;
    const searchUrlBuilder = SEARCH_URLS[body.store];
    const searchPath = searchUrlBuilder
      ? searchUrlBuilder(body.query)
      : `/search?q=${encodeURIComponent(body.query)}`;
    const searchUrl = searchPath.startsWith("http")
      ? searchPath
      : `${normalizeStoreUrl(body.storeUrl)}${searchPath.startsWith("/") ? searchPath : `/${searchPath}`}`;

    let browser, page;
    try {
      const session = await openSession(body.bbContextId, searchUrl, "search");
      browser = session.browser;
      page = session.page;

      // Wait for results to load
      await page.waitForTimeout(3000);

      // Extract products (Amazon-optimized, with generic fallback)
      const products = await page.evaluate((args) => {
        const { store, max } = args;

        if (store === "amazon") {
          const selectors = [
            '[data-component-type="s-search-result"]',
            '.s-main-slot .s-result-item[data-asin]:not([data-asin=""])',
            'div[data-asin]:not([data-asin=""])',
          ];
          let items: Element[] = [];
          for (const sel of selectors) {
            items = Array.from(document.querySelectorAll(sel));
            if (items.length > 0) break;
          }

          return items.slice(0, max).map((item) => {
            const asin = item.getAttribute("data-asin");
            const titleEl = item.querySelector("h2 a span") || item.querySelector("h2 span");
            const title = titleEl?.textContent?.trim() ?? null;
            const priceEl = item.querySelector(".a-price .a-offscreen");
            const price = priceEl?.textContent?.trim() ?? null;
            const linkEl = item.querySelector("h2 a") as HTMLAnchorElement | null;
            const link = linkEl?.href ?? null;
            const rating = item.querySelector(".a-icon-alt")?.textContent?.trim() ?? null;
            const image = (item.querySelector("img.s-image") as HTMLImageElement)?.src ?? null;
            const isPrime = !!item.querySelector('[aria-label="Amazon Prime"]') || !!item.querySelector(".a-icon-prime");
            return { asin, title, price, link, rating, image, isPrime };
          }).filter((p) => p.title);
        }

        if (store === "shopify") {
          const items = Array.from(document.querySelectorAll(".grid__item, .card-wrapper, .product-card, [class*='product-card'], li[class*='grid']"));
          return items.slice(0, max).map((item) => {
            const title = item.querySelector(".card__heading, .product-card__title, .full-unstyled-link, h2, h3")?.textContent?.trim() ?? null;
            const price = item.querySelector(".price, .price-item, [class*='price']")?.textContent?.trim() ?? null;
            const link = (item.querySelector("a[href*='/products/'], a[href*='/product/']") as HTMLAnchorElement)?.href ?? null;
            const image = (item.querySelector("img") as HTMLImageElement)?.src ?? null;
            return { title, price, link, image, asin: null, rating: null, isPrime: false };
          }).filter((p) => p.title && p.link);
        }

        // Generic extraction
        const items = Array.from(document.querySelectorAll("[data-item-id], [data-product-id], article, .product-card, .s-result-item, .grid__item, .card-wrapper"));
        return items.slice(0, max).map((item) => {
          const title = item.querySelector("h2, h3, [data-automation-id='product-title'], .product-title, .card__heading, .full-unstyled-link")?.textContent?.trim() ?? null;
          const price = item.querySelector("[data-automation-id='product-price'], .price, [itemprop='price'], .price-item")?.textContent?.trim() ?? null;
          const link = (item.querySelector("a[href*='/product'], a[href*='/products/'], a[href*='/ip/'], h2 a, h3 a") as HTMLAnchorElement)?.href ?? null;
          const image = (item.querySelector("img") as HTMLImageElement)?.src ?? null;
          return { title, price, link, image, asin: null, rating: null, isPrime: false };
        }).filter((p) => p.title);
      }, { store: body.store, max: maxResults });

      await closeSession(session.bbSessionId, browser);

      app.log.info(
        { store: body.store, query: body.query, count: products.length },
        "[store-actions] Search completed",
      );

      return {
        success: true,
        data: {
          store: body.store,
          query: body.query,
          resultCount: products.length,
          products,
        },
      };
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
      const message = err instanceof Error ? err.message : "Search failed";
      app.log.error({ err, store: body.store, query: body.query }, "[store-actions] Search error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── POST /browser/store/add-to-cart ─────────────────
  app.post("/browser/store/add-to-cart", async (request, reply) => {
    const body = request.body as {
      bbContextId: string;
      storeUrl: string;
      store: string;
      productUrl: string;
      asin?: string;
      quantity?: number;
    };

    if (!body.bbContextId || !body.store || !body.productUrl) {
      return reply.status(400).send({
        success: false,
        error: "bbContextId, store, and productUrl are required",
      });
    }

    let browser, page;
    try {
      const session = await openSession(body.bbContextId, body.productUrl, "purchase");
      browser = session.browser;
      page = session.page;

      // Only force login for merchants where cart/checkout commonly requires an account.
      if (LOGIN_REQUIRED_FOR_CART.has(body.store)) {
        const loginStatus = await checkLoginStatus(page, body.store);
        if (!loginStatus.loggedIn) {
          await closeSession(session.bbSessionId, browser);
          return reply.status(401).send({
            success: false,
            error: "Login expired. User must reauthenticate.",
            code: "SESSION_EXPIRED",
          });
        }
      }

      // Wait for page to fully load
      await page.waitForTimeout(2000);

      // Extract product info
      const productInfo = await page.evaluate(() => {
        const title = document.querySelector("#productTitle, h1, [data-automation-id='product-title'], .product__title, .product-title")?.textContent?.trim() ?? null;
        const price = document.querySelector(".a-price .a-offscreen, [itemprop='price'], .price-characteristic, .price, .price-item")?.textContent?.trim() ?? null;
        return { title, price };
      });

      // Set quantity if > 1
      const quantity = body.quantity ?? 1;
      if (quantity > 1 && body.store === "amazon") {
        const qtySelect = await page.$("#quantity");
        if (qtySelect) {
          await qtySelect.selectOption(String(quantity));
          await page.waitForTimeout(500);
        }
      }

      // Click add to cart
      const selector = ADD_TO_CART_SELECTORS[body.store] ?? DEFAULT_ADD_SELECTOR;
      const selectors = selector.split(", ");
      let clicked = false;

      for (const sel of selectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        await closeSession(session.bbSessionId, browser);
        return reply.status(400).send({
          success: false,
          error: "Add to cart button not found. Product may be unavailable.",
        });
      }

      // Wait for confirmation
      await page.waitForTimeout(3000);

      const cartUrl = body.store === "amazon"
        ? "https://www.amazon.com/gp/cart/view.html"
        : `${normalizeStoreUrl(body.storeUrl)}/cart`;

      await closeSession(session.bbSessionId, browser);

      app.log.info(
        { store: body.store, title: productInfo.title, quantity },
        "[store-actions] Added to cart",
      );

      return {
        success: true,
        data: {
          added: true,
          product: productInfo,
          quantity,
          cartUrl,
        },
      };
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
      const message = err instanceof Error ? err.message : "Add to cart failed";
      app.log.error({ err, store: body.store }, "[store-actions] Add to cart error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── GET /browser/store/auth-status ──────────────────
  // Connects to existing login session via CDP (fast) instead of creating a new session (slow)
  app.get("/browser/store/auth-status", async (request, reply) => {
    const t0 = Date.now();
    const query = request.query as {
      bbContextId: string;
      bbSessionId?: string;
      storeUrl: string;
      store: string;
    };

    if (!query.bbContextId || !query.storeUrl || !query.store) {
      return reply.status(400).send({
        success: false,
        error: "bbContextId, storeUrl, and store are required",
      });
    }

    // If we have the login session ID, connect to it directly via CDP (fast path ~1s)
    if (query.bbSessionId) {
      const apiKey = process.env.BROWSERBASE_API_KEY!;
      let browser;
      try {
        app.log.info({ store: query.store, bbSessionId: query.bbSessionId?.slice(0, 8) }, "[store-actions] auth-status — connecting to existing login session via CDP (fast path)");
        const connectUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${query.bbSessionId}`;
        const { chromium } = await import("playwright-core");
        browser = await chromium.connectOverCDP(connectUrl);
        const ctx = browser.contexts()[0];
        const page = ctx?.pages()[0];

        if (!page) {
          await browser.close();
          app.log.warn("[store-actions] auth-status — no page found in login session, falling back");
          // Fall through to slow path
        } else {
          const result = await checkLoginStatus(page, query.store);
          await browser.close(); // Only close CDP, session stays alive (keepAlive=true)
          app.log.info({ loggedIn: result.loggedIn, totalMs: Date.now() - t0 }, `[store-actions] auth-status FAST done in ${Date.now() - t0}ms`);
          return { success: true, data: result };
        }
      } catch (err) {
        if (browser) { try { await browser.close(); } catch { /* ignore */ } }
        app.log.warn({ err: err instanceof Error ? err.message : err }, `[store-actions] auth-status fast path failed in ${Date.now() - t0}ms, falling back to slow path`);
        // Fall through to slow path
      }
    }

    // Slow path: open full new session (only when no bbSessionId provided)
    app.log.info({ store: query.store, bbContextId: query.bbContextId?.slice(0, 8) }, "[store-actions] auth-status — SLOW PATH (opens full new session)");
    let browser;
    try {
      const session = await openSession(query.bbContextId, query.storeUrl, "auth-check");
      browser = session.browser;

      const result = await checkLoginStatus(session.page, query.store);

      await closeSession(session.bbSessionId, browser);

      app.log.info({ loggedIn: result.loggedIn, totalMs: Date.now() - t0 }, `[store-actions] auth-status SLOW done in ${Date.now() - t0}ms`);
      return { success: true, data: result };
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
      const message = err instanceof Error ? err.message : "Auth check failed";
      app.log.error({ err }, `[store-actions] auth-status — FAILED in ${Date.now() - t0}ms`);
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
