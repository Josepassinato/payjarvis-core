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
  }

  return { success: true, data: { connected: false } };
});

/** Status do agente */
app.get("/status", async () => ({
  connected: cdpMonitor?.isConnected ?? false,
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
