/**
 * Admin CFO Routes — Financial intelligence, P&L, forecasting, cost analysis.
 */

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../services/admin-auth.service.js";

const prisma = new PrismaClient();

// Infrastructure cost constants
const VPS_COST_MONTHLY = 29.99;
const STRIPE_FEE_PERCENT = 0.029;
const STRIPE_FEE_FIXED = 0.30;
const GEMINI_COST_PER_1K_INPUT = 0.000075;
const GEMINI_COST_PER_1K_OUTPUT = 0.0003;
const SUBSCRIPTION_PRICE_USD = 20;

// Helpers

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function parsePeriodToDates(period: string): { start: Date; groupByDay: boolean } {
  const now = new Date();
  let start: Date;
  let groupByDay = true;

  if (period.endsWith("d")) {
    const days = parseInt(period.replace("d", "")) || 30;
    start = daysAgo(days);
    groupByDay = days <= 90;
  } else if (period.endsWith("m")) {
    const months = parseInt(period.replace("m", "")) || 12;
    start = new Date(now.getFullYear(), now.getMonth() - months, 1);
    groupByDay = months <= 3;
  } else {
    start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    groupByDay = false;
  }

  return { start, groupByDay };
}

function periodStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case "day":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week":
      return daysAgo(7);
    case "month":
      return getMonthStart(now);
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return getMonthStart(now);
  }
}

