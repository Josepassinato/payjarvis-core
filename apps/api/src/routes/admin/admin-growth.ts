/**
 * Admin Growth Routes — signups, trials, conversions, channels, referrals
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.headers.authorization?.replace("Bearer ", "");
  if (!token || !ADMIN_JWT_SECRET) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
    return;
  }
  try {
    const jwt = await import("jsonwebtoken");
    jwt.default.verify(token, ADMIN_JWT_SECRET);
  } catch {
    reply.status(401).send({ success: false, error: "Invalid token" });
  }
}

export async function adminGrowthRoutes(app: FastifyInstance) {
  // GET /admin/growth/overview — key growth metrics
  app.get("/admin/growth/overview", { preHandler: [requireAdmin] }, async () => {
    const now = new Date();
    const today = new Date(now.toISOString().split("T")[0]);
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
    const monthAgo = new Date(today.getTime() - 30 * 86_400_000);

    const [
      totalUsers,
      signupsToday,
      signupsWeek,
      signupsMonth,
      trialActive,
      trialExpired,
      premiumUsers,
      telegramUsers,
      whatsappUsers,
      pwaUsers,
      totalReferrals,
      topReferrers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.user.count({ where: { planType: "trial", whatsappTrialExpired: false } }),
      prisma.user.count({ where: { whatsappTrialExpired: true } }),
      prisma.user.count({ where: { planType: "premium", subscriptionStatus: "active" } }),
      prisma.user.count({ where: { telegramChatId: { not: null } } }),
      prisma.user.count({ where: { phone: { not: null } } }),
      prisma.user.count({ where: { notificationChannel: "none", telegramChatId: null, phone: null } }),
      prisma.user.aggregate({ _sum: { referralCount: true } }),
      prisma.user.findMany({
        where: { referralCount: { gt: 0 } },
        select: { id: true, fullName: true, referralCount: true, referralBonusDays: true },
        orderBy: { referralCount: "desc" },
        take: 10,
      }),
    ]);

    const trialConversionRate = trialExpired > 0
      ? Math.round((premiumUsers / (trialExpired + premiumUsers)) * 100)
      : 0;

    return {
      success: true,
      data: {
        signups: { total: totalUsers, today: signupsToday, week: signupsWeek, month: signupsMonth },
        trials: { active: trialActive, expired: trialExpired, conversionRate: trialConversionRate },
        plans: { free: totalUsers - premiumUsers - trialActive, trial: trialActive, premium: premiumUsers },
        channels: { telegram: telegramUsers, whatsapp: whatsappUsers, pwa: pwaUsers },
        referrals: { total: totalReferrals._sum.referralCount ?? 0, topReferrers },
      },
    };
  });

  // GET /admin/growth/daily-signups?days=30 — daily signup chart data
  app.get("/admin/growth/daily-signups", { preHandler: [requireAdmin] }, async (request) => {
    const { days = "30" } = request.query as { days?: string };
    const numDays = Math.min(parseInt(days) || 30, 90);
    const since = new Date(Date.now() - numDays * 86_400_000);

    const signups = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at >= ${since}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    return {
      success: true,
      data: signups.map((s) => ({ date: String(s.date).split("T")[0], count: Number(s.count) })),
    };
  });

  // GET /admin/growth/trial-funnel — trial activation → conversion funnel
  app.get("/admin/growth/trial-funnel", { preHandler: [requireAdmin] }, async () => {
    const [started, active, expired, converted] = await Promise.all([
      prisma.user.count({ where: { whatsappTrialStartsAt: { not: null } } }),
      prisma.user.count({ where: { planType: "trial", whatsappTrialExpired: false } }),
      prisma.user.count({ where: { whatsappTrialExpired: true } }),
      prisma.user.count({ where: { planType: "premium", subscriptionStatus: "active" } }),
    ]);

    return {
      success: true,
      data: {
        funnel: [
          { stage: "Trial Started", count: started },
          { stage: "Trial Active", count: active },
          { stage: "Trial Expired", count: expired },
          { stage: "Converted to Premium", count: converted },
        ],
        conversionRate: started > 0 ? Math.round((converted / started) * 100) : 0,
      },
    };
  });

  // GET /admin/growth/channel-breakdown — signups by channel over time
  app.get("/admin/growth/channel-breakdown", { preHandler: [requireAdmin] }, async () => {
    const [telegram, whatsapp, both, neither] = await Promise.all([
      prisma.user.count({ where: { telegramChatId: { not: null }, phone: null } }),
      prisma.user.count({ where: { phone: { not: null }, telegramChatId: null } }),
      prisma.user.count({ where: { telegramChatId: { not: null }, phone: { not: null } } }),
      prisma.user.count({ where: { telegramChatId: null, phone: null } }),
    ]);

    return {
      success: true,
      data: { telegram, whatsapp, both, pwaOnly: neither },
    };
  });
}
