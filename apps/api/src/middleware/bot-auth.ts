import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";
import { createHash } from "node:crypto";
import { redisExists } from "../services/redis.js";

/**
 * Authenticate a bot via X-Bot-Api-Key header.
 * Sets request.botId, request.botOwnerId, request.userId on success.
 */
export async function requireBotAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers["x-bot-api-key"] as string | undefined;

  if (!apiKey || !apiKey.startsWith("pj_bot_")) {
    return reply.status(401).send({
      success: false,
      error: "Missing or invalid X-Bot-Api-Key header",
    });
  }

  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

  const bot = await prisma.bot.findFirst({
    where: { apiKeyHash },
    include: { owner: true },
  });

  if (!bot) {
    return reply.status(401).send({
      success: false,
      error: "Invalid API key",
    });
  }

  if (bot.status === "REVOKED") {
    return reply.status(403).send({
      success: false,
      error: "Bot has been revoked",
    });
  }

  if (bot.status === "PAUSED") {
    // Also check Redis for revocation
    const revoked = await redisExists(`revoked:bot:${bot.id}`);
    if (revoked) {
      return reply.status(403).send({
        success: false,
        error: "Bot is paused/suspended",
      });
    }
  }

  if (bot.status !== "ACTIVE") {
    return reply.status(403).send({
      success: false,
      error: `Bot status is ${bot.status}`,
    });
  }

  (request as any).botId = bot.id;
  (request as any).botOwnerId = bot.ownerId;
  (request as any).userId = bot.owner.clerkId;
}
