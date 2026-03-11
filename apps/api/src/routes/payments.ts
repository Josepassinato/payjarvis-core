import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { BditIssuer } from "@payjarvis/bdit";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { requireAuth } from "../middleware/auth.js";
import { getKycLevel } from "../middleware/auth.js";
import { createAuditLog } from "../services/audit.js";
import { updateTrustScore } from "../services/trust-score.js";
import { redisSet, redisExists } from "../services/redis.js";
import { randomUUID } from "node:crypto";
import { emitApprovalEvent, emitBotApprovalEvent } from "./approvals.js";
import { notifyApprovalCreated, notifyTransactionApproved, notifyTransactionBlocked } from "../services/notifications.js";
import { resolveAgentId, getAgentByBotId, updateAgentCounters } from "../services/agent-identity.js";
import { TRUST_THRESHOLD_BLOCK } from "@payjarvis/types";

export async function paymentRoutes(app: FastifyInstance) {
  const issuer = new BditIssuer(
    (process.env.PAYJARVIS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    process.env.PAYJARVIS_KEY_ID ?? "payjarvis-key-001"
  );

  // Request payment — authenticated by bot API key
  app.post("/bots/:botId/request-payment", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const botOwnerId = (request as any).botOwnerId as string;
    const { botId: paramBotId } = request.params as { botId: string };

    // Ensure the bot from API key matches the URL param
    if (botId !== paramBotId) {
      return reply.status(403).send({ success: false, error: "API key does not match the requested bot" });
    }

    const { merchantId, merchantName, amount, currency, category } = request.body as {
      merchantId: string;
      merchantName: string;
      amount: number;
      currency?: string;
      category: string;
    };

    // Check Redis for bot revocation
    const revoked = await redisExists(`revoked:bot:${botId}`);
    if (revoked) {
      return reply.status(403).send({ success: false, error: "Bot is revoked or paused" });
    }

    const bot = await prisma.bot.findFirst({
      where: { id: botId },
      include: { policy: true, owner: true, agent: true },
    });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });
    if (bot.status !== "ACTIVE") {
      return reply.status(403).send({ success: false, error: "Bot is not active" });
    }

    const policy = bot.policy;
    if (!policy) {
      return reply.status(400).send({ success: false, error: "Bot has no policy configured" });
    }

    const agent = bot.agent;
    const agentId = agent?.id ?? null;

    // Agent trust threshold pre-check
    if (agent && agent.trustScore < TRUST_THRESHOLD_BLOCK) {
      return reply.status(403).send({
        success: false,
        error: "Agent trust score too low",
        data: { trustScore: agent.trustScore, threshold: TRUST_THRESHOLD_BLOCK },
      });
    }

    // Call rules engine
    const rulesEngineUrl = process.env.RULES_ENGINE_URL ?? "http://localhost:3002";
    const rulesResponse = await fetch(`${rulesEngineUrl}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: bot.id,
        ownerId: bot.ownerId,
        merchantId,
        merchantName,
        amount,
        category,
        policy: {
          maxPerTransaction: policy.maxPerTransaction,
          maxPerDay: policy.maxPerDay,
          maxPerWeek: policy.maxPerWeek,
          maxPerMonth: policy.maxPerMonth,
          autoApproveLimit: policy.autoApproveLimit,
          requireApprovalUp: policy.requireApprovalUp,
          allowedDays: policy.allowedDays,
          allowedHoursStart: policy.allowedHoursStart,
          allowedHoursEnd: policy.allowedHoursEnd,
          allowedCategories: policy.allowedCategories,
          blockedCategories: policy.blockedCategories,
          merchantWhitelist: policy.merchantWhitelist,
          merchantBlacklist: policy.merchantBlacklist,
        },
        botTrustScore: bot.trustScore,
        agentId: agentId,
        agentTrustScore: agent?.trustScore,
      }),
    });

    const rulesResult = await rulesResponse.json() as {
      decision: string;
      reason: string;
      ruleTriggered: string | null;
    };

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        botId: bot.id,
        agentId: agentId,
        ownerId: bot.ownerId,
        merchantId,
        merchantName,
        amount,
        currency: currency ?? "BRL",
        category,
        decision: rulesResult.decision as any,
        decisionReason: rulesResult.reason,
      },
    });

    // Handle APPROVED
    if (rulesResult.decision === "APPROVED") {
      const kycLevelNum = getKycLevel(bot.owner.kycLevel);

      const { token, jti, expiresAt } = await issuer.issue({
        botId: bot.id,
        ownerId: bot.ownerId,
        trustScore: bot.trustScore,
        kycLevel: kycLevelNum,
        categories: policy.allowedCategories,
        maxAmount: policy.maxPerTransaction,
        merchantId,
        amount,
        category,
        sessionId: randomUUID(),
        agentId: agentId ?? undefined,
        agentTrustScore: agent?.trustScore,
        ownerVerified: bot.owner.status === "ACTIVE" && kycLevelNum >= 1,
        transactionsCount: agent?.transactionsCount,
        totalSpent: agent?.totalSpent,
      });

      await prisma.bditToken.create({
        data: { jti, tokenValue: token, botId: bot.id, agentId: agentId, amount, category, expiresAt },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { bdtJti: jti },
      });

      await prisma.bot.update({
        where: { id: bot.id },
        data: { totalApproved: { increment: 1 } },
      });

      // Update agent counters
      if (agentId) {
        await updateAgentCounters(agentId, "APPROVED", amount);
      }

      await updateTrustScore(bot.id, "APPROVED", null, false, bot.ownerId, amount, merchantId);

      await createAuditLog({
        entityType: "transaction",
        entityId: transaction.id,
        action: "transaction.approved",
        actorType: "bot",
        actorId: bot.id,
        payload: { amount, merchantName, jti },
        ipAddress: request.ip,
      });

      await createAuditLog({
        entityType: "bdit",
        entityId: jti,
        action: "bdit.issued",
        actorType: "system",
        actorId: bot.id,
        payload: { botId: bot.id, amount, merchantId, expiresAt: expiresAt.toISOString() },
      });

      // Fire-and-forget Telegram notification
      notifyTransactionApproved(bot.ownerId, {
        botName: bot.name,
        merchantName,
        amount,
        currency: currency ?? "BRL",
        transactionId: transaction.id,
      }).catch(err => console.error("[Notification]", err));

      return {
        success: true,
        data: {
          decision: "APPROVED",
          transactionId: transaction.id,
          bditToken: token,
          expiresAt: expiresAt.toISOString(),
        },
      };
    }

    // Handle PENDING_HUMAN
    if (rulesResult.decision === "PENDING_HUMAN") {
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      const approval = await prisma.approvalRequest.create({
        data: {
          transactionId: transaction.id,
          botId: bot.id,
          agentId: agentId,
          ownerId: bot.ownerId,
          amount,
          merchantName,
          category,
          expiresAt,
        },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { approvalId: approval.id },
      });

      // Save in Redis with TTL 300s (5 min)
      await redisSet(
        `approval:${approval.id}`,
        JSON.stringify({
          id: approval.id,
          botId: bot.id,
          ownerId: bot.ownerId,
          amount,
          merchantName,
          category,
          transactionId: transaction.id,
          expiresAt: expiresAt.toISOString(),
        }),
        300
      );

      // Emit SSE event for new approval
      emitApprovalEvent(bot.ownerId, "approval_created", {
        id: approval.id,
        botId: bot.id,
        amount,
        merchantName,
        category,
        expiresAt: expiresAt.toISOString(),
      });
      emitBotApprovalEvent(bot.id, "approval_created", {
        id: approval.id,
        amount,
        merchantName,
        category,
        expiresAt: expiresAt.toISOString(),
      });

      // Fire-and-forget Telegram notification
      notifyApprovalCreated(bot.ownerId, {
        botName: bot.name,
        amount,
        merchantName,
        approvalId: approval.id,
      }).catch(err => console.error("[Notification]", err));

      await createAuditLog({
        entityType: "transaction",
        entityId: transaction.id,
        action: "transaction.pending_human",
        actorType: "bot",
        actorId: bot.id,
        payload: { amount, merchantName, reason: rulesResult.reason, approvalId: approval.id },
        ipAddress: request.ip,
      });

      return {
        success: true,
        data: {
          decision: "PENDING_HUMAN",
          transactionId: transaction.id,
          approvalId: approval.id,
          reason: rulesResult.reason,
          expiresAt: expiresAt.toISOString(),
        },
      };
    }

    // BLOCKED
    await prisma.bot.update({
      where: { id: bot.id },
      data: { totalBlocked: { increment: 1 } },
    });

    if (agentId) {
      await updateAgentCounters(agentId, "BLOCKED", amount);
    }

    await updateTrustScore(bot.id, "BLOCKED", rulesResult.ruleTriggered, false, bot.ownerId, amount, merchantId);

    await createAuditLog({
      entityType: "transaction",
      entityId: transaction.id,
      action: "transaction.blocked",
      actorType: "bot",
      actorId: bot.id,
      payload: { amount, merchantName, reason: rulesResult.reason, ruleTriggered: rulesResult.ruleTriggered },
      ipAddress: request.ip,
    });

    // Fire-and-forget Telegram notification
    notifyTransactionBlocked(bot.ownerId, {
      botName: bot.name,
      merchantName,
      amount,
      currency: currency ?? "BRL",
      reason: rulesResult.reason,
      ruleTriggered: rulesResult.ruleTriggered,
    }).catch(err => console.error("[Notification]", err));

    return {
      success: true,
      data: {
        decision: "BLOCKED",
        transactionId: transaction.id,
        reason: rulesResult.reason,
        ruleTriggered: rulesResult.ruleTriggered,
      },
    };
  });

  // BDIT confirm-use — mark token as used (one-time use enforcement)
  app.post("/bdit/confirm-use", { preHandler: [requireAuth] }, async (request, reply) => {
    const { jti } = request.body as { jti: string };

    if (!jti) {
      return reply.status(400).send({ success: false, error: "jti is required" });
    }

    const token = await prisma.bditToken.findUnique({ where: { jti } });
    if (!token) {
      return reply.status(404).send({ success: false, error: "Token not found" });
    }

    if (token.status === "USED") {
      return reply.status(409).send({
        success: false,
        error: "TOKEN_ALREADY_USED",
        reason: "This BDIT token has already been used",
      });
    }

    if (token.status === "REVOKED") {
      return reply.status(409).send({
        success: false,
        error: "TOKEN_REVOKED",
        reason: "This BDIT token has been revoked",
      });
    }

    if (token.status === "EXPIRED" || token.expiresAt < new Date()) {
      await prisma.bditToken.update({
        where: { jti },
        data: { status: "EXPIRED" },
      });
      return reply.status(409).send({
        success: false,
        error: "TOKEN_EXPIRED",
        reason: "This BDIT token has expired",
      });
    }

    // Mark as used
    await prisma.bditToken.update({
      where: { jti },
      data: { status: "USED", usedAt: new Date() },
    });

    // Mark in Redis for fast lookup
    await redisSet(`bdit:used:${jti}`, "1", 600);

    await createAuditLog({
      entityType: "bdit",
      entityId: jti,
      action: "bdit.used",
      actorType: "system",
      actorId: token.botId,
      payload: { botId: token.botId, amount: token.amount, category: token.category },
    });

    return {
      success: true,
      data: { jti, status: "USED", usedAt: new Date().toISOString() },
    };
  });

  // BDIT check-status — verify if a JTI is valid for use
  app.get("/bdit/status/:jti", async (request, reply) => {
    const { jti } = request.params as { jti: string };

    // Fast check in Redis first
    const usedInRedis = await redisExists(`bdit:used:${jti}`);
    if (usedInRedis) {
      return { valid: false, status: "USED", reason: "TOKEN_ALREADY_USED" };
    }

    const token = await prisma.bditToken.findUnique({ where: { jti } });
    if (!token) {
      return reply.status(404).send({ valid: false, reason: "Token not found" });
    }

    if (token.status !== "ISSUED") {
      return { valid: false, status: token.status, reason: `Token is ${token.status}` };
    }

    if (token.expiresAt < new Date()) {
      return { valid: false, status: "EXPIRED", reason: "Token has expired" };
    }

    return { valid: true, status: "ISSUED", expiresAt: token.expiresAt.toISOString() };
  });
}
