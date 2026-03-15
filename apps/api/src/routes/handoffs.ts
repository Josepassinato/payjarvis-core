import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { createAuditLog } from "../services/audit.js";
import { redisSet, redisGet, redisDel } from "../services/redis.js";
import { notifyHandoffCreated } from "../services/notifications.js";
import { EventEmitter } from "node:events";

const handoffEvents = new EventEmitter();
handoffEvents.setMaxListeners(100);

export function emitHandoffEvent(ownerId: string, event: string, data: unknown) {
  handoffEvents.emit(`handoff:${ownerId}`, { event, data });
}

export function emitBotHandoffEvent(botId: string, event: string, data: unknown) {
  handoffEvents.emit(`handoff:bot:${botId}`, { event, data });
}

/**
 * Expire pending/in-progress handoffs that have passed their expiresAt.
 * No trust score impact — handoff expiration does not penalize the bot.
 */
async function expireHandoffs() {
  try {
    const expired = await prisma.handoffRequest.findMany({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        expiresAt: { lt: new Date() },
      },
    });

    for (const handoff of expired) {
      await prisma.handoffRequest.update({
        where: { id: handoff.id },
        data: { status: "EXPIRED" },
      });

      await redisDel(`handoff:${handoff.id}`);

      await createAuditLog({
        entityType: "handoff",
        entityId: handoff.id,
        action: "handoff.expired",
        actorType: "system",
        actorId: "expiration-job",
        payload: { botId: handoff.botId, obstacleType: handoff.obstacleType },
      });

      emitHandoffEvent(handoff.ownerId, "handoff_expired", {
        id: handoff.id,
        status: "EXPIRED",
      });
      emitBotHandoffEvent(handoff.botId, "handoff_resolved", {
        id: handoff.id,
        status: "EXPIRED",
      });
    }
  } catch (err) {
    console.error("[HandoffExpireJob] Error:", err);
  }
}