function toDateKey(date: Date, groupByDay: boolean): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  if (!groupByDay) return `${y}-${m}`;
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function adminCfoRoutes(app: FastifyInstance) {
  // ──────────────────────────────────────────
  // 1. GET /admin/cfo/overview — Current P&L + MRR + margin
  // ──────────────────────────────────────────
  app.get("/admin/cfo/overview", { preHandler: [requireAdmin] }, async (_request, reply) => {
    try {
      const now = new Date();
      const monthStart = getMonthStart(now);

      const [
        packRevenue,
        premiumActiveCount,
        costEntries,
        totalUsers,
        newUsersThisMonth,
      ] = await Promise.all([
        prisma.creditPurchase.aggregate({
          _sum: { amountUsd: true },
          where: { status: "completed", createdAt: { gte: monthStart } },
        }),
        prisma.user.count({
          where: { planType: "premium", subscriptionStatus: "active" },
        }),
        prisma.costEntry.findMany({
          where: { date: { gte: monthStart } },
        }),
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      ]);

      const packs = packRevenue._sum.amountUsd || 0;
      const subscriptions = premiumActiveCount * SUBSCRIPTION_PRICE_USD;
      const revenueTotal = packs + subscriptions;

      // Group costs by category
      const costByCategory: Record<string, number> = {};
      for (const entry of costEntries) {
        const cat = entry.category.toLowerCase();
        costByCategory[cat] = (costByCategory[cat] || 0) + entry.amountUsd;
      }

      const costs = {
        llm: costByCategory["llm"] || 0,
        vps: costByCategory["vps"] || VPS_COST_MONTHLY,
        stripe: costByCategory["stripe"] || revenueTotal * STRIPE_FEE_PERCENT,
        twilio: costByCategory["twilio"] || 0,
        browserbase: costByCategory["browserbase"] || 0,
        total: 0,
      };
      costs.total = costs.llm + costs.vps + costs.stripe + costs.twilio + costs.browserbase;

      const marginUsd = revenueTotal - costs.total;
      const marginPercent = revenueTotal > 0 ? (marginUsd / revenueTotal) * 100 : 0;

      const mrr = subscriptions + packs;
      const arr = mrr * 12;

      return reply.send({
        success: true,
        revenue: { packs, subscriptions, total: revenueTotal },
        costs,
        margin: { usd: Math.round(marginUsd * 100) / 100, percent: Math.round(marginPercent * 100) / 100 },
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(arr * 100) / 100,
        activeUsers: premiumActiveCount,
        newUsers: newUsersThisMonth,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 2. GET /admin/cfo/snapshots?days=30 — Historical snapshots
  // ──────────────────────────────────────────
  app.get("/admin/cfo/snapshots", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const days = Math.min(365, Math.max(1, parseInt(q.days || "30")));

      const snapshots = await prisma.cfoSnapshot.findMany({
        orderBy: { date: "desc" },
        take: days,
      });

      return reply.send({ success: true, days, snapshots });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 3. GET /admin/cfo/costs?period=month — Cost breakdown
  // ──────────────────────────────────────────
  app.get("/admin/cfo/costs", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const period = q.period || "month";
      const start = periodStartDate(period);

      const entries = await prisma.costEntry.findMany({
        where: { date: { gte: start } },
      });

      const categoryMap: Record<string, { total: number; count: number }> = {};
      let grandTotal = 0;

      for (const entry of entries) {
        const cat = entry.category;
        if (!categoryMap[cat]) categoryMap[cat] = { total: 0, count: 0 };
        categoryMap[cat].total += entry.amountUsd;
        categoryMap[cat].count += 1;
        grandTotal += entry.amountUsd;
      }

      const categories = Object.entries(categoryMap).map(([category, data]) => ({
        category,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        avgPerEntry: Math.round((data.total / data.count) * 100) / 100,
      }));

      return reply.send({
        success: true,
        period,
        categories,
        grandTotal: Math.round(grandTotal * 100) / 100,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 4. GET /admin/cfo/users/profitability — Revenue vs cost per user
  // ──────────────────────────────────────────
  app.get("/admin/cfo/users/profitability", { preHandler: [requireAdmin] }, async (_request, reply) => {
    try {
      const now = new Date();

      // Users with purchases or costs
      const [purchases, costs, users, messageCounts] = await Promise.all([
        prisma.creditPurchase.groupBy({
          by: ["userId"],
          _sum: { amountUsd: true },
          where: { status: "completed" },
        }),
        prisma.costEntry.groupBy({
          by: ["userId"],
          _sum: { amountUsd: true },
          where: { userId: { not: null } },
        }),
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            fullName: true,
            planType: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            createdAt: true,
          },
        }),
        prisma.llmUsageLog.groupBy({
          by: ["userId"],
          _count: true,
        }),
      ]);

      const purchaseMap = new Map(purchases.map((p) => [p.userId, p._sum.amountUsd || 0]));
      const costMap = new Map(costs.map((c) => [c.userId!, c._sum.amountUsd || 0]));
      const messageMap = new Map(messageCounts.map((m) => [m.userId, m._count]));

      const results = users
        .map((user) => {
          let revenue = purchaseMap.get(user.id) || 0;

          // Add subscription revenue for active premium users
          if (user.planType === "premium" && user.subscriptionStatus === "active") {
            const daysActive = Math.max(
              1,
              Math.floor((now.getTime() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000))
            );
            const monthsActive = daysActive / 30;
            revenue += monthsActive * SUBSCRIPTION_PRICE_USD;
          }

          const cost = costMap.get(user.id) || 0;
          const profit = revenue - cost;
          const roi = cost > 0 ? revenue / cost : revenue > 0 ? Infinity : 0;
          const messagesUsed = messageMap.get(user.id) || 0;

          return {
            userId: user.id,
            email: user.email,
            fullName: user.fullName,
            revenue: Math.round(revenue * 100) / 100,
            cost: Math.round(cost * 100) / 100,
            profit: Math.round(profit * 100) / 100,
            roi: roi === Infinity ? "Infinity" : Math.round(roi * 100) / 100,
            messagesUsed,
          };
        })
        .filter((u) => u.revenue > 0 || u.cost > 0 || u.messagesUsed > 0)
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 50);

      return reply.send({ success: true, users: results });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 5. GET /admin/cfo/alerts — Active alerts
  // ──────────────────────────────────────────
  app.get("/admin/cfo/alerts", { preHandler: [requireAdmin] }, async (_request, reply) => {
    try {
      const severityOrder = { critical: 0, warning: 1, info: 2 };

      const alerts = await prisma.cfoAlert.findMany({
        where: { status: { in: ["open", "acknowledged"] } },
        orderBy: [{ createdAt: "desc" }],
      });

      // Sort by severity priority, then by createdAt desc
      alerts.sort((a, b) => {
        const sa = severityOrder[a.severity as keyof typeof severityOrder] ?? 3;
        const sb = severityOrder[b.severity as keyof typeof severityOrder] ?? 3;
        if (sa !== sb) return sa - sb;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      return reply.send({ success: true, alerts });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 6. PUT /admin/cfo/alerts/:id — Update alert status
  // ──────────────────────────────────────────
  app.put("/admin/cfo/alerts/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { status?: string };

      if (!body.status || !["acknowledged", "resolved"].includes(body.status)) {
        return reply.status(400).send({
          success: false,
          error: "Status must be 'acknowledged' or 'resolved'",
        });
      }

      const alert = await prisma.cfoAlert.update({
        where: { id },
        data: { status: body.status, updatedAt: new Date() },
      });

      return reply.send({ success: true, alert });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("Record to update not found")) {
        return reply.status(404).send({ success: false, error: "Alert not found" });
      }
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 7. GET /admin/cfo/forecast?days=90 — Revenue projection
  // ──────────────────────────────────────────
  app.get("/admin/cfo/forecast", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const forecastDays = Math.min(365, Math.max(7, parseInt(q.days || "90")));

      const snapshots = await prisma.cfoSnapshot.findMany({
        orderBy: { date: "desc" },
        take: 30,
      });

      if (snapshots.length < 2) {
        return reply.send({
          success: true,
          currentMrr: snapshots[0]?.mrr || 0,
          projectedMrr30: null,
          projectedMrr60: null,
          projectedMrr90: null,
          growthRateMoM: 0,
          estimatedBreakEvenDate: null,
          note: "Insufficient snapshot data for projection (need at least 2 days)",
        });
      }

      // Calculate average daily revenue growth rate
      const sortedAsc = [...snapshots].reverse();
      let totalGrowthRate = 0;
      let growthCount = 0;

      for (let i = 1; i < sortedAsc.length; i++) {
        const prev = sortedAsc[i - 1].revenueTotalUsd;
        const curr = sortedAsc[i].revenueTotalUsd;
        if (prev > 0) {
          totalGrowthRate += (curr - prev) / prev;
          growthCount++;
        }
      }

      const avgDailyGrowthRate = growthCount > 0 ? totalGrowthRate / growthCount : 0;
      const growthRateMoM = avgDailyGrowthRate * 30;
      const currentMrr = snapshots[0].mrr;

      // Project MRR forward
      const projectedMrr30 = currentMrr * Math.pow(1 + avgDailyGrowthRate, 30);
      const projectedMrr60 = currentMrr * Math.pow(1 + avgDailyGrowthRate, 60);
      const projectedMrr90 = currentMrr * Math.pow(1 + avgDailyGrowthRate, 90);

      // Estimate break-even: when margin > 0
      const currentCost = snapshots[0].costTotalUsd;
      let estimatedBreakEvenDate: string | null = null;

      if (currentMrr < currentCost && avgDailyGrowthRate > 0) {
        // Solve: currentMrr * (1 + rate)^d = currentCost
        const daysToBreakEven = Math.ceil(
          Math.log(currentCost / currentMrr) / Math.log(1 + avgDailyGrowthRate)
        );
        const breakEvenDate = new Date();
        breakEvenDate.setDate(breakEvenDate.getDate() + daysToBreakEven);
        estimatedBreakEvenDate = breakEvenDate.toISOString().split("T")[0];
      } else if (currentMrr >= currentCost) {
        estimatedBreakEvenDate = "already_profitable";
      }

      return reply.send({
        success: true,
        currentMrr: Math.round(currentMrr * 100) / 100,
        projectedMrr30: Math.round(projectedMrr30 * 100) / 100,
        projectedMrr60: Math.round(projectedMrr60 * 100) / 100,
        projectedMrr90: Math.round(projectedMrr90 * 100) / 100,
        growthRateMoM: Math.round(growthRateMoM * 10000) / 100, // percentage
        estimatedBreakEvenDate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 8. GET /admin/cfo/chart/revenue?period=12m — Revenue chart data
  // ──────────────────────────────────────────
  app.get("/admin/cfo/chart/revenue", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const period = q.period || "12m";
      const { start, groupByDay } = parsePeriodToDates(period);

      const snapshots = await prisma.cfoSnapshot.findMany({
        where: { date: { gte: start } },
        orderBy: { date: "asc" },
      });

      const grouped = new Map<string, { revenue: number; cost: number; margin: number; count: number }>();

      for (const snap of snapshots) {
        const key = toDateKey(snap.date, groupByDay);
        const existing = grouped.get(key) || { revenue: 0, cost: 0, margin: 0, count: 0 };
        existing.revenue += snap.revenueTotalUsd;
        existing.cost += snap.costTotalUsd;
        existing.margin += snap.marginUsd;
        existing.count += 1;
        grouped.set(key, existing);
      }

      const data = Array.from(grouped.entries()).map(([date, values]) => ({
        date,
        revenue: Math.round(values.revenue * 100) / 100,
        cost: Math.round(values.cost * 100) / 100,
        margin: Math.round(values.margin * 100) / 100,
      }));

      return reply.send({ success: true, period, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 9. GET /admin/cfo/chart/costs?period=12m — Cost chart data
  // ──────────────────────────────────────────
  app.get("/admin/cfo/chart/costs", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const period = q.period || "12m";
      const { start, groupByDay } = parsePeriodToDates(period);

      const snapshots = await prisma.cfoSnapshot.findMany({
        where: { date: { gte: start } },
        orderBy: { date: "asc" },
      });

      const grouped = new Map<
        string,
        { llm: number; vps: number; stripe: number; twilio: number; browserbase: number; count: number }
      >();

      for (const snap of snapshots) {
        const key = toDateKey(snap.date, groupByDay);
        const existing = grouped.get(key) || { llm: 0, vps: 0, stripe: 0, twilio: 0, browserbase: 0, count: 0 };
        existing.llm += snap.costLlmUsd;
        existing.vps += snap.costVpsUsd;
        existing.stripe += snap.costStripeUsd;
        existing.twilio += snap.costTwilioUsd;
        existing.browserbase += snap.costBrowserbaseUsd;
        existing.count += 1;
        grouped.set(key, existing);
      }

      const data = Array.from(grouped.entries()).map(([date, values]) => ({
        date,
        llm: Math.round(values.llm * 100) / 100,
        vps: Math.round(values.vps * 100) / 100,
        stripe: Math.round(values.stripe * 100) / 100,
        twilio: Math.round(values.twilio * 100) / 100,
        browserbase: Math.round(values.browserbase * 100) / 100,
      }));

      return reply.send({ success: true, period, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 10. GET /admin/cfo/chart/margin?period=12m — Margin chart data
  // ──────────────────────────────────────────
  app.get("/admin/cfo/chart/margin", { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const period = q.period || "12m";
      const { start, groupByDay } = parsePeriodToDates(period);

      const snapshots = await prisma.cfoSnapshot.findMany({
        where: { date: { gte: start } },
        orderBy: { date: "asc" },
      });

      const grouped = new Map<
        string,
        { marginUsd: number; revenue: number; cost: number; count: number }
      >();

      for (const snap of snapshots) {
        const key = toDateKey(snap.date, groupByDay);
        const existing = grouped.get(key) || { marginUsd: 0, revenue: 0, cost: 0, count: 0 };
        existing.marginUsd += snap.marginUsd;
        existing.revenue += snap.revenueTotalUsd;
        existing.cost += snap.costTotalUsd;
        existing.count += 1;
        grouped.set(key, existing);
      }

      const data = Array.from(grouped.entries()).map(([date, values]) => ({
        date,
        marginUsd: Math.round(values.marginUsd * 100) / 100,
        marginPercent:
          values.revenue > 0
            ? Math.round(((values.revenue - values.cost) / values.revenue) * 10000) / 100
            : 0,
      }));

      return reply.send({ success: true, period, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 11. GET /admin/cfo/llm/optimization — LLM cost analysis
  // ──────────────────────────────────────────
  app.get("/admin/cfo/llm/optimization", { preHandler: [requireAdmin] }, async (_request, reply) => {
    try {
      const now = new Date();
      const days30ago = daysAgo(30);
      const days7ago = daysAgo(7);
      const days14ago = daysAgo(14);

      const [last30d, thisWeek, lastWeek] = await Promise.all([
        prisma.llmUsageLog.aggregate({
          _sum: { costReal: true, inputTokens: true, outputTokens: true, totalTokens: true },
          _count: true,
          where: { createdAt: { gte: days30ago } },
        }),
        prisma.llmUsageLog.aggregate({
          _sum: { costReal: true },
          _count: true,
          where: { createdAt: { gte: days7ago } },
        }),
        prisma.llmUsageLog.aggregate({
          _sum: { costReal: true },
          _count: true,
          where: { createdAt: { gte: days14ago, lt: days7ago } },
        }),
      ]);

      const messagesProcessed30d = last30d._count;
      const totalSpend30d = last30d._sum.costReal || 0;
      const totalTokens30d = last30d._sum.totalTokens || 0;

      const avgCostPerMessage = messagesProcessed30d > 0 ? totalSpend30d / messagesProcessed30d : 0;
      const avgTokensPerMessage = messagesProcessed30d > 0 ? totalTokens30d / messagesProcessed30d : 0;

      const thisWeekSpend = thisWeek._sum.costReal || 0;
      const lastWeekSpend = lastWeek._sum.costReal || 0;
      let costTrend: string;
      if (lastWeekSpend === 0) {
        costTrend = thisWeekSpend > 0 ? "increasing" : "stable";
      } else {
        const change = ((thisWeekSpend - lastWeekSpend) / lastWeekSpend) * 100;
        if (change > 5) costTrend = `increasing (+${Math.round(change)}%)`;
        else if (change < -5) costTrend = `decreasing (${Math.round(change)}%)`;
        else costTrend = "stable";
      }

      return reply.send({
        success: true,
        avgCostPerMessage: Math.round(avgCostPerMessage * 1000000) / 1000000,
        avgTokensPerMessage: Math.round(avgTokensPerMessage),
        totalSpend30d: Math.round(totalSpend30d * 100) / 100,
        messagesProcessed30d,
        costTrend,
        constants: {
          geminiCostPer1kInput: GEMINI_COST_PER_1K_INPUT,
          geminiCostPer1kOutput: GEMINI_COST_PER_1K_OUTPUT,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ──────────────────────────────────────────
  // 12. GET /admin/cfo/viral — Viral metrics
  // ──────────────────────────────────────────
  app.get("/admin/cfo/viral", { preHandler: [requireAdmin] }, async (_request, reply) => {
    try {
      const [totalClones, referringUsersRaw, totalUsers, paidUsers] = await Promise.all([
        prisma.botClone.count(),
        prisma.botClone.groupBy({
          by: ["referredByUserId"],
        }),
        prisma.user.count(),
        prisma.user.count({
          where: { planType: "premium", subscriptionStatus: "active" },
        }),
      ]);

      const referringUsers = referringUsersRaw.length;
      const viralCoefficient = referringUsers > 0 ? totalClones / referringUsers : 0;
      const conversionRate = totalUsers > 0 ? (paidUsers / totalUsers) * 100 : 0;

      return reply.send({
        success: true,
        totalClones,
        referringUsers,
        viralCoefficient: Math.round(viralCoefficient * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        totalUsers,
        paidUsers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
