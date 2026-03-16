/**
 * Admin Users Routes — CRUD + management for all PayJarvis users.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../services/admin-auth.service.js";

const prisma = new PrismaClient();

export async function adminUsersRoutes(app: FastifyInstance) {
  // GET /admin/users — paginated list with filters
  app.get("/admin/users", { preHandler: [requireAdmin] }, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1"));
    const limit = Math.min(100, parseInt(q.limit || "50"));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (q.search) {
      where.OR = [
        { fullName: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
      ];
    }
    if (q.plan) where.planType = q.plan;
    if (q.active === "true") {
      where.updatedAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    }
    if (q.active === "false") {
      where.updatedAt = { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    }
    if (q.joinedAfter) where.createdAt = { ...where.createdAt, gte: new Date(q.joinedAfter) };
    if (q.joinedBefore) where.createdAt = { ...where.createdAt, lte: new Date(q.joinedBefore) };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          telegramChatId: true,
          notificationChannel: true,
          planType: true,
          status: true,
          onboardingCompleted: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Enrich with credit info
    const userIds = users.map((u) => u.id);
    const credits = await prisma.llmCredit.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, messagesRemaining: true, messagesTotal: true },
    });
    const creditMap = new Map(credits.map((c) => [c.userId, c]));

    const enriched = users.map((u) => {
      const platform = u.telegramChatId ? "telegram" : u.notificationChannel === "none" ? "web" : u.notificationChannel;
      const credit = creditMap.get(u.id);
      return {
        ...u,
        platform,
        messagesRemaining: credit?.messagesRemaining ?? 0,
        messagesTotal: credit?.messagesTotal ?? 0,
      };
    });

    return reply.send({
      success: true,
      users: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // GET /admin/users/:id — full profile
  app.get("/admin/users/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        bots: { select: { id: true, name: true, platform: true, status: true } },
      },
    });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const [credit, sequence, transactionCount, totalSpent] = await Promise.all([
      prisma.llmCredit.findUnique({ where: { userId: id } }),
      prisma.onboardingSequence.findUnique({ where: { userId: id } }),
      prisma.transaction.count({ where: { ownerId: id } }),
      prisma.transaction.aggregate({ _sum: { amount: true }, where: { ownerId: id, decision: "APPROVED" } }),
    ]);

    return reply.send({
      success: true,
      user,
      credit,
      sequence,
      stats: {
        totalTransactions: transactionCount,
        totalSpent: totalSpent._sum.amount || 0,
      },
    });
  });

  // GET /admin/users/:id/messages — last 50 messages
  app.get("/admin/users/:id/messages", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const messages = await prisma.llmUsageLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send({ success: true, messages });
  });

  // GET /admin/users/:id/transactions — purchase history
  app.get("/admin/users/:id/transactions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const transactions = await prisma.transaction.findMany({
      where: { ownerId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const purchases = await prisma.creditPurchase.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ success: true, transactions, purchases });
  });

  // PUT /admin/users/:id/plan — change plan
  app.put("/admin/users/:id/plan", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { planType } = request.body as { planType: string };
    if (!["free", "premium"].includes(planType)) {
      return reply.status(400).send({ success: false, error: "Invalid plan" });
    }
    const user = await prisma.user.update({ where: { id }, data: { planType } });
    return reply.send({ success: true, user: { id: user.id, planType: user.planType } });
  });

  // PUT /admin/users/:id/credits — add credits manually
  app.put("/admin/users/:id/credits", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { amount } = request.body as { amount: number };
    if (!amount || amount <= 0) {
      return reply.status(400).send({ success: false, error: "Positive amount required" });
    }
    const credit = await prisma.llmCredit.upsert({
      where: { userId: id },
      create: { userId: id, messagesTotal: amount, messagesRemaining: amount },
      update: {
        messagesTotal: { increment: amount },
        messagesRemaining: { increment: amount },
      },
    });
    return reply.send({ success: true, credit });
  });

  // DELETE /admin/users/:id — remove user
  app.delete("/admin/users/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.user.delete({ where: { id } });
      return reply.send({ success: true });
    } catch {
      return reply.status(404).send({ success: false, error: "User not found" });
    }
  });
}
