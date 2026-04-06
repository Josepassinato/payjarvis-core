/**
 * Promo Code Routes — Influencer/creator access codes
 *
 * POST /api/promo/create       — Create promo code (admin only)
 * POST /api/promo/redeem        — Redeem a promo code
 * GET  /api/promo/:code/status  — Check promo code status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || process.env.INTERNAL_SECRET || "";

export async function promoRoutes(app: FastifyInstance) {
  // POST /api/promo/create — admin creates promo code
  app.post("/api/promo/create", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-admin-secret"] as string || request.headers["x-internal-secret"] as string;
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return reply.status(403).send({ success: false, error: "Unauthorized" });
    }

    const { code, months = 3, maxUses = 1, expiresAt } = request.body as {
      code: string; months?: number; maxUses?: number; expiresAt?: string;
    };

    if (!code || code.length < 3) {
      return reply.status(400).send({ success: false, error: "Code must be at least 3 characters" });
    }

    const safeCode = code.toUpperCase().replace(/[^A-Z0-9_]/g, "");

    const existing = await prisma.promoCode.findUnique({ where: { code: safeCode } });
    if (existing) {
      return reply.status(409).send({ success: false, error: "Code already exists" });
    }

    const promo = await prisma.promoCode.create({
      data: {
        code: safeCode,
        months,
        maxUses,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    return { success: true, data: promo };
  });

  // POST /api/promo/redeem — user redeems a promo code
  app.post("/api/promo/redeem", async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, telegramId, userId: bodyUserId } = request.body as {
      code: string; telegramId?: string; userId?: string;
    };

    if (!code) {
      return reply.status(400).send({ success: false, error: "Code required" });
    }

    const safeCode = code.toUpperCase().replace(/[^A-Z0-9_]/g, "");

    const promo = await prisma.promoCode.findUnique({
      where: { code: safeCode },
      include: { redemptions: true },
    });

    if (!promo || !promo.active) {
      return reply.status(404).send({ success: false, error: "Invalid or expired code" });
    }

    if (promo.expiresAt && new Date() > promo.expiresAt) {
      return reply.status(410).send({ success: false, error: "Code has expired" });
    }

    if (promo.usedCount >= promo.maxUses) {
      return reply.status(410).send({ success: false, error: "Code fully redeemed" });
    }

    // Resolve user
    let userId = bodyUserId;
    if (!userId && telegramId) {
      const user = await prisma.user.findFirst({ where: { telegramChatId: telegramId } });
      if (user) userId = user.id;
    }

    if (!userId) {
      return reply.status(400).send({ success: false, error: "User not found" });
    }

    // Check if already redeemed
    const alreadyRedeemed = promo.redemptions.find(r => r.userId === userId);
    if (alreadyRedeemed) {
      return reply.status(409).send({ success: false, error: "Already redeemed" });
    }

    // Apply reward
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + promo.months * 30);

    await prisma.$transaction([
      prisma.promoRedemption.create({
        data: { promoCodeId: promo.id, userId },
      }),
      prisma.promoCode.update({
        where: { id: promo.id },
        data: { usedCount: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          planType: "premium",
          subscriptionStatus: "active",
          subscriptionEndsAt: trialEnd,
        },
      }),
    ]);

    return {
      success: true,
      message: `Pro access granted for ${promo.months} months!`,
      expiresAt: trialEnd.toISOString(),
    };
  });

  // GET /api/promo/:code/status
  app.get("/api/promo/:code/status", async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = request.params as { code: string };
    const safeCode = code.toUpperCase().replace(/[^A-Z0-9_]/g, "");

    const promo = await prisma.promoCode.findUnique({ where: { code: safeCode } });
    if (!promo) {
      return reply.status(404).send({ success: false, error: "Not found" });
    }

    return {
      success: true,
      data: {
        code: promo.code,
        active: promo.active,
        remaining: promo.maxUses - promo.usedCount,
        months: promo.months,
        expiresAt: promo.expiresAt,
      },
    };
  });
}