export async function handoffRoutes(app: FastifyInstance) {
  // Start background expiration job — every 60 seconds
  const expirationInterval = setInterval(expireHandoffs, 60_000);
  setTimeout(expireHandoffs, 5000);

  app.addHook("onClose", () => {
    clearInterval(expirationInterval);
  });

  // ── Bot requests human handoff ──
  app.post("/api/bots/:botId/request-handoff", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const botOwnerId = (request as any).botOwnerId as string;
    const urlBotId = (request.params as any).botId as string;

    if (botId !== urlBotId) {
      return reply.status(403).send({ success: false, error: "Bot ID mismatch" });
    }

    const { sessionUrl, obstacleType, description, metadata } = request.body as {
      sessionUrl: string;
      obstacleType: string;
      description: string;
      metadata?: Record<string, unknown>;
    };

    if (!sessionUrl || !obstacleType || !description) {
      return reply.status(400).send({ success: false, error: "sessionUrl, obstacleType, and description are required" });
    }

    const validObstacles = ["CAPTCHA", "AUTH", "NAVIGATION", "OTHER"];
    if (!validObstacles.includes(obstacleType)) {
      return reply.status(400).send({ success: false, error: `obstacleType must be one of: ${validObstacles.join(", ")}` });
    }

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const handoff = await prisma.handoffRequest.create({
      data: {
        botId,
        ownerId: botOwnerId,
        sessionUrl,
        obstacleType: obstacleType as any,
        description,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        expiresAt,
      },
    });

    // Cache in Redis for fast polling
    await redisSet(`handoff:${handoff.id}`, JSON.stringify({
      id: handoff.id,
      status: "PENDING",
      botId,
      ownerId: botOwnerId,
    }), 15 * 60);

    // Notify owner via Telegram
    await notifyHandoffCreated(botOwnerId, {
      botName: bot.name,
      obstacleType,
      description,
      sessionUrl,
      handoffId: handoff.id,
    });

    await createAuditLog({
      entityType: "handoff",
      entityId: handoff.id,
      action: "handoff.created",
      actorType: "bot",
      actorId: botId,
      payload: { obstacleType, description, sessionUrl },
      ipAddress: request.ip,
    });

    emitHandoffEvent(botOwnerId, "handoff_created", {
      id: handoff.id,
      botId,
      obstacleType,
      description,
      sessionUrl,
      expiresAt: expiresAt.toISOString(),
    });

    return reply.status(201).send({
      success: true,
      data: {
        handoffId: handoff.id,
        status: "PENDING",
        expiresAt: expiresAt.toISOString(),
      },
    });
  });

  // ── Bot polls handoff status ──
  app.get("/api/handoffs/:id/status", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const { id } = request.params as { id: string };

    // Try Redis first
    const cached = await redisGet(`handoff:${id}`);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.botId !== botId) {
        return reply.status(403).send({ success: false, error: "Not your handoff" });
      }
      // If resolved/cancelled/expired in cache, return immediately
      if (data.status !== "PENDING" && data.status !== "IN_PROGRESS") {
        return { success: true, data: { status: data.status, resolvedNote: data.resolvedNote } };
      }
    }

    const handoff = await prisma.handoffRequest.findFirst({
      where: { id, botId },
    });

    if (!handoff) return reply.status(404).send({ success: false, error: "Handoff not found" });

    // Lazy expiration
    if ((handoff.status === "PENDING" || handoff.status === "IN_PROGRESS") && new Date() > handoff.expiresAt) {
      await prisma.handoffRequest.update({
        where: { id },
        data: { status: "EXPIRED" },
      });
      await redisDel(`handoff:${id}`);
      return { success: true, data: { status: "EXPIRED" } };
    }

    return {
      success: true,
      data: {
        status: handoff.status,
        resolved: handoff.status === "RESOLVED",
        resolvedNote: handoff.resolvedNote,
        expiresAt: handoff.expiresAt.toISOString(),
      },
    };
  });

  // ── Owner marks handoff as resolved ──
  app.post("/api/handoffs/:id/resolve", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as { id: string };
    const { note } = (request.body as any) ?? {};

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const handoff = await prisma.handoffRequest.findFirst({
      where: { id, ownerId: user.id },
    });

    if (!handoff) return reply.status(404).send({ success: false, error: "Handoff not found" });

    if (handoff.status === "RESOLVED" || handoff.status === "CANCELLED" || handoff.status === "EXPIRED") {
      return reply.status(400).send({ success: false, error: `Handoff already ${handoff.status}` });
    }

    await prisma.handoffRequest.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedNote: note ?? null },
    });

    // Update Redis cache
    await redisSet(`handoff:${id}`, JSON.stringify({
      id,
      status: "RESOLVED",
      botId: handoff.botId,
      ownerId: handoff.ownerId,
      resolvedNote: note ?? null,
    }), 60);

    await createAuditLog({
      entityType: "handoff",
      entityId: id,
      action: "handoff.resolved",
      actorType: "user",
      actorId: user.id,
      payload: { note },
      ipAddress: request.ip,
    });

    emitHandoffEvent(user.id, "handoff_resolved", { id, status: "RESOLVED" });
    emitBotHandoffEvent(handoff.botId, "handoff_resolved", {
      id,
      status: "RESOLVED",
      resolvedNote: note ?? null,
    });

    return { success: true, data: { status: "RESOLVED" } };
  });

  // ── Bot cancels handoff ──
  app.post("/api/handoffs/:id/cancel", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const { id } = request.params as { id: string };

    const handoff = await prisma.handoffRequest.findFirst({
      where: { id, botId },
    });

    if (!handoff) return reply.status(404).send({ success: false, error: "Handoff not found" });

    if (handoff.status === "RESOLVED" || handoff.status === "CANCELLED" || handoff.status === "EXPIRED") {
      return reply.status(400).send({ success: false, error: `Handoff already ${handoff.status}` });
    }

    await prisma.handoffRequest.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await redisDel(`handoff:${id}`);

    await createAuditLog({
      entityType: "handoff",
      entityId: id,
      action: "handoff.cancelled",
      actorType: "bot",
      actorId: botId,
      payload: {},
    });

    emitHandoffEvent(handoff.ownerId, "handoff_cancelled", { id, status: "CANCELLED" });
    emitBotHandoffEvent(botId, "handoff_resolved", { id, status: "CANCELLED" });

    return { success: true, data: { status: "CANCELLED" } };
  });

  // ── Owner marks handoff as in-progress ──
  app.post("/api/handoffs/:id/in-progress", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const handoff = await prisma.handoffRequest.findFirst({
      where: { id, ownerId: user.id },
    });

    if (!handoff) return reply.status(404).send({ success: false, error: "Handoff not found" });

    if (handoff.status !== "PENDING") {
      return reply.status(400).send({ success: false, error: `Cannot transition from ${handoff.status} to IN_PROGRESS` });
    }

    await prisma.handoffRequest.update({
      where: { id },
      data: { status: "IN_PROGRESS" },
    });

    // Update Redis cache
    await redisSet(`handoff:${id}`, JSON.stringify({
      id,
      status: "IN_PROGRESS",
      botId: handoff.botId,
      ownerId: handoff.ownerId,
    }), 15 * 60);

    emitBotHandoffEvent(handoff.botId, "handoff_in_progress", {
      id,
      status: "IN_PROGRESS",
    });

    return { success: true, data: { status: "IN_PROGRESS" } };
  });

  // ── SSE stream for bot ──
  app.get("/api/handoffs/stream/bot", { preHandler: [requireBotAuth] }, async (request, reply) => {
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

    send("connected", { message: "Handoff SSE connected", botId });

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15_000);

    const listener = (payload: { event: string; data: unknown }) => {
      send(payload.event, payload.data);
    };
    handoffEvents.on(`handoff:bot:${botId}`, listener);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      handoffEvents.off(`handoff:bot:${botId}`, listener);
    });
  });

  // ── List pending handoffs for owner ──
  app.get("/api/handoffs", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    // Lazy-expire
    const now = new Date();
    await prisma.handoffRequest.updateMany({
      where: {
        ownerId: user.id,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED" },
    });

    const handoffs = await prisma.handoffRequest.findMany({
      where: { ownerId: user.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
      orderBy: { createdAt: "desc" },
      include: { bot: { select: { name: true } } },
    });

    return { success: true, data: handoffs };
  });
}
