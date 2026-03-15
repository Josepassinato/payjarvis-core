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
