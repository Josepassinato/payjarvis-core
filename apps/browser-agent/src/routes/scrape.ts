/**
 * /api/scrape — Bridge between structured service calls and CDP /navigate.
 *
 * Maps { site, action, params } → URL, calls /navigate internally,
 * then runs site-specific extraction if needed.
 */

import type { FastifyInstance } from "fastify";

// ── URL Mappers ──────────────────────────────────────────

interface ScrapeRequest {
  site: string;
  action: string;
  params?: Record<string, string>;
}

interface RouteMapping {
  buildUrl: (params: Record<string, string>) => string;
  extractionScript?: string;
}

const SUPPORTED_ROUTES: Record<string, Record<string, RouteMapping>> = {
  amazon: {
    searchProducts: {
      buildUrl: (p) => {
        const domain = p.amazonDomain || "amazon.com";
        return `https://www.${domain}/s?k=${encodeURIComponent(p.query || "")}&ref=nb_sb_noss`;
      },
    },
    getProduct: {
      buildUrl: (p) => {
        const domain = p.amazonDomain || "amazon.com";
        return `https://www.${domain}/dp/${encodeURIComponent(p.asin || "")}`;
      },
      extractionScript: `(() => {
        const title = document.querySelector('#productTitle')?.textContent?.trim() || '';
        const priceEl = document.querySelector('.a-price .a-offscreen')
          || document.querySelector('#priceblock_ourprice')
          || document.querySelector('#priceblock_dealprice')
          || document.querySelector('.a-price-whole');
        const price = priceEl?.textContent?.trim() || null;
        const availability = document.querySelector('#availability span')?.textContent?.trim()
          || document.querySelector('#outOfStock span')?.textContent?.trim()
          || 'Unknown';
        const description = document.querySelector('#productDescription p')?.textContent?.trim()
          || document.querySelector('#feature-bullets')?.textContent?.trim()?.substring(0, 500)
          || '';
        const image = document.querySelector('#landingImage')?.src
          || document.querySelector('#imgBlkFront')?.src || null;
        const rating = document.querySelector('#acrPopover .a-icon-alt')?.textContent?.trim() || null;
        const reviews = document.querySelector('#acrCustomerReviewText')?.textContent?.trim() || null;
        const asin = document.querySelector('[data-asin]')?.getAttribute('data-asin')
          || window.location.pathname.match(/\\/dp\\/([A-Z0-9]+)/)?.[1] || null;
        return JSON.stringify([{ title, price, availability, description: description.substring(0, 500), image, rating, reviews, asin }]);
      })()`,
    },
  },
  target: {
    searchProducts: {
      buildUrl: (p) =>
        `https://www.target.com/s?searchTerm=${encodeURIComponent(p.query || "")}`,
      extractionScript: `(() => {
        const cards = document.querySelectorAll('[data-test="product-grid"] a[data-test="product-title"], [data-test="@web/ProductCard/ProductCardVariantDefault"]');
        if (cards.length === 0) {
          const items = document.querySelectorAll('[class*="ProductCard"], [data-test*="product"]');
          const products = [];
          for (let i = 0; i < Math.min(items.length, 10); i++) {
            const el = items[i];
            const title = el.querySelector('[data-test="product-title"], a[class*="Link"]')?.textContent?.trim() || '';
            const price = el.querySelector('[data-test="current-price"] span, [class*="Price"]')?.textContent?.trim() || null;
            const availability = el.querySelector('[data-test="fulfillment"]')?.textContent?.trim() || 'Available';
            if (title) products.push({ title, price, availability });
          }
          return JSON.stringify(products);
        }
        const products = [];
        for (let i = 0; i < Math.min(cards.length, 10); i++) {
          const card = cards[i].closest('[data-test*="product"], [class*="Card"]') || cards[i].parentElement?.parentElement;
          const title = cards[i].textContent?.trim() || '';
          const price = card?.querySelector('[data-test="current-price"] span')?.textContent?.trim() || null;
          const availability = card?.querySelector('[data-test="fulfillment"]')?.textContent?.trim() || 'Available';
          if (title) products.push({ title, price, availability });
        }
        return JSON.stringify(products);
      })()`,
    },
  },
  macys: {
    searchProducts: {
      buildUrl: (p) =>
        `https://www.macys.com/shop/featured/${encodeURIComponent(p.query || "")}`,
      extractionScript: `(() => {
        const cards = document.querySelectorAll('.productCard, [data-testid="product-card"], .cell.productCard, .product-thumbnail');
        const products = [];
        for (let i = 0; i < Math.min(cards.length, 10); i++) {
          const card = cards[i];
          const title = card.querySelector('.productDescription, .product-name, a.productDescLink')?.textContent?.trim() || '';
          const price = card.querySelector('.regular-price, .sale-price, [class*="price"]')?.textContent?.trim() || null;
          const discount = card.querySelector('.discount, .savings, [class*="discount"]')?.textContent?.trim() || null;
          if (title) products.push({ title, price, discount });
        }
        return JSON.stringify(products);
      })()`,
    },
    getSales: {
      buildUrl: () => `https://www.macys.com/shop/sale`,
      extractionScript: `(() => {
        const cards = document.querySelectorAll('.productCard, [data-testid="product-card"], .cell.productCard');
        const products = [];
        for (let i = 0; i < Math.min(cards.length, 10); i++) {
          const card = cards[i];
          const title = card.querySelector('.productDescription, .product-name')?.textContent?.trim() || '';
          const price = card.querySelector('.regular-price, [class*="price"]')?.textContent?.trim() || null;
          const salePrice = card.querySelector('.sale-price, [class*="sale"]')?.textContent?.trim() || null;
          if (title) products.push({ title, price, salePrice });
        }
        return JSON.stringify(products);
      })()`,
    },
  },
};

