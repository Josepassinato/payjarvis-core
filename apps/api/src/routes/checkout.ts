/**
 * Amazon Checkout Routes
 *
 * POST /api/amazon/checkout/start   — Start checkout (add to cart + proceed)
 * POST /api/amazon/checkout/confirm — Confirm and place order
 * GET  /api/amazon/checkout/:orderId — Get order status
 */

import type { FastifyInstance } from "fastify";
import {
  startCheckout,
  confirmOrder,
  getOrderStatus,
} from "../services/amazon/checkout.service.js";

export async function checkoutRoutes(app: FastifyInstance) {
  // ── Start checkout ──────────────────────────────────
  app.post("/api/amazon/checkout/start", async (request, reply) => {
    const body = request.body as {
      userId?: string;
      botId?: string;
      asin?: string;
      title?: string;
      price?: number;
      quantity?: number;
    };

    if (!body?.userId || !body?.botId || !body?.asin || !body?.title || !body?.price) {
      return reply.status(400).send({
        success: false,
        error: "userId, botId, asin, title, and price are required",
      });
    }

    try {
      const result = await startCheckout({
        userId: body.userId,
        botId: body.botId,
        asin: body.asin,
        title: body.title,
        price: body.price,
        quantity: body.quantity,
      });

      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout failed";
      request.log.error(err, "[CHECKOUT] start error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Confirm order ───────────────────────────────────
  app.post("/api/amazon/checkout/confirm", async (request, reply) => {
    const body = request.body as { orderId?: string; userId?: string };

    if (!body?.orderId || !body?.userId) {
      return reply.status(400).send({
        success: false,
        error: "orderId and userId are required",
      });
    }

    try {
      const result = await confirmOrder(body.orderId, body.userId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order confirmation failed";
      request.log.error(err, "[CHECKOUT] confirm error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Get order status ────────────────────────────────
  app.get("/api/amazon/checkout/:orderId", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };

    const order = await getOrderStatus(orderId);
    if (!order) {
      return reply.status(404).send({
        success: false,
        error: "Order not found",
      });
    }

    return reply.send({ success: true, data: order });
  });
}
