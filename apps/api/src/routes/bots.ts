import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth, getKycLevel, getInitialTrustScore } from "../middleware/auth.js";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { createAuditLog } from "../services/audit.js";
import { getReputation } from "../services/reputation.js";
import { redisSet, redisDel } from "../services/redis.js";
import { createHash, randomBytes } from "node:crypto";
import { createAgent, resolveAgentId, syncAgentStatus } from "../services/agent-identity.js";
import { trustScoreBotToAgent } from "@payjarvis/types";

// Default policy created with every new bot
const DEFAULT_POLICY = {
  maxPerTransaction: 50,
  maxPerDay: 200,
  maxPerWeek: 500,
  maxPerMonth: 2000,
  autoApproveLimit: 50,
  requireApprovalUp: 200,
  allowedDays: [1, 2, 3, 4, 5], // Mon-Fri
  allowedHoursStart: 6,
  allowedHoursEnd: 22,
  allowedCategories: [],
  blockedCategories: [],
  merchantWhitelist: [],
  merchantBlacklist: [],
};

export async function botRoutes(app: FastifyInstance) {
  // Create bot + auto-create policy with defaults
  app.post("/api/bots", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { name, platform } = request.body as { name: string; platform: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const apiKey = `pj_bot_${randomBytes(32).toString("hex")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

    // Initial trust score based on user KYC level
    const kycLevelNum = getKycLevel(user.kycLevel);
    const initialTrustScore = getInitialTrustScore(kycLevelNum);

    const bot = await prisma.bot.create({
      data: {
        name,
        platform: platform as any,
        ownerId: user.id,
        apiKeyHash,
        trustScore: initialTrustScore,
      },
    });

    // Auto-create default policy
    const policy = await prisma.policy.create({
      data: {
        botId: bot.id,
        ...DEFAULT_POLICY,
      },
    });

    // Auto-create agent identity
    const agent = await createAgent(bot.id, user.id, name, user.kycLevel);

    await createAuditLog({
      entityType: "bot",
      entityId: bot.id,
      action: "bot.created",
      actorType: "user",
      actorId: user.id,
      payload: { name, platform, initialTrustScore, kycLevel: kycLevelNum, agentId: agent.id },
      ipAddress: request.ip,
    });

    await createAuditLog({
      entityType: "policy",
      entityId: policy.id,
      action: "policy.created",
      actorType: "system",
      actorId: user.id,
      payload: DEFAULT_POLICY,
    });

    return reply.status(201).send({
      success: true,
      data: { ...bot, apiKey, policy, agentId: agent.id },
    });
  });

  // List bots
  app.get("/api/bots", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    const bots = await prisma.bot.findMany({
      where: { ownerId: user.id },
      include: { policy: true, agent: { select: { id: true, trustScore: true, status: true, transactionsCount: true, totalSpent: true } } },
    });

    return { success: true, data: bots };
  });

  // Get single bot
  app.get("/api/bots/:botId", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({
      where: { id: botId, ownerId: user.id },
      include: { policy: true, agent: { include: { reputation: true } } },
    });

    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });
    return { success: true, data: bot };
  });

  // Update bot (name/platform)
  app.patch("/api/bots/:botId", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const updates = request.body as Record<string, unknown>;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const existing = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!existing) return reply.status(404).send({ success: false, error: "Bot not found" });

    const allowedFields = ["name", "platform", "systemPrompt", "botDisplayName", "capabilities", "language"];
    const filtered: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in updates) filtered[key] = updates[key];
    }

    const bot = await prisma.bot.update({
      where: { id: botId },
      data: filtered,
    });

    await createAuditLog({
      entityType: "bot",
      entityId: bot.id,
      action: "bot.updated",
      actorType: "user",
      actorId: user.id,
      payload: filtered,
      ipAddress: request.ip,
    });

    return { success: true, data: bot };
  });

  // Dedicated status endpoint — PATCH /bots/:botId/status
  app.patch("/api/bots/:botId/status", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const { status } = request.body as { status: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const existing = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!existing) return reply.status(404).send({ success: false, error: "Bot not found" });

    const normalizedStatus = status.toUpperCase();

    // Validate status transitions
    if (!["ACTIVE", "PAUSED", "REVOKED"].includes(normalizedStatus)) {
      return reply.status(400).send({ success: false, error: "Invalid status. Must be: active, paused, or revoked" });
    }

    if (existing.status === "REVOKED") {
      return reply.status(400).send({ success: false, error: "Cannot change status of a revoked bot" });
    }

    // At this point existing.status is ACTIVE or PAUSED (REVOKED returned above)

    const bot = await prisma.bot.update({
      where: { id: botId },
      data: { status: normalizedStatus as any },
    });

    // Sync agent status
    await syncAgentStatus(botId, normalizedStatus);

    // Redis revocation tracking
    if (normalizedStatus === "PAUSED" || normalizedStatus === "REVOKED") {
      await redisSet(`revoked:bot:${botId}`, "1");
    } else if (normalizedStatus === "ACTIVE") {
      await redisDel(`revoked:bot:${botId}`);
    }

    await createAuditLog({
      entityType: "bot",
      entityId: bot.id,
      action: "bot.status_changed",
      actorType: "user",
      actorId: user.id,
      payload: { previousStatus: existing.status, newStatus: normalizedStatus },
      ipAddress: request.ip,
    });

    // Log suspension specifically
    if (normalizedStatus === "PAUSED" || normalizedStatus === "REVOKED") {
      await createAuditLog({
        entityType: "bot",
        entityId: bot.id,
        action: normalizedStatus === "REVOKED" ? "bot.revoked" : "bot.suspended",
        actorType: "user",
        actorId: user.id,
        payload: { reason: "manual_action" },
        ipAddress: request.ip,
      });
    }

    return { success: true, data: bot };
  });

  // Delete bot
  app.delete("/api/bots/:botId", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const existing = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!existing) return reply.status(404).send({ success: false, error: "Bot not found" });

    // Clean up Telegram webhook if connected
    const telegramIntegration = await prisma.botIntegration.findUnique({
      where: { botId_provider: { botId, provider: "telegram_bot" } },
    });
    if (telegramIntegration?.config) {
      const tgConfig = telegramIntegration.config as Record<string, unknown>;
      const tgToken = tgConfig.telegramBotToken as string;
      if (tgToken) {
        try {
          await fetch(`https://api.telegram.org/bot${tgToken}/deleteWebhook`, {
            method: "POST",
            signal: AbortSignal.timeout(5_000),
          });
        } catch {
          // Best-effort cleanup — don't block deletion
        }
      }
    }

    // Revoke in Redis before deleting
    await redisSet(`revoked:bot:${botId}`, "1");

    await prisma.bot.delete({ where: { id: botId } });

    await createAuditLog({
      entityType: "bot",
      entityId: botId,
      action: "bot.deleted",
      actorType: "user",
      actorId: user.id,
      ipAddress: request.ip,
    });

    return { success: true, message: "Bot deleted" };
  });

  // GET /bots/:botId/limits — check spending limits (bot-auth or user-auth)
  app.get("/api/bots/:botId/limits", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({
      where: { id: botId, ownerId: user.id },
      include: { policy: true },
    });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });
    if (!bot.policy) return reply.status(400).send({ success: false, error: "No policy configured" });

    const policy = bot.policy;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyResult, weeklyResult, monthlyResult] = await Promise.all([
      prisma.transaction.aggregate({
        where: { botId, decision: "APPROVED", createdAt: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { botId, decision: "APPROVED", createdAt: { gte: startOfWeek } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { botId, decision: "APPROVED", createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const spentToday = dailyResult._sum.amount ?? 0;
    const spentWeek = weeklyResult._sum.amount ?? 0;
    const spentMonth = monthlyResult._sum.amount ?? 0;

    return {
      success: true,
      data: {
        perTransaction: policy.maxPerTransaction,
        perDay: policy.maxPerDay,
        perWeek: policy.maxPerWeek,
        perMonth: policy.maxPerMonth,
        autoApproveLimit: policy.autoApproveLimit,
        spentToday,
        spentWeek,
        spentMonth,
        remainingToday: Math.max(0, policy.maxPerDay - spentToday),
        remainingWeek: Math.max(0, policy.maxPerWeek - spentWeek),
        remainingMonth: Math.max(0, policy.maxPerMonth - spentMonth),
      },
    };
  });

  // GET /bots/:botId/limits/sdk — bot-auth variant for agent-sdk
  app.get("/api/bots/:botId/limits/sdk", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const { botId: paramBotId } = request.params as { botId: string };

    if (botId !== paramBotId) {
      return reply.status(403).send({ success: false, error: "API key does not match the requested bot" });
    }

    const bot = await prisma.bot.findFirst({
      where: { id: botId },
      include: { policy: true },
    });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });
    if (!bot.policy) return reply.status(400).send({ success: false, error: "No policy configured" });

    const policy = bot.policy;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyResult, weeklyResult, monthlyResult] = await Promise.all([
      prisma.transaction.aggregate({
        where: { botId, decision: "APPROVED", createdAt: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { botId, decision: "APPROVED", createdAt: { gte: startOfWeek } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { botId, decision: "APPROVED", createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const spentToday = dailyResult._sum.amount ?? 0;
    const spentWeek = weeklyResult._sum.amount ?? 0;
    const spentMonth = monthlyResult._sum.amount ?? 0;

    return {
      success: true,
      data: {
        perTransaction: policy.maxPerTransaction,
        perDay: policy.maxPerDay,
        perWeek: policy.maxPerWeek,
        perMonth: policy.maxPerMonth,
        autoApproveLimit: policy.autoApproveLimit,
        spentToday,
        spentWeek,
        spentMonth,
        remainingToday: Math.max(0, policy.maxPerDay - spentToday),
        remainingWeek: Math.max(0, policy.maxPerWeek - spentWeek),
        remainingMonth: Math.max(0, policy.maxPerMonth - spentMonth),
      },
    };
  });

  // GET /bots/:botId/reputation — full agent reputation data
  app.get("/api/bots/:botId/reputation", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const agentId = await resolveAgentId(botId);
    if (!agentId) return reply.status(404).send({ success: false, error: "Agent not found for this bot" });

    const reputation = await getReputation(agentId);
    if (!reputation) return reply.status(404).send({ success: false, error: "Reputation data not found" });

    return { success: true, data: reputation };
  });

  // GET /bots/:botId/reputation/sdk — bot-auth variant for agent-sdk
  app.get("/api/bots/:botId/reputation/sdk", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const { botId: paramBotId } = request.params as { botId: string };

    if (botId !== paramBotId) {
      return reply.status(403).send({ success: false, error: "API key does not match the requested bot" });
    }

    const agentId = await resolveAgentId(botId);
    if (!agentId) return reply.status(404).send({ success: false, error: "Agent not found" });

    const reputation = await getReputation(agentId);
    if (!reputation) return reply.status(404).send({ success: false, error: "Reputation data not found" });

    return { success: true, data: reputation };
  });

  // KYC: Update user KYC level
  app.patch("/users/kyc", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { kycLevel } = request.body as { kycLevel: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const validLevels = ["NONE", "BASIC", "VERIFIED", "ENHANCED"];
    const normalized = kycLevel.toUpperCase();
    if (!validLevels.includes(normalized)) {
      return reply.status(400).send({ success: false, error: "Invalid KYC level" });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { kycLevel: normalized as any },
    });

    await createAuditLog({
      entityType: "user",
      entityId: user.id,
      action: "user.kyc_updated",
      actorType: "user",
      actorId: user.id,
      payload: { previousLevel: user.kycLevel, newLevel: normalized },
      ipAddress: request.ip,
    });

    return { success: true, data: { kycLevel: updated.kycLevel } };
  });

}