const NOT_IMPLEMENTED_SITES = [
  "publix", "cvs", "amtrak", "flixbus", "greyhound",
  "enterprise", "turo", "homeservices", "rentcar",
  "mechanic", "wrench", "angi", "walgreens",
];

// ── Route registration ──────────────────────────────────

export async function scrapeRoutes(app: FastifyInstance) {
  app.post("/api/scrape", async (request, reply) => {
    const body = request.body as ScrapeRequest;

    if (!body.site || !body.action) {
      return reply.status(400).send({
        success: false,
        error: "site and action are required",
      });
    }

    const site = body.site.toLowerCase();
    const action = body.action;
    const params = body.params || {};

    // Check not-implemented sites
    if (NOT_IMPLEMENTED_SITES.includes(site)) {
      return reply.status(501).send({
        success: false,
        error: `Site "${site}" is not yet implemented`,
        status: "not_implemented",
        available: Object.keys(SUPPORTED_ROUTES),
      });
    }

    // Check supported routes
    const siteRoutes = SUPPORTED_ROUTES[site];
    if (!siteRoutes) {
      return reply.status(400).send({
        success: false,
        error: `Unsupported site: "${site}"`,
        available: [...Object.keys(SUPPORTED_ROUTES), ...NOT_IMPLEMENTED_SITES],
      });
    }

    const route = siteRoutes[action];
    if (!route) {
      return reply.status(400).send({
        success: false,
        error: `Unsupported action "${action}" for site "${site}"`,
        available: Object.keys(siteRoutes),
      });
    }

    // Build URL
    const url = route.buildUrl(params);
    app.log.info({ site, action, url }, "[scrape] Navigating");

    // Call /navigate internally
    const navRes = await app.inject({
      method: "POST",
      url: "/navigate",
      payload: { url, searchTerm: params.query },
    });

    const navData = JSON.parse(navRes.body) as {
      success: boolean;
      title?: string;
      url?: string;
      products?: unknown[];
      content?: string;
      obstacle?: { type: string; description: string };
      handoff?: unknown;
      error?: string;
    };

    if (!navData.success) {
      return reply.status(navRes.statusCode).send({
        success: false,
        error: navData.error || "Navigation failed",
        site,
        action,
      });
    }

    // If obstacle detected, pass through
    if (navData.obstacle) {
      return {
        success: false,
        error: `Obstacle detected: ${navData.obstacle.description}`,
        obstacle: navData.obstacle,
        handoff: navData.handoff,
        site,
        action,
      };
    }

    // For Amazon searchProducts, /navigate already extracts products
    if (site === "amazon" && action === "searchProducts" && navData.products && navData.products.length > 0) {
      app.log.info({ site, action, count: navData.products.length }, "[scrape] Products extracted via /navigate");
      return {
        success: true,
        site,
        action,
        data: navData.products,
        totalProducts: navData.products.length,
        pageTitle: navData.title,
        pageUrl: navData.url,
      };
    }

    // For routes with custom extraction scripts, run via CDP
    if (route.extractionScript) {
      try {
        const extracted = await runExtraction(app, route.extractionScript);
        if (extracted && extracted.length > 0) {
          app.log.info({ site, action, count: extracted.length }, "[scrape] Custom extraction succeeded");
          return {
            success: true,
            site,
            action,
            data: extracted,
            totalProducts: extracted.length,
            pageTitle: navData.title,
            pageUrl: navData.url,
          };
        }
      } catch (err) {
        app.log.warn({ err, site, action }, "[scrape] Custom extraction failed, falling back to content");
      }
    }

    // Fallback: return whatever /navigate got
    return {
      success: true,
      site,
      action,
      data: navData.products || [],
      totalProducts: navData.products?.length || 0,
      pageTitle: navData.title,
      pageUrl: navData.url,
      content: navData.content?.substring(0, 3000),
    };
  });
}

// ── CDP extraction helper ────────────────────────────────

async function runExtraction(app: FastifyInstance, script: string): Promise<unknown[]> {
  const cdpPort = parseInt(process.env.OPENCLAW_CDP_PORT ?? "18800", 10);

  const targetsRes = await fetch(`http://localhost:${cdpPort}/json/list`);
  const targets = (await targetsRes.json()) as Array<{
    id: string;
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const pageTarget = targets.find((t) => t.type === "page");

  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("No page target available");
  }

  const { default: WS } = await import("ws");
  const ws = new WS(pageTarget.webSocketDebuggerUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
    ws.on("open", () => { clearTimeout(timeout); resolve(); });
    ws.on("error", (err: Error) => { clearTimeout(timeout); reject(err); });
  });

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const id = 1;
      const timeout = setTimeout(() => reject(new Error("Extraction timeout")), 15000);
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result?.result?.value ?? "[]");
          }
        }
      });
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: script, returnByValue: true },
      }));
    });

    return JSON.parse(result);
  } finally {
    ws.close();
  }
}
