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
        planType: true,
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
        planType: user.planType,
        botId: user.bots[0]?.id ?? null,
      },
    };
  });

  // PUT /api/users/:telegramId/location — update user GPS location (from OpenClaw bot)
  app.put("/api/users/:telegramId/location", async (request, reply) => {
    const { telegramId } = request.params as { telegramId: string };
    const internalSecret = request.headers["x-internal-secret"] as string;
    if (internalSecret !== (process.env.INTERNAL_SECRET || "dev-internal-secret")) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }
    const body = request.body as { latitude?: number; longitude?: number };
    if (!body.latitude || !body.longitude) {
      return reply.status(400).send({ success: false, error: "latitude and longitude required" });
    }
    const result = await prisma.user.updateMany({
      where: { telegramChatId: telegramId },
      data: { latitude: body.latitude, longitude: body.longitude, locationUpdatedAt: new Date() },
    });
    return { success: true, updated: result.count };
  });
}
