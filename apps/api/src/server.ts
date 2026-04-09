import './sentry.js';
import Sentry from './sentry.js';

import { readFileSync as readEnvFile } from "fs";
import { resolve as resolvePath } from "path";
// Load .env from monorepo root (PM2 cwd may not be project root)
try {
  const envPath = resolvePath(import.meta.dirname, "../../../.env");
  const envContent = readEnvFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx);
    const val = trimmed.substring(eqIdx + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key] || process.env[key] === "") process.env[key] = val;
  }
} catch { /* .env not found, use existing env */ }

import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { healthRoutes } from "./routes/health.js";
import { jwksRoutes } from "./routes/jwks.js";
import { botRoutes } from "./routes/bots.js";
import { policyRoutes } from "./routes/policies.js";
import { paymentRoutes } from "./routes/payments.js";
import { approvalRoutes } from "./routes/approvals.js";
import { transactionRoutes } from "./routes/transactions.js";
import { publicVerifyRoutes } from "./routes/v1/verify.js";
import { platformRoutes } from "./routes/v1/platform.js";
import { merchantRoutes } from "./routes/merchant.js";
import { integrationRoutes } from "./routes/integrations.js";
import { notificationRoutes } from "./routes/notifications.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { handoffRoutes } from "./routes/handoffs.js";
import { onboardingRoutes } from "./routes/onboarding.routes.js";
import { paymentMethodRoutes } from "./routes/payment-methods.js";
import { paymentProcessingRoutes } from "./routes/payment-processing.js";
import { agentRoutes } from "./routes/agents.js";
import { commerceRoutes } from "./routes/commerce.js";
import { hotelRoutes } from "./routes/hotels.js";
import { restaurantRoutes } from "./routes/restaurants.js";
import { flightRoutes } from "./routes/flights.js";
import { eventRoutes } from "./routes/events.js";
import { productRoutes } from "./routes/products.js";
import { composioRoutes } from "./routes/composio.js";
import { coreRoutes } from "./routes/core.js";
import { instanceRoutes } from "./routes/instances.js";
import { trackingRoutes } from "./routes/tracking.js";
import { retailRoutes } from "./routes/retail.routes.js";
import { transitRoutes } from "./routes/transit.routes.js";
import { weatherRoutes } from "./routes/weather.js";
import { sportsRoutes } from "./routes/sports.js";
import { vaultRoutes } from "./routes/vault.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { storeRoutes } from "./routes/stores.js";
import { botShareRoutes } from "./routes/bot-share.js";
import { onboardingBotRoutes } from "./routes/onboarding-bot.js";
import { stripeWebhookRoutes } from "./routes/stripe-webhook.js";
import { whatsappWebhookRoutes } from "./routes/whatsapp-webhook.js";
import { referralRoutes } from "./routes/referrals.js";
import { promoRoutes } from "./routes/promo.js";
import { creditRoutes } from "./routes/credits.js";
import { sequenceRoutes } from "./routes/sequence.js";
import { subscriptionRoutes } from "./routes/subscription.js";
import { startTimeoutChecker } from "./core/approval-manager.js";
import { adminAuthRoutes } from "./routes/admin/admin-auth.js";
import { adminOverviewRoutes } from "./routes/admin/admin-overview.js";
import { adminUsersRoutes } from "./routes/admin/admin-users.js";
import { adminBroadcastRoutes } from "./routes/admin/admin-broadcast.js";
import { adminRevenueRoutes } from "./routes/admin/admin-revenue.js";
import { adminSentinelRoutes } from "./routes/admin/admin-sentinel.js";
import { adminCfoRoutes } from "./routes/admin/admin-cfo.js";
import { adminResilienceRoutes } from "./routes/admin/admin-resilience.js";
import { adminInnerCircleRoutes } from "./routes/admin/admin-inner-circle.js";
import { adminGrowthRoutes } from "./routes/admin/admin-growth.js";
import { adminSniffershopRoutes } from "./routes/admin/admin-sniffershop.js";
import { mastercardRoutes } from "./routes/mastercard.routes.js";
import { visaRoutes } from "./routes/visa.routes.js";
import { shoppingConfigRoutes } from "./routes/shopping-config.js";
import { shoppingPlannerRoutes } from "./routes/shopping-planner.routes.js";
import { webChatRoutes } from "./routes/web-chat.js";
import { voiceRoutes } from "./routes/voice.js";
import { voiceAgentRoutes } from "./routes/voice-agent.js";
import { recordingRoutes } from "./routes/recordings.js";
import { engagementRoutes } from "./routes/engagement.js";
import { butlerRoutes } from "./routes/butler.js";
import { innerCircleRoutes } from "./routes/inner-circle.js";
import { scheduledTaskRoutes } from "./routes/scheduled-tasks.js";
import skyfireRoutes from "./routes/skyfire.js";
import { glassesRoutes } from "./routes/glasses.js";
import addressRoutes from "./routes/addresses.js";
import { customServicesRoutes } from "./routes/custom-services.js";
import { githubWebhookRoutes } from "./routes/github-webhook.js";
import { couponHunterRoutes } from "./routes/coupon-hunter.routes.js";
import { rateLimiter, webhookRateLimiter } from "./middleware/rate-limiter.js";

