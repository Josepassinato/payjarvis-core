/**
 * Mastercard Routes — Buyer Payment Agent + MDES Token Requestor
 *
 * GET  /api/mastercard/status      — Integration status check
 * POST /api/mastercard/tokenize    — Tokenize card (FPAN → DPAN)
 * POST /api/mastercard/payment     — Execute payment via token
 * GET  /api/mastercard/token/:ref  — Get token status
 * DELETE /api/mastercard/token/:ref — Delete token
 * POST /api/webhooks/mastercard    — Mastercard webhook receiver
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { mastercardService } from "../services/mastercard.service.js";

export async function mastercardRoutes(app: FastifyInstance) {
  // Status — public (no auth) for health checks
  app.get("/api/mastercard/status", async (_request, reply) => {
    const result = await mastercardService.testConnection();
    return reply.send({ success: true, ...result });
  });

  // Tokenize card — requires auth
  app.post(
    "/api/mastercard/tokenize",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { cardNumber, expiryMonth, expiryYear, cardholderName } =
        request.body as {
          cardNumber?: string;
          expiryMonth?: string;
          expiryYear?: string;
          cardholderName?: string;
        };

      if (!cardNumber || !expiryMonth || !expiryYear) {
        return reply
          .status(400)
          .send({ success: false, error: "cardNumber, expiryMonth, expiryYear required" });
      }

      const result = await mastercardService.tokenizeCard({
        primaryAccountNumber: cardNumber,
        expiryMonth,
        expiryYear,
        cardholderName: cardholderName || "",
      });

      return reply.send({ success: true, ...result });
    }
  );

  // Execute payment via tokenized card
  app.post(
    "/api/mastercard/payment",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tokenUniqueReference, amount, currency, merchantId, merchantName } =
        request.body as {
          tokenUniqueReference?: string;
          amount?: number;
          currency?: string;
          merchantId?: string;
          merchantName?: string;
        };

      if (!tokenUniqueReference || !amount || !merchantId) {
        return reply
          .status(400)
          .send({ success: false, error: "tokenUniqueReference, amount, merchantId required" });
      }

      const result = await mastercardService.makePayment({
        tokenUniqueReference,
        amount,
        currency: currency || "USD",
        merchantId,
        merchantName,
      });

      return reply.send({ success: true, ...result });
    }
  );

  // Get token status
  app.get(
    "/api/mastercard/token/:ref",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { ref } = request.params as { ref: string };
      const result = await mastercardService.getToken(ref);
      return reply.send({ success: true, ...result });
    }
  );

  // Delete token
  app.delete(
    "/api/mastercard/token/:ref",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { ref } = request.params as { ref: string };
      const result = await mastercardService.deleteToken(ref);
      const { success: _, ...rest } = result;
      return reply.send({ success: result.success, ...rest });
    }
  );

  // Webhook receiver — no auth (Mastercard calls this)
  app.post("/api/webhooks/mastercard", async (request, reply) => {
    const body = request.body as Record<string, any>;
    console.log(
      "[Mastercard Webhook]",
      JSON.stringify(body).substring(0, 500)
    );
    // TODO: verify webhook signature, process token lifecycle events
    return reply.send({ received: true });
  });
}
