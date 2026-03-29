/**
 * PayJarvis Browser Agent — Fastify Server
 *
 * Proxy que conecta ao Chrome do OpenClaw via CDP
 * para interceptar checkouts em sites fechados.
 *
 * Porta: 3003 (BROWSER_AGENT_PORT)
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { CdpMonitor, type CheckoutEvent } from "./cdp-monitor.js";
import { CheckoutDetector } from "./checkout-detector.js";
import { PayjarvisInterceptor } from "./interceptor.js";
import {
  discoverOpenClawBrowserPort,
  getOpenClawBrowserInfo,
} from "./openclaw-bridge.js";
import { HumanBehavior } from "./human-behavior.js";

// Layer 4: Browserbase integration
import {
  createSession as bbCreateSession,
  getSession as bbGetSession,
  getSessionLiveURLs as bbGetLiveURLs,
  closeSession as bbCloseSession,
  listActiveSessions as bbListSessions,
  isConfigured as bbIsConfigured,
} from "./services/browserbase-client.js";
import { assistedFallback } from "./services/assisted-fallback.js";
import {
  requestHandoff,
  resolveHandoff,
  type ObstacleType,
} from "./services/handoff-manager.js";
import { scrapeRoutes } from "./routes/scrape.js";
import { amazonLoginRoutes } from "./routes/amazon-login.js";
import { storeActionRoutes } from "./routes/store-actions.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// ─── State ───────────────────────────────────────────

let cdpMonitor: CdpMonitor | null = null;
let interceptor: PayjarvisInterceptor | null = null;
let lastActivity: Date | null = null;
let connectedBotApiKey: string | null = null;
let connectedBotId: string | null = null;
const detector = new CheckoutDetector();

// Cookie cache per domain (in-memory, persists across navigations within session)
const cookieCache = new Map<string, unknown[]>();

// ─── Routes ──────────────────────────────────────────

app.get("/health", async () => ({
  status: "ok",
  service: "payjarvis-browser-agent",
}));

/** Conectar ao Chrome via CDP */
app.post("/connect", async (request, reply) => {
  const body = request.body as {
    port?: number;
    botApiKey: string;
    botId: string;
  };

  if (!body.botApiKey || !body.botId) {
    return reply.status(400).send({
      success: false,
      error: "botApiKey and botId are required",
    });
  }

  // Desconectar se já estiver conectado
  if (cdpMonitor) {
    await cdpMonitor.disconnect();
    cdpMonitor = null;
    interceptor = null;
  }

  const apiUrl =
    process.env.PAYJARVIS_API_URL ?? "http://localhost:3001";

  const onCheckoutDetected = async (event: CheckoutEvent) => {
    lastActivity = new Date();
    app.log.info(
      { url: event.url, site: event.site },
      "Checkout detected"
    );

    if (interceptor) {
      const result = await interceptor.intercept(event);
      app.log.info(
        { decision: result.decision, amount: result.amount },
        "Intercept result"
      );
    }
  };

  connectedBotApiKey = body.botApiKey;
  connectedBotId = body.botId;

  cdpMonitor = new CdpMonitor({
    port: body.port,
    payjarvisApiUrl: apiUrl,
    botApiKey: body.botApiKey,
    botId: body.botId,
    onCheckoutDetected,
  });

  try {
    await cdpMonitor.connect();

    interceptor = new PayjarvisInterceptor({
      payjarvisApiUrl: apiUrl,
      botApiKey: body.botApiKey,
      botId: body.botId,
      cdpMonitor,
    });

    return {
      success: true,
      data: {
        connected: true,
        port: cdpMonitor.cdpPort,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Connection failed";
    cdpMonitor = null;
    return reply.status(500).send({
      success: false,
      error: message,
    });
  }
});

/** Desconectar do Chrome */
app.post("/disconnect", async () => {
  if (cdpMonitor) {
    await cdpMonitor.disconnect();
    cdpMonitor = null;
    interceptor = null;
    connectedBotApiKey = null;
    connectedBotId = null;
  }

  return { success: true, data: { connected: false } };
});

/** Status do agente */
app.get("/status", async () => ({
  connected: cdpMonitor?.isConnected ?? false,
  reconnecting: cdpMonitor?.isReconnecting ?? false,
  port: cdpMonitor?.cdpPort ?? null,
  activeInterceptions: interceptor?.activeCount ?? 0,
  recentHistory: interceptor?.recentHistory.map((r) => ({
    url: r.event.url,
    site: r.event.site,
    decision: r.result.decision,
    amount: r.result.amount,
    timestamp: r.timestamp.toISOString(),
  })) ?? [],
  lastActivity: lastActivity?.toISOString() ?? null,
}));

/** Testar detecção de checkout (sem conectar ao CDP) */
app.post("/test-intercept", async (request) => {
  const { url } = request.body as { url: string };

  if (!url) {
    return { detected: false, error: "url is required" };
  }

  const match = detector.detect(url);

  if (!match) {
    return { detected: false, url };
  }

  return {
    detected: true,
    url,
    site: match.site,
    stage: match.stage,
    confidence: match.confidence,
    wouldIntercept:
      match.stage !== "cart" && match.confidence !== "low",
  };
});

/** Descobrir porta do OpenClaw */
app.get("/discover-port", async (_request, reply) => {
  try {
    const port = await discoverOpenClawBrowserPort();
    const info = await getOpenClawBrowserInfo(port);
    return {
      success: true,
      data: info,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Discovery failed";
    return reply.status(404).send({
      success: false,
      error: message,
    });
  }
});

/** OpenClaw tool invoke callback */
app.post("/openclaw/tool-invoke", async (request, reply) => {
  const body = request.body as {
    action: "start" | "stop" | "status";
    botApiKey?: string;
    botId?: string;
  };

  if (body.action === "status") {
    return {
      active: cdpMonitor?.isConnected ?? false,
      port: cdpMonitor?.cdpPort ?? null,
      activeInterceptions: interceptor?.activeCount ?? 0,
    };
  }

  if (body.action === "stop") {
    if (cdpMonitor) {
      await cdpMonitor.disconnect();
      cdpMonitor = null;
      interceptor = null;
    }
    return { active: false };
  }

  if (body.action === "start") {
    if (!body.botApiKey || !body.botId) {
      return reply.status(400).send({
        error: "botApiKey and botId required for start",
      });
    }

    // Forward to /connect
    const res = await app.inject({
      method: "POST",
      url: "/connect",
      payload: {
        botApiKey: body.botApiKey,
        botId: body.botId,
      },
    });

    return JSON.parse(res.body);
  }

  return reply.status(400).send({ error: "Invalid action" });
});

/** Navegar para uma URL no Chrome via CDP — com comportamento humano completo */
app.post("/navigate", async (request, reply) => {
  const body = request.body as {
    url: string;
    botId?: string;
    searchTerm?: string;
    injectCookies?: unknown[];
    userAgent?: string;
  };

  if (!body.url) {
    return reply.status(400).send({
      success: false,
      error: "url is required",
    });
  }

  if (!cdpMonitor?.isConnected) {
    return reply.status(400).send({
      success: false,
      error: "CDP not connected. Call POST /connect first.",
    });
  }

  lastActivity = new Date();

  try {
    // Get first page target
    const targetsRes = await fetch(
      `http://localhost:${cdpMonitor.cdpPort}/json/list`
    );
    const targets = (await targetsRes.json()) as Array<{
      id: string;
      type: string;
      url: string;
      webSocketDebuggerUrl?: string;
    }>;
    const pageTarget = targets.find((t) => t.type === "page");

    if (!pageTarget?.webSocketDebuggerUrl) {
      return reply.status(500).send({
        success: false,
        error: "No page target available in Chrome",
      });
    }

    // Connect to the page target directly for navigation
    const { default: WS } = await import("ws");
    const pageWs = new WS(pageTarget.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timeout connecting to page target")),
        5000
      );
      pageWs.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      pageWs.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    let msgId = 0;
    const sendCmd = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = ++msgId;
        const timeout = setTimeout(
          () => reject(new Error(`CDP timeout: ${method}`)),
          15000
        );
        const handler = (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            clearTimeout(timeout);
            pageWs.off("message", handler);
            if (msg.error) {
              reject(new Error(msg.error.message));
            } else {
              resolve(msg.result ?? {});
            }
          }
        };
        pageWs.on("message", handler);
        pageWs.send(JSON.stringify({ id, method, params }));
      });

    // Helper: wait for Page.loadEventFired
    const waitForLoad = () =>
      new Promise<void>((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) { resolved = true; resolve(); }
        }, 15000);
        const handler = (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.method === "Page.loadEventFired") {
            clearTimeout(timeout);
            pageWs.off("message", handler);
            if (!resolved) { resolved = true; resolve(); }
          }
        };
        pageWs.on("message", handler);
      });

    // Enable Page and Network events
    await sendCmd("Page.enable");
    await sendCmd("Network.enable");

    // Apply full stealth profile (fingerprint, viewport, anti-detection, geolocation, timezone)
    const stealthInfo = await HumanBehavior.applyStealthProfile(sendCmd);
    app.log.info(
      { ua: stealthInfo.userAgent.substring(0, 50), viewport: `${stealthInfo.viewport.width}x${stealthInfo.viewport.height}` },
      "Stealth profile applied"
    );

    // ─── Vault: Inject external cookies (from authenticated session) ───
    if (body.injectCookies && Array.isArray(body.injectCookies) && body.injectCookies.length > 0) {
      await HumanBehavior.restoreCookies(sendCmd, body.injectCookies as any);
      app.log.info({ count: body.injectCookies.length }, "Injected vault cookies");
    }

    // ─── Camada 3: Restore cached cookies before navigation ───
    const isAmazon = body.url.includes("amazon");
    if (isAmazon && !body.injectCookies) {
      const cachedCookies = cookieCache.get("amazon");
      if (cachedCookies && cachedCookies.length > 0) {
        await HumanBehavior.restoreCookies(sendCmd, cachedCookies as any);
        app.log.info({ count: cachedCookies.length }, "Restored cached Amazon cookies");
      }
    }

    // ─── Camada 3: Realistic navigation with homepage visit ───
    const shouldVisitHomepage = isAmazon && Math.random() > 0.4;

    if (shouldVisitHomepage) {
      // Set referer as if coming from Google
      const searchTerm = body.searchTerm || body.url.match(/[?&]k=([^&]+)/)?.[1];
      const referers = [
        "https://www.google.com/",
        "https://www.google.com.br/",
        searchTerm ? `https://www.google.com.br/search?q=${encodeURIComponent(decodeURIComponent(searchTerm))}` : "",
      ].filter(Boolean);
      const referer = referers[Math.floor(Math.random() * referers.length)];

      await sendCmd("Network.setExtraHTTPHeaders", {
        headers: { Referer: referer },
      });

      // Visit Amazon homepage first
      app.log.info("Visiting Amazon homepage first for realistic browsing pattern");
      const homepageUrl = body.url.includes("amazon.com.br")
        ? "https://www.amazon.com.br/"
        : "https://www.amazon.com/";
      const homeNav = await sendCmd("Page.navigate", { url: homepageUrl });
      if (!(homeNav as any).errorText) {
        await waitForLoad();
        await HumanBehavior.simulateAfterLoad(sendCmd);
      }
    } else if (isAmazon) {
      // Direct navigation but with Google referer
      await sendCmd("Network.setExtraHTTPHeaders", {
        headers: { Referer: "https://www.google.com.br/" },
      });
    }

    // Navigate to actual target URL
    const navResult = await sendCmd("Page.navigate", { url: body.url });
    if ((navResult as any).errorText) {
      pageWs.close();
      return reply.status(400).send({
        success: false,
        error: `Navigation failed: ${(navResult as any).errorText}`,
      });
    }

    // Wait for load event
    await waitForLoad();

    // Simulate human behavior after page loads (mouse, scroll, reading)
    await HumanBehavior.simulateAfterLoad(sendCmd);

    const titleResult = await sendCmd("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    const title =
      (titleResult as any)?.result?.value ?? "Unknown";

    const urlResult = await sendCmd("Runtime.evaluate", {
      expression: "window.location.href",
      returnByValue: true,
    });
    const finalUrl =
      (urlResult as any)?.result?.value ?? body.url;

    // ─── Camada 4: Enhanced block detection ───
    const blockResult = await HumanBehavior.detectBlock(sendCmd);
    let obstacle: { type: string; description: string } | null = null;

    if (blockResult.blocked) {
      obstacle = {
        type: blockResult.type === "captcha" ? "CAPTCHA"
          : blockResult.type === "bot_detection" ? "BOT_DETECTION"
          : blockResult.type === "auth" ? "AUTH"
          : "NAVIGATION",
        description: blockResult.description || "Block detected",
      };
      app.log.warn(
        { blockType: blockResult.type, url: finalUrl },
        "Block detected by human behavior layer"
      );
    } else {
      // Legacy obstacle detection as fallback
      const obstacleResult = await sendCmd("Runtime.evaluate", {
        expression: `(() => {
          const body = document.body?.innerText?.toLowerCase() || '';
          const url = window.location.href;

          if (
            document.querySelector('form[action*="captcha"]') ||
            document.querySelector('#captchacharacters') ||
            body.includes('enter the characters you see below') ||
            body.includes('type the characters') ||
            url.includes('/errors/validateCaptcha')
          ) {
            return JSON.stringify({ type: 'CAPTCHA', description: 'Captcha detectado na página' });
          }

          if (
            document.querySelector('#auth-mfa-otpcode') ||
            document.querySelector('#ap_password') ||
            url.includes('/ap/signin') ||
            url.includes('/ap/mfa')
          ) {
            return JSON.stringify({ type: 'AUTH', description: 'Login ou 2FA necessário' });
          }

          if (
            (body.includes('sorry! something went wrong') && url.includes('amazon')) ||
            body.includes('we could not process your order') ||
            document.querySelector('#error-page')
          ) {
            return JSON.stringify({ type: 'NAVIGATION', description: 'Página de erro ou bloqueio detectado' });
          }

          return JSON.stringify({ type: null });
        })()`,
        returnByValue: true,
      });

      try {
        const parsed = JSON.parse((obstacleResult as any)?.result?.value ?? "{}");
        if (parsed.type) obstacle = parsed;
      } catch {
        // ignore parse errors
      }
    }

    // If obstacle detected, request handoff via PayJarvis API
    let handoff: { handoffId: string; status: string; expiresAt: string } | null = null;
    if (obstacle && connectedBotApiKey && connectedBotId) {
      const apiUrl = process.env.PAYJARVIS_API_URL ?? "http://localhost:3001";
      const botApiKey = connectedBotApiKey;
      const botId = connectedBotId;

      if (botApiKey && botId) {
        try {
          const handoffRes = await fetch(`${apiUrl}/bots/${botId}/request-handoff`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Bot-Api-Key": botApiKey,
            },
            body: JSON.stringify({
              sessionUrl: finalUrl,
              obstacleType: obstacle.type,
              description: `${obstacle.description} — URL: ${finalUrl}`,
            }),
          });
          const handoffData = await handoffRes.json() as any;
          if (handoffData.success) {
            handoff = handoffData.data;
            app.log.info(
              { obstacleType: obstacle.type, handoffId: handoff!.handoffId },
              "Handoff requested — obstacle detected"
            );
          }
        } catch (err) {
          app.log.error({ err, obstacle }, "Failed to request handoff");
        }
      }
    }

    // ─── Camada 3: Save cookies after successful navigation ───
    if (isAmazon && !obstacle) {
      try {
        const cookies = await HumanBehavior.saveCookies(sendCmd);
        if (cookies.length > 0) {
          cookieCache.set("amazon", cookies);
          app.log.info({ count: cookies.length }, "Cached Amazon cookies for session persistence");
        }
      } catch {
        // Non-critical, ignore
      }
    }

    // Wait for product elements to render (poll up to 10s)
    // Try multiple selectors Amazon uses across different layouts
    await sendCmd("Runtime.evaluate", {
      expression: `new Promise(resolve => {
        let attempts = 0;
        const selectors = [
          '[data-component-type="s-search-result"]',
          '[data-asin]:not([data-asin=""])',
          '.s-result-item[data-asin]',
          '.s-main-slot .s-result-item',
        ];
        const check = () => {
          for (const sel of selectors) {
            if (document.querySelectorAll(sel).length > 0) {
              resolve(sel);
              return;
            }
          }
          if (attempts >= 20) {
            resolve('timeout');
          } else {
            attempts++;
            setTimeout(check, 500);
          }
        };
        check();
      })`,
      awaitPromise: true,
      returnByValue: true,
    });

    // Simulate scrolling through products (human would scan results)
    if (isAmazon && !obstacle) {
      await HumanBehavior.humanScroll(sendCmd, 300 + Math.floor(Math.random() * 400));
      await HumanBehavior.delays.betweenProducts();
    }

    // Extract structured products (Amazon search results)
    const productsResult = await sendCmd("Runtime.evaluate", {
      expression: `(() => {
        // Try multiple selectors
        const selectors = [
          '[data-component-type="s-search-result"]',
          '.s-main-slot .s-result-item[data-asin]:not([data-asin=""])',
          '[data-asin]:not([data-asin=""]).s-result-item',
          'div[data-asin]:not([data-asin=""])',
        ];
        let items = [];
        for (const sel of selectors) {
          items = Array.from(document.querySelectorAll(sel));
          if (items.length > 0) break;
        }
        const products = [];
        for (let i = 0; i < Math.min(items.length, 10); i++) {
          const item = items[i];
          // Skip ads/non-product items
          if (!item.getAttribute('data-asin') || item.getAttribute('data-asin') === '') continue;

          // Title: try multiple selectors
          const titleEl = item.querySelector('h2 a span')
            || item.querySelector('h2 span')
            || item.querySelector('[data-cy="title-recipe"] a span')
            || item.querySelector('.a-text-normal');
          const title = titleEl?.textContent?.trim();

          // Price
          const priceEl = item.querySelector('.a-price .a-offscreen');
          let price = priceEl?.textContent?.trim();
          if (!price) {
            const whole = item.querySelector('.a-price-whole')?.textContent?.trim();
            const frac = item.querySelector('.a-price-fraction')?.textContent?.trim();
            if (whole) price = 'R$' + whole + (frac || '00');
          }

          // Link
          const linkEl = item.querySelector('h2 a') || item.querySelector('a.a-link-normal[href*="/dp/"]');
          const link = linkEl?.href;

          // Rating & reviews
          const rating = item.querySelector('.a-icon-alt')?.textContent?.trim();
          const reviews = item.querySelector('.a-size-base.s-underline-text')?.textContent?.trim()
            || item.querySelector('[aria-label*="stars"] + span')?.textContent?.trim();

          // Image
          const image = item.querySelector('img.s-image')?.src
            || item.querySelector('img[data-image-latency]')?.src;

          // ASIN
          const asin = item.getAttribute('data-asin');

          if (title) {
            products.push({ title, price: price || null, link, rating, reviews, image, asin });
          }
        }
        return JSON.stringify(products);
      })()`,
      returnByValue: true,
    });
    let products: unknown[] = [];
    try {
      const raw = (productsResult as any)?.result?.value;
      if (raw) products = JSON.parse(raw);
    } catch {
      // Not a search page or no products found
    }

    const contentResult = await sendCmd("Runtime.evaluate", {
      expression:
        "(document.body?.innerText || '').substring(0, 2000)",
      returnByValue: true,
    });
    const content =
      (contentResult as any)?.result?.value ?? "";

    // Close page-level WS
    pageWs.close();

    const sessionInfo = HumanBehavior.getSessionInfo();
    app.log.info(
      { url: body.url, finalUrl, title, productCount: products.length, ...sessionInfo },
      "Navigation completed"
    );

    return {
      success: true,
      title,
      url: finalUrl,
      products,
      content: products.length > 0 ? undefined : content,
      obstacle: obstacle ?? undefined,
      handoff: handoff ?? undefined,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Navigation failed";
    app.log.error({ err, url: body.url }, "Navigation error");
    return reply.status(500).send({
      success: false,
      error: message,
    });
  }
});