// Cron jobs
import "./jobs/sequence-cron.js";
import "./jobs/trial-cron.js";
import "./jobs/engagement-cron.js";
import "./jobs/scheduled-tasks-cron.js";
import "./jobs/watchdog-cron.js";
import "./jobs/deals-channel-cron.js";
import "./jobs/coupon-hunter-cron.js";
import "./jobs/leaderboard-cron.js";
import "./jobs/quarterly-report-cron.js";
import { startPriceAlertCron } from "./services/search/price-alert-cron.js";
startPriceAlertCron();

const REDACTED_FIELDS = ["password", "encryptedPassword", "ssn", "creditCard", "pin", "secret", "token", "cookiesEnc"];

function redactSensitiveFields(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields);
  const redacted: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactSensitiveFields(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

const app = Fastify({
  logger: process.env.NODE_ENV === "production"
    ? {
        level: "warn",
        serializers: {
          req(request: any) {
            return {
              method: request.method,
              url: request.url,
              hostname: request.hostname,
              remoteAddress: request.ip,
            };
          },
          res(reply: any) {
            return { statusCode: reply.statusCode };
          },
        },
      }
    : {
        serializers: {
          req(request: any) {
            return {
              method: request.method,
              url: request.url,
              hostname: request.hostname,
              remoteAddress: request.ip,
              body: request.body ? redactSensitiveFields(request.body) : undefined,
            };
          },
          res(reply: any) {
            return { statusCode: reply.statusCode };
          },
        },
      },
});

// Sentry error handler — captures all unhandled route errors
app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  Sentry.captureException(error, {
    extra: {
      method: request.method,
      url: request.url,
      params: request.params,
      query: request.query,
    },
  });
  app.log.error(error);
  reply.status(error.statusCode ?? 500).send({
    error: error.message || 'Internal Server Error',
  });
});

const allowedOrigins = [
  "https://payjarvis.com",
  "https://www.payjarvis.com",
  "https://admin.payjarvis.com",
];

await app.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  credentials: true,
});

// Rate limiter — applies to all /api/ routes
app.addHook("onRequest", async (req, reply) => {
  // Skip health, static, JWKS, webhooks (webhooks have their own limiter)
  if (req.url === "/health" || req.url.startsWith("/.well-known") || req.url === "/adapter.js") return;
  if (req.url.startsWith("/webhook/")) return; // Webhooks use webhookRateLimiter
  if (req.url.startsWith("/api/")) {
    await rateLimiter(req, reply);
  }
});

// Register all routes
await app.register(healthRoutes);
await app.register(jwksRoutes);
await app.register(botRoutes);
await app.register(policyRoutes);
await app.register(paymentRoutes);
await app.register(approvalRoutes);
await app.register(transactionRoutes);
await app.register(notificationRoutes);
await app.register(analyticsRoutes);
await app.register(handoffRoutes);

// Agent identity layer
await app.register(agentRoutes);

// Public identity layer (v1)
await app.register(publicVerifyRoutes);
await app.register(platformRoutes);
await app.register(merchantRoutes);
await app.register(integrationRoutes);
await app.register(paymentMethodRoutes);
await app.register(paymentProcessingRoutes);

