import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  generateShareLink,
  getSharePreview,
  cloneBot,
  getBotShareLinks,
  deactivateShareLink,
} from "../services/bot-share.service.js";
import QRCode from "qrcode";

const BASE_URL = process.env.PUBLIC_URL ?? "https://payjarvis.com";

export async function botShareRoutes(app: FastifyInstance) {
  // POST /api/bots/:botId/share — Generate share link
  app.post(
    "/api/bots/:botId/share",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const { botId } = request.params as { botId: string };
      const { expiresInHours, maxUses } = (request.body as {
        expiresInHours?: number;
        maxUses?: number;
      }) ?? {};

      try {
        const shareLink = await generateShareLink(botId, userId, {
          expiresInHours,
          maxUses,
        });

        const joinUrl = `${BASE_URL}/join/${shareLink.code}`;
        const qrCode = await QRCode.toDataURL(joinUrl, {
          width: 512,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });

        return {
          success: true,
          data: {
            code: shareLink.code,
            url: joinUrl,
            qrCode,
            expiresAt: shareLink.expiresAt,
            maxUses: shareLink.maxUses,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate share link";
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );

  // GET /api/share/:code — Public preview (no auth required)
  app.get("/api/share/:code", async (request, reply) => {
    const { code } = request.params as { code: string };

    const preview = await getSharePreview(code);
    if (!preview) {
      return reply.status(404).send({
        success: false,
        error: "Share link not found",
      });
    }

    const sharedByName = preview.sharedByName;
    const botName = preview.botName;

    return {
      success: true,
      data: {
        ...preview,
        message: `${sharedByName} quer compartilhar o ${botName} com você`,
      },
    };
  });

  // POST /api/share/:code/clone — Clone bot (requires auth)
  app.post(
    "/api/share/:code/clone",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const { code } = request.params as { code: string };

      try {
        const result = await cloneBot(code, userId);

        const bot = result.bot as Record<string, unknown>;
        const platform = (bot.platform as string) ?? "TELEGRAM";
        const nextStep = platform === "WHATSAPP"
          ? "configure_whatsapp"
          : platform === "TELEGRAM"
            ? "configure_telegram"
            : "configure_payment";

        return {
          success: true,
          data: {
            bot: result.bot,
            alreadyHasBot: result.alreadyHasBot,
            nextStep,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to clone bot";
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );

  // GET /api/bots/:botId/share — List share links for a bot
  app.get(
    "/api/bots/:botId/share",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const { botId } = request.params as { botId: string };

      try {
        const links = await getBotShareLinks(botId, userId);
        return { success: true, data: links };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to get share links";
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );

  // GET /api/bots/:botId/share/generate — Internal endpoint for OpenClaw bot
  app.get(
    "/api/bots/:botId/share/generate",
    async (request, reply) => {
      const secret = request.headers["x-internal-secret"] as string;
      const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "dev-internal-secret";
      if (secret !== INTERNAL_SECRET) {
        return reply.status(401).send({ success: false, error: "Unauthorized" });
      }

      const { botId } = request.params as { botId: string };
      const { telegramId, platform } = request.query as { telegramId?: string; platform?: string };

      if (!telegramId) {
        return reply.status(400).send({ success: false, error: "telegramId query param required" });
      }

      try {
        const { prisma } = await import("@payjarvis/database");

        // Find the bot first, then get its owner
        const bot = await prisma.bot.findUnique({
          where: { id: botId },
          include: { owner: true },
        });
        if (!bot) {
          return reply.status(404).send({ success: false, error: "Bot not found" });
        }

        const user = bot.owner;

        // Check for existing active share link for this bot+user
        const existing = await prisma.botShareLink.findFirst({
          where: { botId, createdByUserId: user.id, active: true },
          orderBy: { createdAt: "desc" },
        });

        let code: string;

        if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) {
          code = existing.code;
        } else {
          const shareLink = await generateShareLink(botId, user.clerkId);
          code = shareLink.code;
        }

        // Build platform-specific deep-links + web fallback
        const webUrl = `${BASE_URL}/join/${code}`;
        const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "Jarvis12Brain_bot";
        const telegramUrl = `https://t.me/${botUsername}?start=${code}`;
        const whatsappText = encodeURIComponent(
          `Experimenta o Jarvis, meu assistente pessoal! ${webUrl}`
        );
        const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

        const targetPlatform = (platform ?? "telegram").toLowerCase();
        const shareUrl = targetPlatform === "whatsapp" ? whatsappUrl : telegramUrl;

        // QR encodes the platform-specific URL
        const qrCodeBase64 = await QRCode.toDataURL(shareUrl, {
          width: 512,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });

        return {
          success: true,
          data: {
            code,
            url: shareUrl,
            webUrl,
            telegramUrl,
            whatsappUrl,
            qrCodeBase64,
            platform: targetPlatform,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate share link";
        console.error("[Bot Share Generate]", message);
        return reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // DELETE /api/share/:code — Deactivate share link
  app.delete(
    "/api/share/:code",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const { code } = request.params as { code: string };

      try {
        await deactivateShareLink(code, userId);
        return { success: true, message: "Share link deactivated" };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to deactivate share link";
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );
}
