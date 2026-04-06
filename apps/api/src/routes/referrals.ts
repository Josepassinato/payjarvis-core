/**
 * Referral Routes — Direct WhatsApp invite via Twilio template
 *
 * POST /api/referrals/send-invite — sends referral template to friend's WhatsApp
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";
import { sendReferralTemplate } from "../services/twilio-whatsapp.service.js";
import { execFileSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

const REFERRAL_CARD_SCRIPT = "/root/Payjarvis/scripts/generate_referral_card.py";
const RECEIPT_CARD_SCRIPT = "/root/Payjarvis/scripts/generate_receipt_card.py";

export async function referralRoutes(app: FastifyInstance) {
  // GET /api/referrals/card — generate personalized referral invite card
  app.get("/api/referrals/card", async (request: FastifyRequest, reply: FastifyReply) => {
    const { name = "Friend", lang = "en" } = request.query as { name?: string; lang?: string };
    const safeName = name.replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, "").slice(0, 30);
    const safeLang = lang === "pt" ? "pt" : "en";
    const tmpPath = `/tmp/referral_card_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

    try {
      execFileSync("python3", [REFERRAL_CARD_SCRIPT, "--name", safeName, "--lang", safeLang, "--output", tmpPath], {
        timeout: 15000,
      });
      const buf = readFileSync(tmpPath);
      unlinkSync(tmpPath);
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=3600")
        .send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      request.log.error({ err: msg }, "[Referral] Card generation failed");
      return reply.status(500).send({ success: false, error: "Card generation failed" });
    }
  });

  // GET /api/referrals/receipt-card — generate savings receipt card
  app.get("/api/referrals/receipt-card", async (request: FastifyRequest, reply: FastifyReply) => {
    const { product, price, avg, currency = "USD", referral = "sniffershop.com" } = request.query as {
      product?: string; price?: string; avg?: string; currency?: string; referral?: string;
    };

    if (!product || !price || !avg) {
      return reply.status(400).send({ success: false, error: "Missing required: product, price, avg" });
    }

    const safeProduct = product.replace(/[^a-zA-ZÀ-ÿ0-9\s\-\.\,\/\(\)]/g, "").slice(0, 60);
    const safeCurrency = ["USD", "BRL", "EUR"].includes(currency) ? currency : "USD";
    const tmpPath = `/tmp/receipt_card_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

    try {
      execFileSync("python3", [
        RECEIPT_CARD_SCRIPT,
        "--product", safeProduct,
        "--price", String(parseFloat(price)),
        "--avg", String(parseFloat(avg)),
        "--currency", safeCurrency,
        "--referral", referral.slice(0, 100),
        "--output", tmpPath,
      ], { timeout: 15000 });

      const buf = readFileSync(tmpPath);
      unlinkSync(tmpPath);
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=3600")
        .send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      request.log.error({ err: msg }, "[Receipt] Card generation failed");
      return reply.status(500).send({ success: false, error: "Card generation failed" });
    }
  });

  // POST /api/referrals/send-invite
  app.post("/api/referrals/send-invite", async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers["x-internal-secret"] as string;
    if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
      return reply.status(403).send({ success: false, error: "Unauthorized" });
    }

    const { referrerTelegramId, referrerName, friendPhone, friendName } = request.body as {
      referrerTelegramId: string;
      referrerName: string;
      friendPhone: string;
      friendName: string;
    };

    if (!friendPhone || !friendName || !referrerName) {
      return reply.status(400).send({ success: false, error: "Missing required fields" });
    }

    // Normalize phone
    const cleanPhone = friendPhone.replace(/[\s\-\(\)]/g, "");
    const phone = cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`;

    // Check if this number already has an account
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ phone }, { phone: phone.replace("+", "") }] },
      select: { id: true },
    });

    if (existingUser) {
      return reply.send({ success: false, error: `${friendName} already has a Sniffer account!` });
    }

    // Check for existing pending referral
    const existing = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM pending_referrals
      WHERE phone = ${phone} AND used = false AND expires_at > NOW()
      LIMIT 1
    `;

    if (existing.length > 0) {
      return reply.send({ success: false, error: `There's already a pending invite for ${friendName}` });
    }

    try {
      // Resolve referrer's share code
      let shareCode: string | null = null;
      const referrerUser = await prisma.user.findFirst({
        where: { telegramChatId: referrerTelegramId },
        select: { id: true, clerkId: true },
      });

      if (referrerUser) {
        const bot = await prisma.bot.findFirst({
          where: { ownerId: referrerUser.id },
          select: { id: true },
        });

        if (bot) {
          const shareLink = await prisma.botShareLink.findFirst({
            where: { botId: bot.id, createdByUserId: referrerUser.id, active: true },
            orderBy: { createdAt: "desc" },
          });
          shareCode = shareLink?.code ?? null;
        }
      }

      // Create pending referral
      await prisma.$executeRaw`
        INSERT INTO pending_referrals (phone, share_code, referrer_name, referrer_user_id, invitee_name)
        VALUES (${phone}, ${shareCode}, ${referrerName}, ${referrerTelegramId}, ${friendName})
      `;

      // Send Twilio referral template
      const messageSid = await sendReferralTemplate(phone, friendName, referrerName);

      request.log.info({ phone, friendName, referrerName, messageSid }, "[Referral] Template sent");

      return reply.send({
        success: true,
        messageSid,
        message: `Invite sent to ${friendName} (${phone})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      request.log.error({ err: msg, phone, friendName }, "[Referral] Send failed");
      return reply.status(500).send({ success: false, error: msg });
    }
  });
}
