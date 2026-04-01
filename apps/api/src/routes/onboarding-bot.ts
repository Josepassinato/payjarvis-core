/**
 * Onboarding Bot Routes — conversational onboarding via Telegram/WhatsApp
 *
 * Internal-only endpoints called by OpenClaw bot.
 * Protected by INTERNAL_SECRET header.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  startOnboarding,
  processStep,
  hasActiveSession,
  quickStart,
} from "../services/onboarding-bot.service.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-internal-secret";

async function requireInternal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = request.headers["x-internal-secret"] as string;
  if (secret !== INTERNAL_SECRET) {
    reply.status(401).send({ success: false, error: "Unauthorized — invalid internal secret" });
    return;
  }
}

export async function onboardingBotRoutes(app: FastifyInstance) {
  // POST /api/onboarding/start — initiate onboarding session
  app.post("/api/onboarding/start", { preHandler: [requireInternal] }, async (request, reply) => {
    const { chatId, platform, shareCode } = request.body as {
      chatId?: string;
      platform?: string;
      shareCode?: string;
    };

    if (!chatId || !platform) {
      return reply.status(400).send({ success: false, error: "chatId and platform are required" });
    }

    if (platform !== "telegram" && platform !== "whatsapp") {
      return reply.status(400).send({ success: false, error: "platform must be 'telegram' or 'whatsapp'" });
    }

    try {
      const result = await startOnboarding(chatId, platform, shareCode);
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Onboarding Bot] Start error:", msg);
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // POST /api/onboarding/step — process user input
  app.post("/api/onboarding/step", { preHandler: [requireInternal] }, async (request, reply) => {
    const { chatId, platform, userInput } = request.body as {
      chatId?: string;
      platform?: string;
      userInput?: string;
    };

    if (!chatId || !platform || !userInput) {
      return reply.status(400).send({ success: false, error: "chatId, platform, and userInput are required" });
    }

    try {
      const result = await processStep(chatId, platform, userInput);
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Onboarding Bot] Step error:", msg);
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // POST /api/onboarding/quick-start — friction-free onboarding (name only)
  app.post("/api/onboarding/quick-start", { preHandler: [requireInternal] }, async (request, reply) => {
    const body = request.body as {
      name?: string;
      telegramChatId?: string;
      whatsappPhone?: string;
      language?: string;
      shareCode?: string;
      referrerUserId?: string;
    };

    if (!body.name || (!body.telegramChatId && !body.whatsappPhone)) {
      return reply.status(400).send({ success: false, error: "name and telegramChatId or whatsappPhone required" });
    }

    try {
      const result = await quickStart({
        name: body.name,
        telegramChatId: body.telegramChatId,
        whatsappPhone: body.whatsappPhone,
        language: body.language,
        shareCode: body.shareCode,
        referrerUserId: body.referrerUserId,
      });
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Onboarding Bot] QuickStart error:", msg);
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  // GET /api/onboarding/status/:chatId — check if chatId has active onboarding
  app.get("/api/onboarding/status/:chatId", { preHandler: [requireInternal] }, async (request, reply) => {
    const { chatId } = request.params as { chatId: string };
    const platform = (request.query as { platform?: string }).platform ?? "telegram";

    try {
      const active = await hasActiveSession(chatId, platform);
      return { success: true, data: { active } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ success: false, error: msg });
    }
  });
}