// Core — Layer 1: policy, approvals, audit, sessions
await app.register(coreRoutes);

// Commerce — flights, hotels, restaurants, events, transport, delivery
await app.register(commerceRoutes);

// Hotels — direct hotel endpoints (search, offer details, booking stub)
await app.register(hotelRoutes);

// Restaurants — direct restaurant endpoints (search, details, reservation)
await app.register(restaurantRoutes);

// Flights — direct flight search endpoints
await app.register(flightRoutes);

// Events — direct event search endpoints (Ticketmaster)
await app.register(eventRoutes);

// Products — Mercado Libre + eBay product search
await app.register(productRoutes);

// Composio — Gmail, Google Calendar, Slack integrations
await app.register(composioRoutes);

// Instance management — slot manager, user router, spawner
await app.register(instanceRoutes);

// Tracking — package tracking (Correios, USPS, FedEx, etc)
await app.register(trackingRoutes);

// Retail — Walmart, CVS, Walgreens, Target, Publix, Macy's
await app.register(retailRoutes);

// Transit — Amtrak, FlixBus, Greyhound
await app.register(transitRoutes);

// Weather — Open-Meteo (free, no API key)
await app.register(weatherRoutes);

// Sports — ESPN scores and standings (free, no API key)
await app.register(sportsRoutes);

// Vault — encrypted session storage (Amazon, etc.)
await app.register(vaultRoutes);

// Amazon Checkout — real purchases via authenticated sessions
await app.register(checkoutRoutes);

// Connected Stores — universal store management (Browserbase Contexts)
await app.register(storeRoutes);

// Onboarding — platform detection and integration guides
await app.register(onboardingRoutes);

// Bot Share — viral sharing links, QR codes, cloning
await app.register(botShareRoutes);

// Onboarding Bot — conversational onboarding via Telegram/WhatsApp
await app.register(onboardingBotRoutes);

// Stripe Webhook — setup_intent.succeeded, payment confirmations
await app.register(stripeWebhookRoutes);

// GitHub Webhook — CI failure auto-fix
await app.register(githubWebhookRoutes);

// WhatsApp Webhook — Twilio production, Jarvis AI responses
await app.register(whatsappWebhookRoutes);

// Referrals — direct WhatsApp invite via Twilio template
await app.register(referralRoutes);
await app.register(promoRoutes);

// Credits — LLM message billing, packages, balance
await app.register(creditRoutes);

// Onboarding Sequence — drip banners (Beta phase)
await app.register(sequenceRoutes);

// Subscription — Jarvis Premium $20/month
await app.register(subscriptionRoutes);

// Mastercard — Buyer Payment Agent + MDES Token Requestor
await app.register(mastercardRoutes);

// Visa — Click to Pay (Secure Remote Commerce) SDK config + checkout
await app.register(visaRoutes);

// Shopping Config — setup-shopping wizard (limits, categories, card)
await app.register(shoppingConfigRoutes);

// Shopping Planner — intelligent shopping plan generation
await app.register(shoppingPlannerRoutes);

// Web Chat — PWA chat interface (same Jarvis pipeline as WhatsApp/Telegram)
await app.register(webChatRoutes);

// Voice Calls — Twilio outbound calls, AI conversations
await app.register(voiceRoutes);

// Voice Agent — Grok Voice Agent (realtime AI calls) + MCP endpoint
await app.register(voiceAgentRoutes);

// Call Recordings — Twilio webhook, admin listing, user recordings
await app.register(recordingRoutes);

// Engagement — proactive messages, gamification, push notifications, preferences
await app.register(engagementRoutes);

// Butler Protocol 🎩 — profile vault, credentials, account creation
await app.register(butlerRoutes);

// Inner Circle — specialist referral network
await app.register(innerCircleRoutes);

// Scheduled Tasks — user-created recurring jobs (news, prices, weather, etc.)
await app.register(scheduledTaskRoutes);

// Skyfire — wallet-based payments, purchase tracking, webhooks
await app.register(skyfireRoutes);

