import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { BditIssuer } from "@payjarvis/bdit";
import { requireAuth, getKycLevel } from "../middleware/auth.js";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { createAuditLog } from "../services/audit.js";
import { updateTrustScore } from "../services/trust-score.js";
import { redisGet, redisSet } from "../services/redis.js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { updateAgentCounters } from "../services/agent-identity.js";
import { dispatchWebhook } from "../services/webhook-dispatcher.js";

const approvalEvents = new EventEmitter();
approvalEvents.setMaxListeners(100);

export function emitApprovalEvent(ownerId: string, event: string, data: unknown) {
  approvalEvents.emit(`approval:${ownerId}`, { event, data });
}

export function emitBotApprovalEvent(botId: string, event: string, data: unknown) {
  approvalEvents.emit(`approval:bot:${botId}`, { event, data });
}

/**
 * Expire pending approvals that have passed their expiresAt.
 * Runs as a background job every 60 seconds.
 */
async function expireApprovals() {
  try {
    const expired = await prisma.approvalRequest.findMany({
      where: {
        status: "PENDING",
        expiresAt: { lt: new Date() },
      },
      include: { transaction: true },
    });

    for (const approval of expired) {
      await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: "EXPIRED" },
      });

      // Update transaction to BLOCKED
      if (approval.transaction) {
        await prisma.transaction.update({
          where: { id: approval.transactionId },
          data: {
            decision: "BLOCKED",
            decisionReason: "Approval expired — auto-blocked",
          },
        });
      }

      // Update bot blocked count
      await prisma.bot.update({
        where: { id: approval.botId },
        data: { totalBlocked: { increment: 1 } },
      });

      // Trust score penalty for expiration
      await updateTrustScore(approval.botId, "BLOCKED", "approval_timeout", false, "system");

      await createAuditLog({
        entityType: "approval",
        entityId: approval.id,
        action: "transaction.expired",
        actorType: "system",
        actorId: "expiration-job",
        payload: {
          transactionId: approval.transactionId,
          amount: approval.amount,
          reason: "approval_timeout",
        },
      });

      // Emit SSE so frontend removes expired item
      emitApprovalEvent(approval.ownerId, "approval_expired", {
        id: approval.id,
        status: "EXPIRED",
      });
      emitBotApprovalEvent(approval.botId, "approval_decided", {
        id: approval.id,
        status: "EXPIRED",
        transactionId: approval.transactionId,
      });
    }
  } catch (err) {
    console.error("[ExpireJob] Error:", err);
  }
}