// ─── Vault: Extract cookies from current CDP session ──

/** Extract cookies from the browser for vault storage */
app.post("/extract-cookies", async (request, reply) => {
  const body = request.body as { domain?: string };

  if (!cdpMonitor?.isConnected) {
    return reply.status(400).send({
      success: false,
      error: "CDP not connected.",
    });
  }

  try {
    const targetsRes = await fetch(
      `http://localhost:${cdpMonitor.cdpPort}/json/list`
    );
    const targets = (await targetsRes.json()) as Array<{
      id: string;
      type: string;
      webSocketDebuggerUrl?: string;
    }>;
    const pageTarget = targets.find((t) => t.type === "page");

    if (!pageTarget?.webSocketDebuggerUrl) {
      return reply.status(500).send({
        success: false,
        error: "No page target available",
      });
    }

    const { default: WS } = await import("ws");
    const ws = new WS(pageTarget.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS timeout")), 5000);
      ws.on("open", () => { clearTimeout(timeout); resolve(); });
      ws.on("error", (err: Error) => { clearTimeout(timeout); reject(err); });
    });

    let msgId = 0;
    const sendWsCmd = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = ++msgId;
        const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000);
        const handler = (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            clearTimeout(timeout);
            ws.off("message", handler);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result ?? {});
          }
        };
        ws.on("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await sendWsCmd("Network.enable");
    const cookies = await HumanBehavior.saveCookies(sendWsCmd);

    // Get user agent
    const uaResult = await sendWsCmd("Runtime.evaluate", {
      expression: "navigator.userAgent",
      returnByValue: true,
    });
    const userAgent = (uaResult as any)?.result?.value ?? "";

    ws.close();

    // Filter by domain if specified
    const filtered = body.domain
      ? cookies.filter((c: any) => c.domain?.includes(body.domain))
      : cookies;

    app.log.info(
      { total: cookies.length, filtered: filtered.length, domain: body.domain },
      "Cookies extracted"
    );

    return reply.send({
      success: true,
      cookies: filtered,
      userAgent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to extract cookies";
    app.log.error({ err }, "Cookie extraction error");
    return reply.status(500).send({ success: false, error: message });
  }
});

