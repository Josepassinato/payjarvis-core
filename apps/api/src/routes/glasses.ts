/**
 * Glasses Routes — AI-powered product identification via camera/image
 *
 * Internal-only endpoints called by OpenClaw bot and smart glasses integration.
 * Protected by INTERNAL_SECRET header (same pattern as onboarding-bot.ts).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  identifyProduct,
  executeGlassesCommand,
  getShoppingList,
} from "../services/glasses.service.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-internal-secret";

async function requireInternal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = request.headers["x-internal-secret"] as string;
  if (secret !== INTERNAL_SECRET) {
    reply.status(401).send({ success: false, error: "Unauthorized — invalid internal secret" });
    return;
  }
}

export async function glassesRoutes(app: FastifyInstance) {
  // POST /api/glasses/identify — identify product from image
  app.post(
    "/api/glasses/identify",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const { image, userId } = request.body as {
        image?: string;
        userId?: string;
      };

      if (!image || !userId) {
        return reply.status(400).send({
          success: false,
          error: "image (base64) and userId are required",
        });
      }

      try {
        const result = await identifyProduct(image, userId);
        return { success: true, data: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[Glasses] Identify error:", msg);
        return reply.status(500).send({ success: false, error: msg });
      }
    }
  );

  // POST /api/glasses/command — execute command on last identified product
  app.post(
    "/api/glasses/command",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const { command, userId, context } = request.body as {
        command?: string;
        userId?: string;
        context?: any;
      };

      if (!command || !userId) {
        return reply.status(400).send({
          success: false,
          error: "command and userId are required",
        });
      }

      try {
        const result = await executeGlassesCommand(command, userId, context);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[Glasses] Command error:", msg);
        return reply.status(500).send({ success: false, error: msg });
      }
    }
  );

  // GET /api/glasses/list — get user's shopping list
  app.get(
    "/api/glasses/list",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const { userId } = request.query as { userId?: string };

      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: "userId query parameter is required",
        });
      }

      try {
        const list = getShoppingList(userId);
        return { success: true, data: list };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[Glasses] List error:", msg);
        return reply.status(500).send({ success: false, error: msg });
      }
    }
  );

  // GET /api/glasses/status — health check
  app.get("/api/glasses/status", async () => {
    return { status: "ok", service: "glasses" };
  });
}
