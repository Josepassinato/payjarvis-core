import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";

export async function analyticsRoutes(app: FastifyInstance) {
  // Spending trends — daily spending for the last 30 days
  app.get("/analytics/spending-trends", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const transactions = await prisma.transaction.findMany({
      where: {
        ownerId: user.id,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Group by date
    const byDate = new Map<string, { total: number; count: number }>();

    // Pre-fill all 30 days so the chart has no gaps
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDate.set(key, { total: 0, count: 0 });
    }

    for (const tx of transactions) {
      const key = tx.createdAt.toISOString().slice(0, 10);
      const entry = byDate.get(key) ?? { total: 0, count: 0 };
      entry.total += tx.amount;
      entry.count += 1;
      byDate.set(key, entry);
    }

    const data = Array.from(byDate.entries()).map(([date, { total, count }]) => ({
      date,
      total: Math.round(total * 100) / 100,
      count,
    }));

    return { success: true, data };
  });

  // Spending by category
  app.get("/analytics/by-category", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    const transactions = await prisma.transaction.findMany({
      where: { ownerId: user.id },
      select: {
        category: true,
        amount: true,
      },
    });

    const byCategory = new Map<string, { total: number; count: number }>();
    for (const tx of transactions) {
      const entry = byCategory.get(tx.category) ?? { total: 0, count: 0 };
      entry.total += tx.amount;
      entry.count += 1;
      byCategory.set(tx.category, entry);
    }

    const data = Array.from(byCategory.entries())
      .map(([category, { total, count }]) => ({
        category,
        total: Math.round(total * 100) / 100,
        count,
      }))
      .sort((a, b) => b.total - a.total);

    return { success: true, data };
  });

  // Decision breakdown
  app.get("/analytics/decisions", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    const transactions = await prisma.transaction.findMany({
      where: { ownerId: user.id },
      select: {
        decision: true,
        amount: true,
      },
    });

    const byDecision = new Map<string, { count: number; total: number }>();
    for (const tx of transactions) {
      const entry = byDecision.get(tx.decision) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += tx.amount;
      byDecision.set(tx.decision, entry);
    }

    const data = Array.from(byDecision.entries()).map(([decision, { count, total }]) => ({
      decision,
      count,
      total: Math.round(total * 100) / 100,
    }));

    return { success: true, data };
  });

  // Spending per bot
  app.get("/analytics/by-bot", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    const transactions = await prisma.transaction.findMany({
      where: { ownerId: user.id },
      select: {
        botId: true,
        amount: true,
      },
    });

    const byBot = new Map<string, { total: number; count: number }>();
    for (const tx of transactions) {
      const entry = byBot.get(tx.botId) ?? { total: 0, count: 0 };
      entry.total += tx.amount;
      entry.count += 1;
      byBot.set(tx.botId, entry);
    }

    // Fetch bot names
    const botIds = Array.from(byBot.keys());
    const bots = botIds.length > 0
      ? await prisma.bot.findMany({
          where: { id: { in: botIds } },
          select: { id: true, name: true },
        })
      : [];

    const botNameMap = new Map(bots.map((b: { id: string; name: string }) => [b.id, b.name]));

    const data = Array.from(byBot.entries())
      .map(([botId, { total, count }]) => ({
        botId,
        botName: botNameMap.get(botId) ?? "Unknown Bot",
        total: Math.round(total * 100) / 100,
        count,
      }))
      .sort((a, b) => b.total - a.total);

    return { success: true, data };
  });
}
