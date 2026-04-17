/**
 * Celcoin PIX Iniciador — consent flow + payment endpoints.
 *
 * Usage (B2C flow from Sniffer):
 *   1. Sniffer POST /api/celcoin/consents → returns authorizationUrl
 *   2. User is redirected to their bank (Itaú, Nubank, etc), approves consent
 *   3. Bank redirects to callback → PayJarvis marks consent as AUTHORIZED
 *   4. For each purchase, Sniffer POST /api/celcoin/payments with consentId
 *   5. Webhook /api/webhooks/celcoin updates payment status
 */
import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { CelcoinProvider } from "../services/payments/providers/celcoin.provider.js";

const celcoin = new CelcoinProvider();

export async function celcoinRoutes(app: FastifyInstance) {
  app.get("/api/celcoin/status", async () => {
    const s = await celcoin.getAccountStatus("");
    return { success: true, ...s };
  });

  app.post("/api/celcoin/consents", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const body = request.body as {
      userId?: string;
      cpf?: string;
      userName?: string;
      callbackUrl?: string;
      validityDays?: number;
    };
    if (!body?.userId || !body?.cpf || !body?.userName || !body?.callbackUrl) {
      return reply.status(400).send({
        success: false,
        error: "userId, cpf, userName, callbackUrl required",
      });
    }
    try {
      const consent = await celcoin.createConsent(body as any);
      return { success: true, data: consent };
    } catch (err: any) {
      return reply.status(502).send({ success: false, error: err.message });
    }
  });

  app.get("/api/celcoin/consents/:id", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const s = await celcoin.getConsentStatus(id);
      return { success: true, data: s };
    } catch (err: any) {
      return reply.status(502).send({ success: false, error: err.message });
    }
  });

  app.post("/api/celcoin/payments", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const body = request.body as {
      consentId?: string;
      amount?: number;
      recipientPixKey?: string;
      recipientName?: string;
      recipientDocument?: string;
      description?: string;
      endToEndId?: string;
    };
    if (!body?.consentId || !body?.amount || !body?.recipientPixKey) {
      return reply.status(400).send({
        success: false,
        error: "consentId, amount, recipientPixKey required",
      });
    }
    try {
      const res = await celcoin.initiatePix(body as any);
      return { success: true, data: res };
    } catch (err: any) {
      return reply.status(502).send({ success: false, error: err.message });
    }
  });

  app.get("/api/celcoin/payments/:id", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const s = await celcoin.getPaymentStatus(id);
      return { success: true, data: s };
    } catch (err: any) {
      return reply.status(502).send({ success: false, error: err.message });
    }
  });

  // Public webhook — Celcoin notifies payment status changes
  app.post("/api/webhooks/celcoin", async (request, reply) => {
    const body = request.body as any;
    app.log.info({ celcoin_webhook: body }, "received celcoin webhook");
    // TODO: verify webhook signature (Celcoin provides HMAC-SHA256 in X-Celcoin-Signature)
    // TODO: update transaction/approval status based on body.status
    return reply.send({ received: true });
  });
}
