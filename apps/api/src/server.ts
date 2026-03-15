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
import { agentRoutes } from "./routes/agents.js";
import { commerceRoutes } from "./routes/commerce.js";
import { composioRoutes } from "./routes/composio.js";
import { coreRoutes } from "./routes/core.js";
import { instanceRoutes } from "./routes/instances.js";
import { trackingRoutes } from "./routes/tracking.js";
import { retailRoutes } from "./routes/retail.routes.js";
import { transitRoutes } from "./routes/transit.routes.js";
import { vaultRoutes } from "./routes/vault.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { storeRoutes } from "./routes/stores.js";
import { botShareRoutes } from "./routes/bot-share.js";
import { onboardingBotRoutes } from "./routes/onboarding-bot.js";
import { stripeWebhookRoutes } from "./routes/stripe-webhook.js";
import { whatsappWebhookRoutes } from "./routes/whatsapp-webhook.js";
import { creditRoutes } from "./routes/credits.js";
import { sequenceRoutes } from "./routes/sequence.js";
import { subscriptionRoutes } from "./routes/subscription.js";
import { startTimeoutChecker } from "./core/approval-manager.js";

// Cron jobs
import "./jobs/sequence-cron.js";
import "./jobs/trial-cron.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

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

// Core — Layer 1: policy, approvals, audit, sessions
await app.register(coreRoutes);

// Commerce — flights, hotels, restaurants, events, transport, delivery
await app.register(commerceRoutes);

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

// WhatsApp Webhook — Twilio sandbox, Jarvis AI responses
await app.register(whatsappWebhookRoutes);

// Credits — LLM message billing, packages, balance
await app.register(creditRoutes);

// Onboarding Sequence — drip banners over 60 days
await app.register(sequenceRoutes);

// Subscription — Jarvis Premium $20/month
await app.register(subscriptionRoutes);

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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
