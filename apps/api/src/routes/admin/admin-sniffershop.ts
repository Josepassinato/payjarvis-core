/**
 * Admin SnifferShop Routes — B2C metrics, plans, usage, channels
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

export async function adminSniffershopRoutes(app: FastifyInstance) {
  // GET /admin/sniffershop/overview
  app.get("/admin/sniffershop/overview", { preHandler: [requireAdmin] }, async () => {
    const now = new Date();
    const today = new Date(now.toISOString().split("T")[0]);
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
    const monthAgo = new Date(today.getTime() - 30 * 86_400_000);

    const [
      totalUsers,
      newToday,
      newWeek,
      premiumUsers,
      subscriptionRevenue,
      creditPurchasesToday,
      creditPurchasesMonth,
      searchesToday,
      purchasesToday,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { subscriptionStatus: "active" } }),
      prisma.user.count({ where: { subscriptionStatus: "active", planType: { not: "" } } }),
      prisma.creditPurchase.aggregate({
        where: { status: "completed", createdAt: { gte: today } },
        _sum: { amountUsd: true },
      }),
      prisma.creditPurchase.aggregate({
        where: { status: "completed", createdAt: { gte: monthAgo } },
        _sum: { amountUsd: true },
      }),
      prisma.commerceSearchLog.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
      prisma.transaction.count({
        where: { decision: "APPROVED", createdAt: { gte: today } },
      }).catch(() => 0),
    ]);

    // Estimate plan distribution (Pro = $20/mo active sub, Business = custom)
    const proUsers = premiumUsers;
    const businessUsers = 0; // Future: separate plan field
    const freeUsers = totalUsers - proUsers - businessUsers;

    const proPrice = 29.90;
    const businessPrice = 79.90;
    const mrr = proUsers * proPrice + businessUsers * businessPrice;

    // Channel breakdown from onboarding sessions
    const [telegramUsers, whatsappUsers] = await Promise.all([
      prisma.user.count({ where: { telegramChatId: { not: null } } }),
      prisma.user.count({ where: { phone: { not: null } } }),
    ]);
    const pwaUsers = totalUsers - telegramUsers; // approximate

    // Churn: users who had active sub but cancelled in last 30d
    const churned30d = await prisma.user.count({
      where: {
        subscriptionStatus: { in: ["canceled", "past_due"] },
        updatedAt: { gte: monthAgo },
      },
    }).catch(() => 0);
    const churnBase = proUsers + churned30d;
    const churnRate = churnBase > 0 ? (churned30d / churnBase) * 100 : 0;

    const avgSearches = totalUsers > 0 ? (searchesToday / Math.max(newToday || 1, 1)) : 0;

    return {
      success: true,
      data: {
        users: {
          total: totalUsers,
          free: freeUsers,
          pro: proUsers,
          business: businessUsers,
          newToday,
          newWeek,
        },
        revenue: {
          mrr,
          arr: mrr * 12,
          today: creditPurchasesToday._sum.amountUsd || 0,
          month: creditPurchasesMonth._sum.amountUsd || 0,
        },
        usage: {
          searchesToday,
          purchasesToday,
          avgSearchesPerUser: avgSearches,
        },
        churn: {
          rate: churnRate,
          churned30d,
        },
        channels: {
          whatsapp: whatsappUsers,
          telegram: telegramUsers,
          pwa: Math.max(pwaUsers, 0),
        },
      },
    };
  });

  // GET /admin/sniffershop/daily?period=30d
  app.get("/admin/sniffershop/daily", { preHandler: [requireAdmin] }, async (request) => {
    const { period = "30d" } = request.query as { period?: string };
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 86_400_000);

    const signupsByDay = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM users
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY date
    `.catch(() => []);

    const revenueByDay = await prisma.$queryRaw<{ date: string; total: number }[]>`
      SELECT DATE("createdAt") as date, COALESCE(SUM("amountUsd"), 0)::float as total
      FROM credit_purchases
      WHERE status = 'completed' AND "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY date
    `.catch(() => []);

    const searchesByDay = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM commerce_search_logs
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY date
    `.catch(() => []);

    // Merge into single array
    const dateMap: Record<string, { signups: number; revenue: number; searches: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().split("T")[0];
      dateMap[d] = { signups: 0, revenue: 0, searches: 0 };
    }

    for (const row of signupsByDay) {
      const d = typeof row.date === "string" ? row.date : new Date(row.date).toISOString().split("T")[0];
      if (dateMap[d]) dateMap[d].signups = Number(row.count);
    }
    for (const row of revenueByDay) {
      const d = typeof row.date === "string" ? row.date : new Date(row.date).toISOString().split("T")[0];
      if (dateMap[d]) dateMap[d].revenue = Number(row.total);
    }
    for (const row of searchesByDay) {
      const d = typeof row.date === "string" ? row.date : new Date(row.date).toISOString().split("T")[0];
      if (dateMap[d]) dateMap[d].searches = Number(row.count);
    }

    const data = Object.entries(dateMap).map(([date, vals]) => ({ date, ...vals }));

    return { success: true, data };
  });

  // GET /admin/sniffershop/plans
  app.get("/admin/sniffershop/plans", { preHandler: [requireAdmin] }, async () => {
    const totalUsers = await prisma.user.count();
    const premiumUsers = await prisma.user.count({ where: { subscriptionStatus: "active" } });
    const freeUsers = totalUsers - premiumUsers;

    const proPrice = 29.90;
    const businessPrice = 79.90;

    return {
      success: true,
      data: [
        { plan: "free", count: freeUsers, revenue: 0 },
        { plan: "pro", count: premiumUsers, revenue: premiumUsers * proPrice },
        { plan: "business", count: 0, revenue: 0 },
      ],
    };
  });
}
