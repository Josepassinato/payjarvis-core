/**
 * Admin Overview — GET /admin/overview
 * Returns all KPIs for the admin dashboard.
 */

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../services/admin-auth.service.js";

const prisma = new PrismaClient();

export async function adminOverviewRoutes(app: FastifyInstance) {
  app.get("/admin/overview", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const days7ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const days30ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newToday,
      newThisWeek,
      newThisMonth,
      telegramUsers,
      whatsappUsers,
      premiumUsers,
      active7d,
      active30d,
      messagesToday,
      messagesThisWeek,
      purchasesThisMonth,
      totalCreditsUsed,
      totalRevenuePacks,
      sequenceByStep,
      sequencePaused,
      sequenceCompleted,
      recentTransactions,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.onboardingSession.count({ where: { telegramChatId: { not: null } } }),
      prisma.onboardingSession.count({ where: { whatsappPhone: { not: null } } }),
      prisma.user.count({ where: { planType: "premium" } }),
      prisma.onboardingSequence.count({ where: { lastActiveAt: { gte: days7ago } } }),
      prisma.onboardingSequence.count({ where: { lastActiveAt: { gte: days30ago } } }),
      prisma.llmUsageLog.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.llmUsageLog.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.creditPurchase.count({ where: { createdAt: { gte: monthStart }, status: "completed" } }),
      prisma.llmCredit.aggregate({ _sum: { messagesUsed: true } }),
      prisma.creditPurchase.aggregate({ _sum: { amountUsd: true }, where: { status: "completed" } }),
      prisma.onboardingSequence.groupBy({ by: ["currentStep"], _count: true }),
      prisma.onboardingSequence.count({ where: { active: false } }),
      prisma.onboardingSequence.count({ where: { currentStep: { gte: 7 } } }),
      prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: monthStart }, decision: "APPROVED" },
      }),
    ]);

    // Revenue calculations
    const subscriptionRevenue = premiumUsers * 20; // $20/month per premium user
    const packRevenue = totalRevenuePacks._sum.amountUsd || 0;
    const mrr = subscriptionRevenue + packRevenue;

    // Sequence by step
    const byStep: Record<number, number> = {};
    for (const s of sequenceByStep) {
      byStep[s.currentStep] = s._count;
    }

    // Average messages per user
    const totalMsgsUsed = totalCreditsUsed._sum.messagesUsed || 0;
    const avgMessagesPerUser = totalUsers > 0 ? Math.round(totalMsgsUsed / totalUsers) : 0;

    return reply.send({
      success: true,
      users: {
        total: totalUsers,
        active7d,
        active30d,
        newToday,
        newThisWeek,
        newThisMonth,
        byPlatform: { telegram: telegramUsers, whatsapp: whatsappUsers },
        paying: premiumUsers,
        free: totalUsers - premiumUsers,
      },
      revenue: {
        mrr,
        arr: mrr * 12,
        churnThisMonth: 0, // TODO: calculate from subscription cancellations
        newPayingThisMonth: await prisma.user.count({
          where: { planType: "premium", createdAt: { gte: monthStart } },
        }),
        totalTransacted: recentTransactions._sum.amount || 0,
      },
      engagement: {
        messagesToday,
        messagesThisWeek,
        purchasesThisMonth,
        topFeatures: ["chat", "price-check", "store-connect"],
      },
      credits: {
        totalMessagesConsumed: totalMsgsUsed,
        totalRevenuePacks: packRevenue,
        avgMessagesPerUser,
      },
      sequence: {
        byStep,
        paused: sequencePaused,
        completed: sequenceCompleted,
      },
    });
  });
}
