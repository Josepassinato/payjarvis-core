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

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// ─── State ───────────────────────────────────────────

let cdpMonitor: CdpMonitor | null = null;
let interceptor: PayjarvisInterceptor | null = null;
let lastActivity: Date | null = null;
let connectedBotApiKey: string | null = null;
let connectedBotId: string | null = null;
const detector = new CheckoutDetector();

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

/** Navegar para uma URL no Chrome via CDP */
app.post("/navigate", async (request, reply) => {
  const body = request.body as { url: string; botId?: string };

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

    // Enable Page and Network events
    await sendCmd("Page.enable");
    await sendCmd("Network.enable");

    // Override User-Agent to avoid headless detection
    await sendCmd("Network.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      acceptLanguage: "en-US,en;q=0.9",
      platform: "Win32",
    });

    // Disable webdriver flag
    await sendCmd("Page.addScriptToEvaluateOnNewDocument", {
      source:
        "Object.defineProperty(navigator, 'webdriver', { get: () => false });",
    });

    // Navigate
    const navResult = await sendCmd("Page.navigate", { url: body.url });
    if ((navResult as any).errorText) {
      pageWs.close();
      return reply.status(400).send({
        success: false,
        error: `Navigation failed: ${(navResult as any).errorText}`,
      });
    }

    // Wait for load event (timeout 15s)
    await new Promise<void>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 15000);
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === "Page.loadEventFired") {
          clearTimeout(timeout);
          pageWs.off("message", handler);
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }
      };
      pageWs.on("message", handler);
    });

    // Wait for JS rendering then extract page info
    await new Promise((r) => setTimeout(r, 1000));

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

    // ─── Detect obstacles (CAPTCHA, 2FA, login, errors) ───
    const obstacleResult = await sendCmd("Runtime.evaluate", {
      expression: `(() => {
        const body = document.body?.innerText?.toLowerCase() || '';
        const url = window.location.href;

        // CAPTCHA
        if (
          document.querySelector('form[action*="captcha"]') ||
          document.querySelector('#captchacharacters') ||
          body.includes('enter the characters you see below') ||
          body.includes('type the characters') ||
          url.includes('/errors/validateCaptcha')
        ) {
          return JSON.stringify({ type: 'CAPTCHA', description: 'Captcha detectado na página' });
        }

        // 2FA / Login required
        if (
          document.querySelector('#auth-mfa-otpcode') ||
          document.querySelector('#ap_password') ||
          url.includes('/ap/signin') ||
          url.includes('/ap/mfa')
        ) {
          return JSON.stringify({ type: 'AUTH', description: 'Login ou 2FA necessário' });
        }

        // Checkout / navigation errors
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

    let obstacle: { type: string; description: string } | null = null;
    try {
      const parsed = JSON.parse((obstacleResult as any)?.result?.value ?? "{}");
      if (parsed.type) obstacle = parsed;
    } catch {
      // ignore parse errors
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
            if (whole) price = '$' + whole + (frac || '00');
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

    app.log.info(
      { url: body.url, finalUrl, title, productCount: products.length },
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