// ─── Layer 4: Browserbase Routes ─────────────────────

/** Create a Browserbase cloud browser session */
app.post("/browser/session/create", async (request, reply) => {
  if (!bbIsConfigured()) {
    return reply.status(503).send({
      success: false,
      error: "Browserbase is not configured (missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID)",
    });
  }

  const body = request.body as {
    keepAlive?: boolean;
    proxies?: boolean;
    timeout?: number;
    region?: string;
  } | undefined;

  try {
    const result = await bbCreateSession({
      keepAlive: body?.keepAlive,
      proxies: body?.proxies,
      timeout: body?.timeout,
      region: body?.region as any,
    });

    app.log.info(
      { sessionId: result.sessionId },
      "Browserbase session created"
    );

    return {
      success: true,
      data: {
        sessionId: result.sessionId,
        connectUrl: result.connectUrl,
        status: result.session.status,
        expiresAt: result.session.expiresAt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    app.log.error({ err }, "Browserbase session creation failed");
    return reply.status(500).send({ success: false, error: message });
  }
});

/** Get live view URL for a session */
app.get("/browser/session/:id/live", async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    const liveURLs = await bbGetLiveURLs(id);
    return {
      success: true,
      data: {
        sessionId: id,
        debuggerUrl: liveURLs.debuggerUrl,
        debuggerFullscreenUrl: liveURLs.debuggerFullscreenUrl,
        wsUrl: liveURLs.wsUrl,
        pages: liveURLs.pages,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get live URLs";
    return reply.status(500).send({ success: false, error: message });
  }
});

/** Close a Browserbase session */
app.post("/browser/session/:id/close", async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    const session = await bbCloseSession(id);
    app.log.info({ sessionId: id }, "Browserbase session closed");
    return {
      success: true,
      data: { sessionId: id, status: session.status },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to close session";
    return reply.status(500).send({ success: false, error: message });
  }
});

/** Initiate assisted fallback for an action */
app.post("/browser/fallback", async (request, reply) => {
  if (!bbIsConfigured()) {
    return reply.status(503).send({
      success: false,
      error: "Browserbase is not configured",
    });
  }

  const body = request.body as {
    botId: string;
    url: string;
    task: string;
    params?: Record<string, unknown>;
  };

  if (!body.botId || !body.url || !body.task) {
    return reply.status(400).send({
      success: false,
      error: "botId, url, and task are required",
    });
  }

  try {
    const result = await assistedFallback(body.botId, {
      url: body.url,
      task: body.task,
      params: body.params,
    });

    app.log.info(
      {
        sessionId: result.sessionId,
        status: result.status,
        botId: body.botId,
        task: body.task,
      },
      "Assisted fallback completed"
    );

    // If needs handoff, automatically request it
    if (result.status === "NEEDS_HANDOFF" && result.result) {
      const obstacleResult = result.result as {
        obstacleType?: string;
        description?: string;
        currentUrl?: string;
      };

      const handoff = await requestHandoff(
        result.sessionId,
        body.botId,
        {
          type: (obstacleResult.obstacleType as ObstacleType) ?? "OTHER",
          description: obstacleResult.description,
          currentUrl: obstacleResult.currentUrl,
        }
      );

      return {
        success: true,
        data: {
          ...result,
          handoff,
        },
      };
    }

    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fallback failed";
    app.log.error({ err, botId: body.botId }, "Assisted fallback error");
    return reply.status(500).send({ success: false, error: message });
  }
});

/** Transfer control to user (request handoff) */
app.post("/browser/handoff/:sessionId", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as {
    botId: string;
    obstacleType?: string;
    description?: string;
    currentUrl?: string;
  };

  if (!body.botId) {
    return reply.status(400).send({
      success: false,
      error: "botId is required",
    });
  }

  try {
    const result = await requestHandoff(sessionId, body.botId, {
      type: (body.obstacleType as ObstacleType) ?? "OTHER",
      description: body.description,
      currentUrl: body.currentUrl,
    });

    if (result.success) {
      app.log.info(
        {
          sessionId,
          handoffId: result.handoffId,
          obstacleType: result.obstacleType,
        },
        "Handoff requested"
      );
    }

    return { success: result.success, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Handoff failed";
    app.log.error({ err, sessionId }, "Handoff error");
    return reply.status(500).send({ success: false, error: message });
  }
});

/** List active Browserbase sessions */
app.get("/browser/sessions", async (_request, reply) => {
  if (!bbIsConfigured()) {
    return reply.status(503).send({
      success: false,
      error: "Browserbase is not configured",
    });
  }

  try {
    const sessions = await bbListSessions();
    return {
      success: true,
      data: {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          status: s.status,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          region: s.region,
        })),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list sessions";
    return reply.status(500).send({ success: false, error: message });
  }
});

