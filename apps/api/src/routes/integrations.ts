import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import {
  PAYJARVIS_OPENCLAW_TOOLS,
  generateSystemPrompt,
} from "@payjarvis/merchant-sdk";

export async function integrationRoutes(app: FastifyInstance) {
  // GET /integrations/openclaw/config/:botId
  app.get(
    "/integrations/openclaw/config/:botId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const { botId } = request.params as { botId: string };

      const user = await prisma.user.findUnique({ where: { clerkId: userId } });
      if (!user) return reply.status(404).send({ success: false, error: "User not found" });

      const bot = await prisma.bot.findFirst({
        where: { id: botId, ownerId: user.id },
        include: { policy: true },
      });

      if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

      const policy = bot.policy;

      const systemPrompt = generateSystemPrompt({
        botName: bot.name,
        trustScore: bot.trustScore,
        limits: {
          perTransaction: policy?.maxPerTransaction ?? 100,
          perDay: policy?.maxPerDay ?? 500,
          autoApprove: policy?.autoApproveLimit ?? 50,
        },
      });

      return {
        success: true,
        data: {
          systemPrompt,
          tools: PAYJARVIS_OPENCLAW_TOOLS,
          botId: bot.id,
          trustScore: bot.trustScore,
          limits: {
            perTransaction: policy?.maxPerTransaction ?? 100,
            perDay: policy?.maxPerDay ?? 500,
            autoApprove: policy?.autoApproveLimit ?? 50,
          },
        },
      };
    }
  );
}
