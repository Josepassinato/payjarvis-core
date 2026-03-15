import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "payjarvis-api",
      timestamp: new Date().toISOString(),
    };
  });

  // Public endpoint for OpenClaw to resolve user info by telegramId
  app.get("/api/users/:telegramId", async (request, reply) => {
    const { telegramId } = request.params as { telegramId: string };

    const user = await prisma.user.findFirst({
      where: { telegramChatId: telegramId },
      select: {
        fullName: true,
        email: true,
        approvalThreshold: true,
        onboardingCompleted: true,
        bots: { take: 1, select: { id: true } },
      },
    });

    if (!user) {
      return { success: true, data: { name: null, email: null } };
    }

    return {
      success: true,
      data: {
        name: user.fullName,
        email: user.email,
        approvalThreshold: user.approvalThreshold,
        onboardingCompleted: user.onboardingCompleted,
        botId: user.bots[0]?.id ?? null,
      },
    };
  });
}
