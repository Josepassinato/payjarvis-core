import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import { createAuditLog } from "../services/audit.js";
import { redisPublish } from "../services/redis.js";

const INVALIDATION_CHANNEL = "payjarvis:policy:invalidate";

async function invalidatePolicyCache(botId: string): Promise<void> {
  await redisPublish(INVALIDATION_CHANNEL, JSON.stringify({ botId }));
}

export async function policyRoutes(app: FastifyInstance) {
  // Create or update policy for a bot
  app.post("/api/bots/:botId/policy", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const policyData = request.body as Record<string, unknown>;

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const policy = await prisma.policy.upsert({
      where: { botId },
      create: { botId, ...policyData } as any,
      update: policyData,
    });

    await createAuditLog({
      entityType: "policy",
      entityId: policy.id,
      action: "policy.updated",
      actorType: "user",
      actorId: user.id,
      payload: policyData,
      ipAddress: request.ip,
    });

    await invalidatePolicyCache(botId);

    return { success: true, data: policy };
  });

  // Get policy for a bot
  app.get("/api/bots/:botId/policy", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const policy = await prisma.policy.findUnique({ where: { botId } });
    if (!policy) return reply.status(404).send({ success: false, error: "Policy not found" });

    return { success: true, data: policy };
  });

  // Update policy
  app.patch("/api/bots/:botId/policy", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const updates = request.body as Record<string, unknown>;

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const policy = await prisma.policy.update({
      where: { botId },
      data: updates,
    });

    await createAuditLog({
      entityType: "policy",
      entityId: policy.id,
      action: "policy.updated",
      actorType: "user",
      actorId: user.id,
      payload: updates,
      ipAddress: request.ip,
    });

    await invalidatePolicyCache(botId);

    return { success: true, data: policy };
  });

  // Delete policy
  app.delete("/api/bots/:botId/policy", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    await prisma.policy.delete({ where: { botId } });

    await createAuditLog({
      entityType: "policy",
      entityId: botId,
      action: "policy.deleted",
      actorType: "user",
      actorId: user.id,
      ipAddress: request.ip,
    });

    await invalidatePolicyCache(botId);

    return { success: true, message: "Policy deleted" };
  });
}
