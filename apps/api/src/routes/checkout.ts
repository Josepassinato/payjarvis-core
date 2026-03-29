/**
 * Amazon Checkout Routes
 *
 * POST /api/amazon/checkout/check-session — Check/create Amazon session
 * POST /api/amazon/checkout/start         — Start checkout (add to cart + proceed)
 * POST /api/amazon/checkout/confirm       — Confirm and place order
 * GET  /api/amazon/checkout/:orderId      — Get order status
 */

import type { FastifyInstance } from "fastify";
import { prisma, Prisma } from "@payjarvis/database";
import {
  checkSession,
  startCheckout,
  confirmOrder,
  getOrderStatus,
} from "../services/amazon/checkout.service.js";

export async function checkoutRoutes(app: FastifyInstance) {
  // DEPRECATED — BrowserBase checkout flow replaced by direct Amazon links (amazon_search tool)
  // These endpoints still work but always fail because cookies don't transfer between browsers.
  // Kept for backward compatibility. Will be removed in a future cleanup.

  // ── Check session ─────────────────────────────────
  app.post("/api/amazon/checkout/check-session", async (request, reply) => {
    const body = request.body as { userId?: string };
    if (!body?.userId) {
      return reply.status(400).send({ success: false, error: "userId is required" });
    }

    console.log(`[AMAZON-CHECKOUT] Tool called: amazon_check_session { userId: "${body.userId}" }`);
    try {
      const result = await checkSession(body.userId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Session check failed";
      request.log.error(err, "[CHECKOUT] check-session error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

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

    console.log(`[AMAZON-CHECKOUT] Tool called: amazon_start_checkout { asin: "${body.asin}", userId: "${body.userId}", price: ${body.price} }`);
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

    console.log(`[AMAZON-CHECKOUT] Tool called: amazon_confirm_order { orderId: "${body.orderId}", userId: "${body.userId}" }`);
    try {
      const result = await confirmOrder(body.orderId, body.userId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order confirmation failed";
      request.log.error(err, "[CHECKOUT] confirm error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Get and clear pending product ──────────────────
  app.get("/api/amazon/checkout/pending-product", async (request, reply) => {
    const userId = (request.query as any).userId;
    if (!userId) {
      return reply.status(400).send({ success: false, error: "userId is required" });
    }

    try {
      // Resolve telegramId → Prisma userId
      let resolvedId = userId;
      if (!userId.startsWith("c") || userId.length < 20) {
        const user = await prisma.user.findFirst({
          where: { telegramChatId: userId },
          select: { id: true },
        });
        if (user) resolvedId = user.id;
      }

      const ctx = await prisma.storeContext.findFirst({
        where: { userId: resolvedId, store: "amazon", pendingProduct: { not: Prisma.DbNull } },
      });

      if (ctx?.pendingProduct) {
        console.log(`[AMAZON-CHECKOUT] Returning pending product for userId=${resolvedId}: ${JSON.stringify(ctx.pendingProduct)}`);
        // Clear pending product after retrieval
        await prisma.storeContext.update({
          where: { id: ctx.id },
          data: { pendingProduct: Prisma.DbNull, updatedAt: new Date() },
        });
        return reply.send({ success: true, data: { pendingProduct: ctx.pendingProduct } });
      }

      return reply.send({ success: true, data: { pendingProduct: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get pending product";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Get order status ────────────────────────────────
  app.get("/api/amazon/checkout/:orderId", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };

    const order = await getOrderStatus(orderId);
    if (!order) {
      return reply.status(404).send({ success: false, error: "Order not found" });
    }

    return reply.send({ success: true, data: order });
  });

  // ── Search Amazon products ──────────────────────────
  app.post("/api/amazon/search", async (request, reply) => {
    const body = request.body as { query?: string; maxResults?: number; domain?: string };
    if (!body?.query) {
      return reply.status(400).send({ success: false, error: "query is required" });
    }

    try {
      const { searchAmazon } = await import("../services/amazon/search.service.js");
      const products = await searchAmazon(body.query, body.domain ?? "amazon.com", body.maxResults ?? 3);
      return reply.send({ success: true, products });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