// ─── Register scrape bridge ──────────────────────────

await app.register(scrapeRoutes);
await app.register(amazonLoginRoutes);
await app.register(storeActionRoutes);

// ─── BrowserBase checkout routes ─────────────────────
import { bbCheckoutRoutes } from "./routes/bb-checkout.js";
await app.register(bbCheckoutRoutes);

// ─── Fill Form endpoint ─────────────────────────────

app.post("/fill-form", async (request, reply) => {
  const body = request.body as {
    url: string;
    fields: Record<string, string>;
    instructions?: string;
  };

  if (!body.url || !body.fields) {
    return reply.status(400).send({
      success: false,
      error: "url and fields are required",
    });
  }

  try {
    // Try using Browserbase (cloud Playwright)
    const { chromium } = await import("playwright-core");
    const {
      createSession,
      isConfigured,
    } = await import("./services/browserbase-client.js");

    if (!isConfigured()) {
      return reply.status(503).send({
        success: false,
        error: "Browserbase not configured — form filling requires cloud browser",
      });
    }

    const session = await createSession();
    let browser;
    try {
      browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30000 });
      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      // Navigate to URL
      await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      // Fill fields
      const filledFields: string[] = [];
      const failedFields: string[] = [];

      for (const [key, value] of Object.entries(body.fields)) {
        try {
          // Try multiple strategies to find and fill the field
          const selectors = [
            `input[name="${key}"]`,
            `textarea[name="${key}"]`,
            `select[name="${key}"]`,
            `input[id="${key}"]`,
            `textarea[id="${key}"]`,
            `input[placeholder*="${key}" i]`,
            `textarea[placeholder*="${key}" i]`,
            `input[aria-label*="${key}" i]`,
            `label:has-text("${key}") + input`,
            `label:has-text("${key}") + textarea`,
            `label:has-text("${key}") + select`,
          ];

          let filled = false;
          for (const selector of selectors) {
            try {
              const el = page.locator(selector).first();
              if (await el.isVisible({ timeout: 1000 })) {
                const tagName = await el.evaluate((e: Element) => e.tagName.toLowerCase());
                if (tagName === "select") {
                  await el.selectOption({ label: value }).catch(() => el.selectOption(value));
                } else {
                  await el.fill(value);
                }
                filledFields.push(key);
                filled = true;
                break;
              }
            } catch {
              continue;
            }
          }

          if (!filled) {
            failedFields.push(key);
          }
        } catch {
          failedFields.push(key);
        }
      }

      const currentUrl = page.url();

      await browser.close().catch(() => {});

      return {
        success: true,
        url: currentUrl,
        filledFields,
        failedFields,
        message: failedFields.length > 0
          ? `Filled ${filledFields.length} fields. Could not find: ${failedFields.join(", ")}`
          : `All ${filledFields.length} fields filled successfully. Form NOT submitted — waiting for user confirmation.`,
      };
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Form filling failed";
    app.log.error({ err, url: body.url }, "Fill form error");
    return reply.status(500).send({ success: false, error: message });
  }
});

// ─── Start ───────────────────────────────────────────

const port = parseInt(
  process.env.BROWSER_AGENT_PORT ?? "3003",
  10
);

try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`PayJarvis Browser Agent listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// ─── Auto-connect CDP on boot ─────────────────────────
const autoConnectBotApiKey = process.env.BROWSER_AGENT_BOT_API_KEY;
const autoConnectBotId = process.env.BROWSER_AGENT_BOT_ID;
const autoConnectCdpPort = parseInt(process.env.OPENCLAW_CDP_PORT ?? "18800", 10);

if (autoConnectBotApiKey && autoConnectBotId) {
  setTimeout(async () => {
    try {
      const res = await app.inject({
        method: "POST",
        url: "/connect",
        payload: {
          port: autoConnectCdpPort,
          botApiKey: autoConnectBotApiKey,
          botId: autoConnectBotId,
        },
      });
      const data = JSON.parse(res.body);
      if (data.success) {
        app.log.info({ port: autoConnectCdpPort }, "Auto-connect CDP succeeded");
      } else {
        app.log.warn({ error: data.error }, "Auto-connect CDP failed — Chrome may not be running yet");
      }
    } catch (err) {
      app.log.warn({ err }, "Auto-connect CDP error");
    }
  }, 2000);
}
