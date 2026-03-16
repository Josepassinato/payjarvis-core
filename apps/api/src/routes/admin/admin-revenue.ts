/**
 * Admin Revenue Routes — MRR, ARR, churn, transaction history.
 */

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../services/admin-auth.service.js";

const prisma = new PrismaClient();

export async function adminRevenueRoutes(app: FastifyInstance) {
  // GET /admin/revenue/overview
  app.get("/admin/revenue/overview", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [premiumCount, packRevenue, transactionsThisMonth] = await Promise.all([
      prisma.user.count({ where: { planType: "premium" } }),
      prisma.creditPurchase.aggregate({
        _sum: { amountUsd: true },
        where: { status: "completed", createdAt: { gte: monthStart } },
      }),
      prisma.transaction.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { decision: "APPROVED", createdAt: { gte: monthStart } },
      }),
    ]);

    const subscriptionMRR = premiumCount * 20;
    const packMRR = packRevenue._sum.amountUsd || 0;
    const mrr = subscriptionMRR + packMRR;

    return reply.send({
      success: true,
      mrr,
      arr: mrr * 12,
      subscriptionMRR,
      packMRR,
      premiumUsers: premiumCount,
      churnRate: 0, // TODO: calculate from cancellations
      transactionsThisMonth: transactionsThisMonth._count,
      volumeThisMonth: transactionsThisMonth._sum.amount || 0,
    });
  });

  // GET /admin/revenue/transactions — list payments
  app.get("/admin/revenue/transactions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1"));
    const limit = Math.min(100, parseInt(q.limit || "50"));

    const [purchases, total] = await Promise.all([
      prisma.creditPurchase.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.creditPurchase.count(),
    ]);

    return reply.send({
      success: true,
      transactions: purchases,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // GET /admin/revenue/chart?period=12m — chart data
  app.get("/admin/revenue/chart", { preHandler: [requireAdmin] }, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const months = parseInt(q.period?.replace("m", "") || "12");
    const data: { month: string; revenue: number; users: number }[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

      const [rev, newUsers] = await Promise.all([
        prisma.creditPurchase.aggregate({
          _sum: { amountUsd: true },
          where: { status: "completed", createdAt: { gte: start, lt: end } },
        }),
        prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
      ]);

      data.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        revenue: rev._sum.amountUsd || 0,
        users: newUsers,
      });
    }

    return reply.send({ success: true, data });
  });
}