// Glasses — AI product identification via camera/image (Gemini Vision)
await app.register(glassesRoutes);

// Addresses & KYC — structured US/BR addresses + KYC profile
await app.register(addressRoutes);

// Custom Services — self-configuration engine (user-provided APIs + automations)
await app.register(customServicesRoutes);

// Coupon Hunter — deal monitoring, wish list, coupon search
await app.register(couponHunterRoutes);

// Admin Dashboard — separate auth, overview, users, broadcast, revenue
await app.register(adminAuthRoutes);
await app.register(adminOverviewRoutes);
await app.register(adminUsersRoutes);
await app.register(adminBroadcastRoutes);
await app.register(adminRevenueRoutes);
await app.register(adminSentinelRoutes);
await app.register(adminCfoRoutes);
await app.register(adminResilienceRoutes);
await app.register(adminInnerCircleRoutes);
await app.register(adminGrowthRoutes);
await app.register(adminSniffershopRoutes);

// Static files — banners, public assets
const publicDir = join(process.cwd(), "public");
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/public/",
    decorateReply: false,
  });
}

// Serve adapter.js for merchant integration
app.get("/adapter.js", async (request, reply) => {
  const script = `
(function() {
  'use strict';
  var merchantId = document.currentScript.getAttribute('data-merchant');
  if (!merchantId) { console.error('[PayJarvis] data-merchant required'); return; }
  window.PayJarvis = {
    merchantId: merchantId,
    verify: function(token) {
      var parts = token.split('.');
      if (parts.length !== 3) return Promise.resolve({ valid: false, reason: 'Invalid format' });
      try {
        var payload = JSON.parse(atob(parts[1]));
        if (payload.merchant_id !== merchantId) return Promise.resolve({ valid: false, reason: 'Merchant mismatch' });
        if (payload.exp * 1000 < Date.now()) return Promise.resolve({ valid: false, reason: 'Expired' });
        return Promise.resolve({ valid: true, bot: payload });
      } catch(e) { return Promise.resolve({ valid: false, reason: e.message }); }
    },
    extractToken: function() {
      return new URLSearchParams(window.location.search).get('payjarvis_token') || null;
    }
  };
})();`;
  return reply
    .header("Content-Type", "application/javascript")
    .header("Cache-Control", "public, max-age=3600")
    .send(script);
});

const port = parseInt(process.env.API_PORT ?? "3001", 10);

try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`PayJarvis API listening on port ${port}`);
  startTimeoutChecker();

  // ─── WebSocket upgrade for Grok Voice Agent MediaStream ───
  // Twilio sends audio via WebSocket to /api/voice/agent/stream/:callId
  // We handle the HTTP upgrade manually since Fastify doesn't natively support WS
  const { WebSocketServer } = await import("ws");
  const { handleMediaStream } = await import("./services/voice/grok-voice-agent.service.js");

  const voiceAgentWss = new WebSocketServer({ noServer: true });

  voiceAgentWss.on("connection", async (ws, req) => {
    const url = req.url || "";
    const match = url.match(/\/api\/voice\/agent\/stream\/([^/?]+)/);
    const callId = match?.[1];
    if (!callId) {
      console.warn("[VOICE-AGENT-WS] No callId in URL, closing");
      ws.close();
      return;
    }
    try {
      await handleMediaStream(ws, callId);
    } catch (err) {
      console.error(`[VOICE-AGENT-WS] Error handling stream for ${callId}:`, (err as Error).message);
      ws.close();
    }
  });

  // Attach to Fastify's underlying HTTP server
  const httpServer = app.server;
  httpServer.on("upgrade", (request, socket, head) => {
    const url = request.url || "";
    if (url.startsWith("/api/voice/agent/stream/")) {
      voiceAgentWss.handleUpgrade(request, socket, head, (ws) => {
        voiceAgentWss.emit("connection", ws, request);
      });
    }
    // Other upgrade requests are ignored (handled by other middleware if any)
  });

  // Seed call playbooks (idempotent — upserts)
  import("./services/voice/call-playbooks.service.js")
    .then(m => m.seedPlaybooks())
    .catch(err => console.error("[PLAYBOOK] Seed failed:", err.message));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
