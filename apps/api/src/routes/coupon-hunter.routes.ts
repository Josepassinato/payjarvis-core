/**
 * Coupon Hunter Routes — Wish list CRUD + manual coupon search
 *
 * POST /api/coupons/search        — Search coupons (Gemini tool endpoint)
 * GET  /api/coupons/deals         — List recent deals
 * POST /api/wishlist              — Add item to wish list
 * GET  /api/wishlist              — List user's wish list
 * DELETE /api/wishlist/:id        — Remove wish list item
 */

import { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import { searchCoupons } from "../services/shopping/coupon-hunter.js";

export async function couponHunterRoutes(app: FastifyInstance) {
  // ─── Search Coupons (also used as Gemini tool handler) ───
  app.post("/api/coupons/search", async (req, reply) => {
    const { store, category, country } = req.body as {
      store?: string;
      category?: string;
      country?: "US" | "BR";
    };

    try {
      const deals = await searchCoupons(store, category, country || "US");
      return reply.send({
        success: true,
        data: {
          deals,
          count: deals.length,
          country: country || "US",
        },
      });
    } catch (err) {
      console.error("[COUPON-HUNTER] Search error:", (err as Error).message);
      return reply.code(500).send({ success: false, error: "Search failed" });
    }
  });

  // ─── List Recent Deals ───
  app.get("/api/coupons/deals", async (req, reply) => {
    const { country, urgency, category, limit } = req.query as {
      country?: string;
      urgency?: string;
      category?: string;
      limit?: string;
    };

    const where: any = {
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    };
    if (country) where.country = country;
    if (urgency) where.urgency = urgency;
    if (category) where.category = category;

    const deals = await prisma.couponDeal.findMany({
      where,
      orderBy: [{ urgency: "asc" }, { createdAt: "desc" }],
      take: Math.min(parseInt(limit || "50", 10), 100),
    });

    return reply.send({
      success: true,
      data: { deals, count: deals.length },
    });
  });

  // ─── Add to Wish List ───
  app.post("/api/wishlist", async (req, reply) => {
    await requireAuth(req, reply);
    const userId = (req as any).userId;

    const { query, category, maxPrice, country, channel, channelId } = req.body as {
      query: string;
      category?: string;
      maxPrice?: number;
      country?: "US" | "BR";
      channel?: "telegram" | "whatsapp";
      channelId?: string;
    };

    if (!query || query.trim().length < 2) {
      return reply.code(400).send({ success: false, error: "Query is required (min 2 chars)" });
    }

    // Get user's Telegram chatId as default channelId
    let resolvedChannelId = channelId;
    if (!resolvedChannelId) {
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
        select: { telegramChatId: true },
      });
      resolvedChannelId = user?.telegramChatId || "";
    }

    if (!resolvedChannelId) {
      return reply.code(400).send({
        success: false,
        error: "channelId is required (Telegram chatId or WhatsApp number)",
      });
    }

    const item = await prisma.userWishlistItem.create({
      data: {
        userId,
        query: query.trim(),
        category: category || null,
        maxPrice: maxPrice || null,
        country: country || "US",
        channel: channel || "telegram",
        channelId: resolvedChannelId,
        active: true,
      },
    });

    return reply.code(201).send({
      success: true,
      data: item,
      message: `🐕 "${query}" added to your wish list! I'll bark when I find a deal.`,
    });
  });

  // ─── List Wish List ───
  app.get("/api/wishlist", async (req, reply) => {
    await requireAuth(req, reply);
    const userId = (req as any).userId;

    const items = await prisma.userWishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({
      success: true,
      data: { items, count: items.length },
    });
  });

  // ─── Remove from Wish List ───
  app.delete<{ Params: { id: string } }>("/api/wishlist/:id", async (req, reply) => {
    await requireAuth(req, reply);
    const userId = (req as any).userId;
    const { id } = req.params;

    const item = await prisma.userWishlistItem.findFirst({
      where: { id, userId },
    });

    if (!item) {
      return reply.code(404).send({ success: false, error: "Wish list item not found" });
    }

    await prisma.userWishlistItem.delete({ where: { id } });

    return reply.send({
      success: true,
      message: `Removed "${item.query}" from wish list`,
    });
  });

  // ─── Toggle Wish List Item ───
  app.patch<{ Params: { id: string } }>("/api/wishlist/:id/toggle", async (req, reply) => {
    await requireAuth(req, reply);
    const userId = (req as any).userId;
    const { id } = req.params;

    const item = await prisma.userWishlistItem.findFirst({
      where: { id, userId },
    });

    if (!item) {
      return reply.code(404).send({ success: false, error: "Wish list item not found" });
    }

    const updated = await prisma.userWishlistItem.update({
      where: { id },
      data: { active: !item.active },
    });

    return reply.send({
      success: true,
      data: updated,
      message: updated.active ? "Wish list item activated" : "Wish list item paused",
    });
  });
}
