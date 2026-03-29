/**
 * Core Routes — /api/core/*
 *
 * Layer 1 endpoints: policy, approvals, audit, sessions, status.
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { prisma } from "@payjarvis/database";
import {
  evaluatePolicy,
  getTrustLevel,
  approve,
  reject,
  getSession,
  createSession,
  updateSession,
  endSession,
  execute,
  logEvent,
  AuditEvents,
} from "../core/index.js";

export async function coreRoutes(app: FastifyInstance) {
  // ─── Policy ───────────────────────────────────────

  app.get(
    "/api/core/policy/:botId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { botId } = request.params as { botId: string };
      const userId = (request as any).userId as string;

      const bot = await prisma.bot.findUnique({ where: { id: botId } });
      if (!bot || bot.ownerId !== userId) {
        return reply.status(404).send({ error: "Bot not found" });
      }

      const policy = await prisma.policy.findUnique({ where: { botId } });
      const trustLevel = await getTrustLevel(botId);

      return { policy, trustLevel };
    }
  );

  app.put(
    "/api/core/policy/:botId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { botId } = request.params as { botId: string };
      const userId = (request as any).userId as string;
      const body = request.body as Record<string, unknown>;

      const bot = await prisma.bot.findUnique({ where: { id: botId } });
      if (!bot || bot.ownerId !== userId) {
        return reply.status(404).send({ error: "Bot not found" });
      }

      const updatable = [
        "maxPerTransaction", "maxPerDay", "maxPerWeek", "maxPerMonth",
        "autoApproveLimit", "allowedDays", "allowedHoursStart", "allowedHoursEnd",
        "timezone", "allowedCategories", "blockedCategories",
        "merchantWhitelist", "merchantBlacklist",
      ];

      const data: Record<string, unknown> = {};
      for (const key of updatable) {
        if (body[key] !== undefined) data[key] = body[key];
      }

      const policy = await prisma.policy.upsert({
        where: { botId },
        update: data,
        create: { botId, ...data },
      });

      await logEvent({
        botId,
        userId,
        event: "POLICY_UPDATED",
        layer: 1,
        payload: { changes: Object.keys(data) },
      });

      return { policy };
    }
  );

  // ─── Approvals ────────────────────────────────────

  app.get(
    "/api/core/approvals/:botId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { botId } = request.params as { botId: string };
      const userId = (request as any).userId as string;

      const bot = await prisma.bot.findUnique({ where: { id: botId } });
      if (!bot || bot.ownerId !== userId) {
        return reply.status(404).send({ error: "Bot not found" });
      }

      const approvals = await prisma.approvalRequest.findMany({
        where: { botId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return { approvals };
    }
  );

  app.post(
    "/api/core/approvals/:id/approve",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = (request as any).userId as string;

      const result = await approve(id, userId);
      if (!result.success) {
        return reply.status(400).send({ error: result.error });
      }
      return { success: true };
    }
  );

  app.post(
    "/api/core/approvals/:id/reject",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = (request as any).userId as string;
      const body = request.body as { reason?: string } | undefined;

      const result = await reject(id, userId, body?.reason);
      if (!result.success) {
        return reply.status(400).send({ error: result.error });
      }
      return { success: true };
    }
  );

  // ─── Audit Log ────────────────────────────────────

  app.get(
    "/api/core/audit/:botId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { botId } = request.params as { botId: string };
      const userId = (request as any).userId as string;
      const query = request.query as { layer?: string; limit?: string; offset?: string };

      const bot = await prisma.bot.findUnique({ where: { id: botId } });
      if (!bot || bot.ownerId !== userId) {
        return reply.status(404).send({ error: "Bot not found" });
      }

      const limit = Math.min(parseInt(query.limit ?? "50"), 200);
      const offset = parseInt(query.offset ?? "0");

      const where: Record<string, unknown> = {
        entityId: botId,
        entityType: "bot",
      };

      // Filter by layer if specified
      if (query.layer) {
        where.payload = { path: ["layer"], equals: parseInt(query.layer) };
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.auditLog.count({ where }),
      ]);

      return { logs, total, limit, offset };
    }
  );

  // ─── Sessions ─────────────────────────────────────

  app.get(
    "/api/core/session/:botId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { botId } = request.params as { botId: string };
      const session = await getSession(botId);
      return { session };
    }
  );

  // ─── Action execution (bot auth — used by OpenClaw) ───

  app.post(
    "/api/core/session/:botId/action",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const { botId } = request.params as { botId: string };
      const userId = (request as any).userId as string;
      const body = request.body as {
        intent: string;
        type?: string;
        provider?: string;
        layer?: number;
        params: Record<string, unknown>;
        estimatedCost?: number;
        merchantName?: string;
        merchantId?: string;
        category?: string;
        transactionId?: string;
        agentId?: string;
      };

      // Ensure session exists (keyed by botId + userId for multi-tenant isolation)
      let session = await getSession(botId, userId);
      if (!session) {
        await createSession(botId, userId);
        session = await getSession(botId, userId);
      }

      // Update session intent
      await updateSession(botId, { currentIntent: body.intent }, userId);

      // Execute through the action executor
      const result = await execute({
        botId,
        userId,
        type: (body.type as any) ?? "SEARCH",
        provider: body.provider ?? body.intent,
        layer: (body.layer as any) ?? 2,
        params: body.params,
        estimatedCost: body.estimatedCost,
        merchantName: body.merchantName,
        merchantId: body.merchantId,
        category: body.category,
        transactionId: body.transactionId,
        agentId: body.agentId,
      });

      if (result.awaitingApproval) {
        return {
          status: "PENDING_APPROVAL",
          approvalId: result.approvalId,
          expiresAt: result.expiresAt,
        };
      }

      if (!result.allowed) {
        return { status: "DENIED", reason: result.reason };
      }

      return { status: "ALLOWED", proceed: true };
    }
  );

  // ─── Layer Status (for dashboard) ─────────────────

  app.get(
    "/api/core/status",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [decisions, approvals, searches, composioConfigured] = await Promise.all([
        prisma.policyDecisionLog.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
        prisma.approvalRequest.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
        prisma.commerceSearchLog.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
        Promise.resolve(!!process.env.COMPOSIO_API_KEY),
      ]);

      const providerCount = await prisma.botIntegration.count({
        where: { enabled: true },
      }).catch(() => 0);

      return {
        layer1: { active: true, decisions, approvals },
        layer2: { active: true, searches, providers: providerCount },
        layer3: {
          configured: composioConfigured,
          connectedApps: 0, // will be updated when Composio connections are queried
        },
        layer4: {
          configured: !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID),
          activeSessions: 0,
        },
      };
    }
  );
}
