import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { verifyAgent, getAgentById, resolveAgentId } from "../services/agent-identity.js";
import { getReputation } from "../services/reputation.js";
import { issueAit } from "../services/ait.js";
import { createAuditLog } from "../services/audit.js";
import { prisma } from "@payjarvis/database";

export async function agentRoutes(app: FastifyInstance) {
  // Public: GET /v1/agents/:agentId/verify — merchant verification endpoint
  app.get("/v1/agents/:agentId/verify", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };

    if (!agentId.startsWith("ag_")) {
      return reply.status(400).send({ success: false, error: "Invalid agent ID format" });
    }

    const result = await verifyAgent(agentId);
    if (!result) {
      return reply.status(404).send({ success: false, error: "Agent not found" });
    }

    return { success: true, data: result };
  });

  // Authenticated: GET /agents/:agentId — full agent details for owner
  app.get("/agents/:agentId", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { agentId } = request.params as { agentId: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const agent = await getAgentById(agentId);
    if (!agent || agent.ownerId !== user.id) {
      return reply.status(404).send({ success: false, error: "Agent not found" });
    }

    const reputation = await getReputation(agentId);

    return {
      success: true,
      data: {
        ...agent,
        reputation,
      },
    };
  });

  // POST /agents/:agentId/token — generate AIT (Agent Identity Token)
  // Authenticated by bot API key (agent's bot) or user auth (agent's owner)
  app.post("/agents/:agentId/token", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { agentId } = request.params as { agentId: string };
    const { ttl } = (request.body ?? {}) as { ttl?: number };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const agent = await getAgentById(agentId);
    if (!agent || agent.ownerId !== user.id) {
      return reply.status(404).send({ success: false, error: "Agent not found" });
    }

    if (agent.status !== "ACTIVE") {
      return reply.status(403).send({ success: false, error: "Agent is not active" });
    }

    const ttlSeconds = Math.min(ttl ?? 3600, 86400); // max 24h
    const result = await issueAit(agentId, ttlSeconds);
    if (!result) {
      return reply.status(500).send({ success: false, error: "Failed to generate token" });
    }

    await createAuditLog({
      entityType: "agent",
      entityId: agentId,
      action: "ait.issued",
      actorType: "user",
      actorId: user.id,
      payload: { ttl: ttlSeconds, expiresAt: result.expiresAt.toISOString() },
      ipAddress: request.ip,
    });

    return {
      success: true,
      data: {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
      },
    };
  });

  // POST /bots/:botId/agent-token — bot-auth variant for SDK
  app.post("/bots/:botId/agent-token", { preHandler: [requireBotAuth] }, async (request, reply) => {
    const botId = (request as any).botId as string;
    const { botId: paramBotId } = request.params as { botId: string };
    const { ttl } = (request.body ?? {}) as { ttl?: number };

    if (botId !== paramBotId) {
      return reply.status(403).send({ success: false, error: "API key does not match the requested bot" });
    }

    const agentId = await resolveAgentId(botId);
    if (!agentId) {
      return reply.status(404).send({ success: false, error: "No agent found for this bot" });
    }

    const ttlSeconds = Math.min(ttl ?? 3600, 86400);
    const result = await issueAit(agentId, ttlSeconds);
    if (!result) {
      return reply.status(500).send({ success: false, error: "Failed to generate token" });
    }

    await createAuditLog({
      entityType: "agent",
      entityId: agentId,
      action: "ait.issued",
      actorType: "bot",
      actorId: botId,
      payload: { ttl: ttlSeconds, expiresAt: result.expiresAt.toISOString() },
    });

    return {
      success: true,
      data: {
        token: result.token,
        agentId,
        expiresAt: result.expiresAt.toISOString(),
      },
    };
  });

  // Authenticated: GET /agents — list all agents for authenticated user
  app.get("/agents", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const agents = await prisma.agent.findMany({
      where: { ownerId: user.id },
      include: {
        reputation: true,
        bot: { select: { id: true, name: true, platform: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: agents };
  });
}
