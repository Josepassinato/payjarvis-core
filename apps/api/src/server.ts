import Fastify from "fastify";
import cors from "@fastify/cors";
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

// Public identity layer (v1)
await app.register(publicVerifyRoutes);
await app.register(platformRoutes);
await app.register(merchantRoutes);
await app.register(integrationRoutes);

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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
