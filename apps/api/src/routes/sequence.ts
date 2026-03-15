/**
 * Sequence Routes — onboarding drip sequence management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { markActive, getSequenceStatus } from "../services/sequence.service.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-internal-secret";

async function requireInternal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = request.headers["x-internal-secret"] as string;
  if (secret !== INTERNAL_SECRET) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

export async function sequenceRoutes(app: FastifyInstance) {
  // POST /api/sequence/active — mark user active
  app.post("/api/sequence/active", { preHandler: [requireInternal] }, async (request, reply) => {
    const { userId } = request.body as { userId?: string };
    if (!userId) return reply.status(400).send({ success: false, error: "userId required" });
    try {
      await markActive(userId);
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/sequence/status/:userId
  app.get("/api/sequence/status/:userId", { preHandler: [requireInternal] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const status = await getSequenceStatus(userId);
      if (!status) return reply.status(404).send({ success: false, error: "No sequence found" });
      return { success: true, data: status };
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });
}
