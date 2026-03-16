/**
 * Broadcast Service — send messages to user segments via Telegram/WhatsApp.
 * Rate-limited to 30 messages/second.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "";

export async function getRecipientCount(audience: string): Promise<number> {
  const where = buildAudienceFilter(audience);
  return prisma.user.count({ where });
}

function buildAudienceFilter(audience: string): any {
  const days30ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  switch (audience) {
    case "telegram":
      return { telegramChatId: { not: null } };
    case "whatsapp":
      return { notificationChannel: "whatsapp" };
    case "premium":
      return { planType: "premium" };
    case "active":
      return { updatedAt: { gte: days30ago } };
    case "inactive":
      return { updatedAt: { lt: days30ago } };
    case "all":
    default:
      return { OR: [{ telegramChatId: { not: null } }, { notificationChannel: "whatsapp" }] };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendBroadcast(broadcastId: string): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!broadcast) throw new Error("Broadcast not found");

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: "sending" },
  });

  const where = buildAudienceFilter(broadcast.audience);
  const users = await prisma.user.findMany({
    where,
    select: { id: true, telegramChatId: true, notificationChannel: true, phone: true },
  });

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { totalRecipients: users.length },
  });

  let delivered = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    let platform = "unknown";
    let chatId = "";
    let status = "failed";

    try {
      if (user.telegramChatId) {
        platform = "telegram";
        chatId = user.telegramChatId;
        await sendTelegramMessage(chatId, broadcast.message, broadcast.imageUrl);
        status = "delivered";
        delivered++;
      } else if (user.notificationChannel === "whatsapp" && user.phone) {
        platform = "whatsapp";
        chatId = user.phone;
        await sendWhatsAppMessage(chatId, broadcast.message);
        status = "delivered";
        delivered++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`Broadcast ${broadcastId} failed for user ${user.id}:`, err);
      status = "failed";
      failed++;
    }

    await prisma.broadcastLog.create({
      data: {
        broadcastId,
        userId: user.id,
        platform,
        chatId,
        status,
      },
    });

    // Rate limit: 30/sec → ~33ms between messages
    if ((i + 1) % 30 === 0) {
      await sleep(1000);
    }
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: failed === users.length ? "failed" : "sent",
      sentAt: new Date(),
      delivered,
      failed,
    },
  });
}

export async function scheduleBroadcast(broadcastId: string, scheduledAt: Date): Promise<void> {
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { scheduledAt, status: "scheduled" },
  });
}

async function sendTelegramMessage(chatId: string, text: string, imageUrl?: string | null) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  if (imageUrl) {
    const res = await fetch(`${baseUrl}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: imageUrl, caption: text }),
    });
    if (!res.ok) throw new Error(`Telegram API error: ${res.status}`);
  } else {
    const res = await fetch(`${baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) throw new Error(`Telegram API error: ${res.status}`);
  }
}

async function sendWhatsAppMessage(phone: string, text: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) throw new Error("Twilio credentials not set");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const body = new URLSearchParams({
    To: `whatsapp:${phone}`,
    From: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
    Body: text,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Twilio API error: ${res.status}`);
}
