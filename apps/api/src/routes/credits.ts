/**
 * Credit Routes — LLM message credits management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  consumeMessage,
  getBalance,
  purchaseCredits,
  CREDIT_PACKAGES,
} from "../services/credit.service.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-internal-secret";

async function requireInternal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = request.headers["x-internal-secret"] as string;
  if (secret !== INTERNAL_SECRET) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

export async function creditRoutes(app: FastifyInstance) {
  // POST /api/credits/consume — internal, called by openclaw/whatsapp
  app.post("/api/credits/consume", { preHandler: [requireInternal] }, async (request, reply) => {
    const { userId, platform, inputTokens, outputTokens } = request.body as {
      userId?: string; platform?: string; inputTokens?: number; outputTokens?: number;
    };
    if (!userId || !platform) {
      return reply.status(400).send({ success: false, error: "userId and platform required" });
    }
    try {
      const result = await consumeMessage(userId, platform, inputTokens ?? 0, outputTokens ?? 0);
      return { success: true, data: result };
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/credits/balance/:userId — balance check
  app.get("/api/credits/balance/:userId", { preHandler: [requireInternal] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const balance = await getBalance(userId);
      if (!balance) return reply.status(404).send({ success: false, error: "No credits found" });
      return { success: true, data: balance };
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/credits/purchase — buy a credit pack
  app.post("/api/credits/purchase", { preHandler: [requireInternal] }, async (request, reply) => {
    const { userId, packageId } = request.body as { userId?: string; packageId?: string };
    if (!userId || !packageId) {
      return reply.status(400).send({ success: false, error: "userId and packageId required" });
    }
    try {
      const result = await purchaseCredits(userId, packageId);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      return { success: true, data: result };
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/credits/packages — public, list available packages
  app.get("/api/credits/packages", async () => {
    return {
      success: true,
      data: {
        packages: CREDIT_PACKAGES.map((p) => ({
          id: p.id,
          messages: p.messages,
          priceUsd: p.priceUsd,
          label: p.label,
        })),
        monthlyPriceUsd: 20.0,
      },
    };
  });
}
