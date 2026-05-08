/**
 * Generic Store Checkout Routes
 *
 * POST /api/store/checkout/start   — Start checkout (navigate + cart + shipping + screenshot)
 * POST /api/store/checkout/confirm — Confirm and place order (after user reviews screenshot)
 * POST /api/store/checkout/cancel  — Cancel in-progress checkout
 */

import type { FastifyInstance } from "fastify";
import {
  startGenericCheckout,
  confirmGenericOrder,
  cancelGenericCheckout,
} from "../services/generic-checkout.service.js";

export async function genericCheckoutApiRoutes(app: FastifyInstance) {

  // ── Start checkout ──────────────────────────────────
  app.post("/api/store/checkout/start", async (request, reply) => {
    const body = request.body as {
      userId?: string;
      productUrl?: string;
      productName?: string;
      price?: number;
      store?: string;
      size?: string;
      color?: string;
      quantity?: number;
    };

    if (!body?.userId || !body?.productUrl || !body?.productName || !body?.price || !body?.store) {
      return reply.status(400).send({
        success: false,
        error: "userId, productUrl, productName, price, and store are required",
      });
    }

    console.log(`[GENERIC-CHECKOUT] start: store=${body.store}, product=${body.productName}, price=$${body.price}`);

    try {
      const result = await startGenericCheckout({
        userId: body.userId,
        productUrl: body.productUrl,
        productName: body.productName,
        price: body.price,
        store: body.store,
        size: body.size,
        color: body.color,
        quantity: body.quantity,
      });

      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generic checkout failed";
      request.log.error(err, "[GENERIC-CHECKOUT] start error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Confirm order ──────────────────────────────────
  app.post("/api/store/checkout/confirm", async (request, reply) => {
    const body = request.body as {
      bbSessionId?: string;
      expectedTotal?: number;
    };

    if (!body?.bbSessionId || body?.expectedTotal == null) {
      return reply.status(400).send({
        success: false,
        error: "bbSessionId and expectedTotal are required",
      });
    }

    console.log(`[GENERIC-CHECKOUT] confirm: session=${body.bbSessionId.slice(0, 8)}, total=$${body.expectedTotal}`);

    try {
      const result = await confirmGenericOrder(body.bbSessionId, body.expectedTotal);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order confirmation failed";
      request.log.error(err, "[GENERIC-CHECKOUT] confirm error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Cancel checkout ─────────────────────────────────
  app.post("/api/store/checkout/cancel", async (request, reply) => {
    const body = request.body as { bbSessionId?: string };

    if (!body?.bbSessionId) {
      return reply.status(400).send({ success: false, error: "bbSessionId required" });
    }

    console.log(`[GENERIC-CHECKOUT] cancel: session=${body.bbSessionId.slice(0, 8)}`);

    try {
      await cancelGenericCheckout(body.bbSessionId);
      return reply.send({ success: true, message: "Checkout cancelled" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cancel failed";
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