export async function approvalRoutes(app: FastifyInstance) {
  const env = process.env.BDIT_ENV ?? process.env.NODE_ENV ?? "development";
  const issuerName = env === "production" ? "payjarvis" : `payjarvis-${env}`;
  const defaultKid = `payjarvis-${env}-001`;

  const issuer = new BditIssuer(
    (process.env.PAYJARVIS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    process.env.PAYJARVIS_KEY_ID ?? defaultKid,
    issuerName
  );

  // Start background expiration job — every 60 seconds
  const expirationInterval = setInterval(expireApprovals, 60_000);
  // Run once immediately on startup
  setTimeout(expireApprovals, 5000);

  // Cleanup on server close
  app.addHook("onClose", () => {
    clearInterval(expirationInterval);
  });

  // SSE stream for real-time approval updates
  app.get("/api/approvals/stream", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (eventName: string, data: unknown) => {
      reply.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("connected", { message: "SSE connected" });

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15000);

    const listener = (payload: { event: string; data: unknown }) => {
      send(payload.event, payload.data);
    };
    approvalEvents.on(`approval:${user.id}`, listener);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      approvalEvents.off(`approval:${user.id}`, listener);
    });
  });

  // SSE stream for bot-auth (agent-sdk) — filters by botId
  app.get("/api/approvals/stream/bot", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (eventName: string, data: unknown) => {
      reply.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("connected", { message: "SSE connected", botId });

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15_000);

    const listener = (payload: { event: string; data: unknown }) => {
      send(payload.event, payload.data);
    };
    approvalEvents.on(`approval:bot:${botId}`, listener);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      approvalEvents.off(`approval:bot:${botId}`, listener);
    });
  });

  // Respond to approval request
  app.post("/api/approvals/:id/respond", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as { id: string };
    const { action, reason } = request.body as { action: "approve" | "reject"; reason?: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const approval = await prisma.approvalRequest.findFirst({
      where: { id, ownerId: user.id },
      include: { transaction: true, bot: { include: { policy: true, owner: true, agent: true } } },
    });

    if (!approval) return reply.status(404).send({ success: false, error: "Approval request not found" });

    if (approval.status !== "PENDING") {
      return reply.status(400).send({ success: false, error: `Approval already ${approval.status}` });
    }

    // Check expiration (lazy check)
    if (new Date() > approval.expiresAt) {
      await prisma.approvalRequest.update({
        where: { id },
        data: { status: "EXPIRED" },
      });

      // Auto-block the transaction
      await prisma.transaction.update({
        where: { id: approval.transactionId },
        data: { decision: "BLOCKED", decisionReason: "Approval expired" },
      });

      await prisma.bot.update({
        where: { id: approval.botId },
        data: { totalBlocked: { increment: 1 } },
      });

      await updateTrustScore(approval.botId, "BLOCKED", "approval_timeout", false, "system");

      await createAuditLog({
        entityType: "approval",
        entityId: id,
        action: "transaction.expired",
        actorType: "system",
        actorId: "lazy-check",
        payload: { transactionId: approval.transactionId, amount: approval.amount },
      });

      emitApprovalEvent(user.id, "approval_expired", { id, status: "EXPIRED" });
      emitBotApprovalEvent(approval.botId, "approval_decided", {
        id,
        status: "EXPIRED",
        transactionId: approval.transactionId,
      });

      return reply.status(400).send({ success: false, error: "Approval request has expired" });
    }

    if (action === "approve") {
      await prisma.approvalRequest.update({
        where: { id },
        data: { status: "APPROVED", respondedAt: new Date() },
      });

      const policy = approval.bot.policy!;
      const kycLevelNum = getKycLevel(approval.bot.owner.kycLevel);

      const agent = approval.bot.agent;
      const agentId = agent?.id ?? approval.agentId;

      const { token, jti, expiresAt } = await issuer.issue({
        botId: approval.botId,
        ownerId: user.id,
        trustScore: approval.bot.trustScore,
        kycLevel: kycLevelNum,
        categories: policy.allowedCategories,
        maxAmount: policy.maxPerTransaction,
        merchantId: approval.transaction.merchantId ?? "",
        amount: approval.amount,
        category: approval.category,
        sessionId: randomUUID(),
        agentId: agentId ?? undefined,
        agentTrustScore: agent?.trustScore,
        ownerVerified: approval.bot.owner.status === "ACTIVE" && kycLevelNum >= 1,
        transactionsCount: agent?.transactionsCount,
        totalSpent: agent?.totalSpent,
      });

      await prisma.bditToken.create({
        data: { jti, tokenValue: token, botId: approval.botId, agentId: agentId, amount: approval.amount, category: approval.category, expiresAt },
      });

      await prisma.transaction.update({
        where: { id: approval.transactionId },
        data: {
          decision: "APPROVED",
          approvedByHuman: true,
          bdtJti: jti,
          decisionReason: reason ?? "Approved by owner",
        },
      });

      await prisma.bot.update({
        where: { id: approval.botId },
        data: { totalApproved: { increment: 1 } },
      });

      if (agentId) {
        await updateAgentCounters(agentId, "APPROVED", approval.amount);
      }

      await updateTrustScore(approval.botId, "APPROVED", null, true, user.id, approval.amount);

      await createAuditLog({
        entityType: "approval",
        entityId: id,
        action: "approval.responded",
        actorType: "user",
        actorId: user.id,
        payload: { action: "approved", transactionId: approval.transactionId, amount: approval.amount },
        ipAddress: request.ip,
      });

      await createAuditLog({
        entityType: "bdit",
        entityId: jti,
        action: "bdit.issued",
        actorType: "system",
        actorId: approval.botId,
        payload: { botId: approval.botId, amount: approval.amount, humanApproved: true },
      });

      // Store BDIT token in Redis so the SDK can retrieve it via polling
      await redisSet(`approval:token:${id}`, token, 300);

      emitApprovalEvent(user.id, "approval_responded", {
        id,
        status: "APPROVED",
        transactionId: approval.transactionId,
      });
      emitBotApprovalEvent(approval.botId, "approval_decided", {
        id,
        status: "APPROVED",
        transactionId: approval.transactionId,
        bditToken: token,
      });

      // Dispatch webhook to external platforms
      dispatchWebhook("transaction.approved", {
        transactionId: approval.transactionId,
        approvalId: id,
        botId: approval.botId,
        amount: approval.amount,
        category: approval.category,
        merchantName: approval.transaction.merchantName ?? "",
        bditToken: token,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        data: {
          status: "APPROVED",
          bditToken: token,
          expiresAt: expiresAt.toISOString(),
        },
      };
    }

    // Reject
    await prisma.approvalRequest.update({
      where: { id },
      data: { status: "REJECTED", respondedAt: new Date() },
    });

    await prisma.transaction.update({
      where: { id: approval.transactionId },
      data: {
        decision: "BLOCKED",
        decisionReason: reason ?? "Rejected by owner",
      },
    });

    await prisma.bot.update({
      where: { id: approval.botId },
      data: { totalBlocked: { increment: 1 } },
    });

    await updateTrustScore(approval.botId, "BLOCKED", null, false, user.id, approval.amount);

    await createAuditLog({
      entityType: "approval",
      entityId: id,
      action: "approval.responded",
      actorType: "user",
      actorId: user.id,
      payload: { action: "rejected", transactionId: approval.transactionId, reason },
      ipAddress: request.ip,
    });

    emitApprovalEvent(user.id, "approval_responded", {
      id,
      status: "REJECTED",
      transactionId: approval.transactionId,
    });
    emitBotApprovalEvent(approval.botId, "approval_decided", {
      id,
      status: "REJECTED",
      transactionId: approval.transactionId,
    });

    // Dispatch webhook to external platforms
    dispatchWebhook("transaction.rejected", {
      transactionId: approval.transactionId,
      approvalId: id,
      botId: approval.botId,
      amount: approval.amount,
      category: approval.category,
      merchantName: approval.transaction.merchantName ?? "",
      reason: reason ?? "Rejected by owner",
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      data: { status: "REJECTED" },
    };
  });

  // GET /approvals/:id/status — bot-auth: poll approval status from SDK
  app.get("/api/approvals/:id/status", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const { id } = request.params as { id: string };

    const approval = await prisma.approvalRequest.findFirst({
      where: { id, botId },
      include: { transaction: true },
    });

    if (!approval) return reply.status(404).send({ success: false, error: "Approval not found" });

    // Lazy expire check
    if (approval.status === "PENDING" && new Date() > approval.expiresAt) {
      await prisma.approvalRequest.update({ where: { id }, data: { status: "EXPIRED" } });
      return {
        success: true,
        data: { status: "EXPIRED", transactionId: approval.transactionId },
      };
    }

    // If approved, try to retrieve the BDIT token from Redis
    let bditToken: string | null = null;
    if (approval.status === "APPROVED") {
      bditToken = await redisGet(`approval:token:${id}`);
    }

    return {
      success: true,
      data: {
        status: approval.status,
        transactionId: approval.transactionId,
        bditToken: bditToken ?? undefined,
        expiresAt: approval.expiresAt.toISOString(),
      },
    };
  });

  // List pending approvals — with lazy expiration check
  app.get("/api/approvals", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    // Lazy-expire any that have passed
    const now = new Date();
    await prisma.approvalRequest.updateMany({
      where: {
        ownerId: user.id,
        status: "PENDING",
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED" },
    });

    const approvals = await prisma.approvalRequest.findMany({
      where: { ownerId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: approvals };
  });

}
