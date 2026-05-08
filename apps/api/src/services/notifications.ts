import { prisma } from "@payjarvis/database";
import {
  sendEmail,
  isEmailConfigured,
  templateApprovalRequest,
  templateTransactionConfirmed,
  templateTransactionBlocked,
  templateHandoffRequest,
} from "./email.js";

const TELEGRAM_API = "https://api.telegram.org/bot";
const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.payjarvis.com";

function getTelegramToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

function getAdminTelegramToken(): string | undefined {
  return process.env.ADMIN_TELEGRAM_BOT_TOKEN;
}

function getAdminChatId(): string | undefined {
  return process.env.ADMIN_TELEGRAM_CHAT_ID;
}

export async function sendAdminTelegramNotification(
  message: string,
  reply_markup?: Record<string, unknown>
): Promise<boolean> {
  const token = getAdminTelegramToken();
  const chatId = getAdminChatId();
  if (!token || !chatId) {
    console.error("[Notification] ADMIN_TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_CHAT_ID not configured");
    return false;
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    };
    if (reply_markup) {
      payload.reply_markup = reply_markup;
    }

    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Notification] Admin Telegram API error:", err);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Notification] Failed to send admin Telegram message:", err);
    return false;
  }
}

export async function sendTelegramNotification(
  chatId: string,
  message: string,
  reply_markup?: Record<string, unknown>
): Promise<boolean> {
  const token = getTelegramToken();
  if (!token) {
    console.error("[Notification] TELEGRAM_BOT_TOKEN not configured");
    return false;
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    };
    if (reply_markup) {
      payload.reply_markup = reply_markup;
    }

    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Notification] Telegram API error (chatId=${chatId}):`, err);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Notification] Failed to send Telegram message:", err);
    return false;
  }
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  botToken?: string
): Promise<void> {
  const token = botToken ?? getTelegramToken();
  if (!token) return;

  try {
    await fetch(`${TELEGRAM_API}${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ?? "",
      }),
    });
  } catch (err) {
    console.error("[Notification] Failed to answer callback query:", err);
  }
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  botToken?: string
): Promise<void> {
  const token = botToken ?? getTelegramToken();
  if (!token) return;

  try {
    await fetch(`${TELEGRAM_API}${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("[Notification] Failed to edit message:", err);
  }
}

export async function notifyHandoffCreated(
  ownerId: string,
  data: { botName: string; obstacleType: string; description: string; sessionUrl: string; handoffId: string }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user) return;

  const obstacleLabels: Record<string, string> = {
    CAPTCHA: "Captcha",
    AUTH: "Authentication",
    NAVIGATION: "Complex navigation",
    OTHER: "Other obstacle",
  };

  // Telegram
  if (user.notificationChannel === "telegram" && user.telegramChatId) {
    const message =
      `🤖 <b>Help needed</b>\n\n` +
      `Bot: <b>${data.botName}</b>\n` +
      `Obstacle: ${obstacleLabels[data.obstacleType] ?? data.obstacleType}\n` +
      `Description: ${data.description}`;

    const reply_markup = {
      inline_keyboard: [
        [{ text: "🌐 Open Session", url: data.sessionUrl }],
        [
          { text: "✅ Done", callback_data: `handoff_done:${data.handoffId}` },
          { text: "❌ Cancel", callback_data: `handoff_cancel:${data.handoffId}` },
        ],
      ],
    };

    const sent = await sendTelegramNotification(user.telegramChatId, message, reply_markup);
    if (sent) {
      await prisma.handoffRequest.update({
        where: { id: data.handoffId },
        data: { pushSent: true },
      });
    }
  }

  // Email
  if (user.email && isEmailConfigured()) {
    const template = templateHandoffRequest({
      botName: data.botName,
      obstacleType: data.obstacleType,
      description: data.description,
      sessionUrl: data.sessionUrl,
    });
    await sendEmail({ to: user.email, ...template }).catch((err) =>
      console.error("[Notification] Email send failed:", err)
    );
  }
}

export async function notifyTransactionApproved(
  ownerId: string,
  data: { botName: string; merchantName: string; amount: number; currency: string; transactionId: string }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user) return;

  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  // Telegram
  if (user.notificationChannel === "telegram" && user.telegramChatId) {
    const message =
      `✅ <b>Payment Approved by PayJarvis</b>\n\n` +
      `🛒 Merchant: ${data.merchantName}\n` +
      `💰 Amount: <b>$${data.amount.toFixed(2)} ${data.currency}</b>\n` +
      `✅ Decision: APPROVED\n` +
      `🆔 Transaction: <code>${data.transactionId}</code>\n` +
      `🤖 Bot: ${data.botName}\n` +
      `🕐 Time: ${now}`;
    await sendTelegramNotification(user.telegramChatId, message);
  }

  // Email
  if (user.email && isEmailConfigured()) {
    const template = templateTransactionConfirmed({
      botName: data.botName,
      merchantName: data.merchantName,
      amount: data.amount,
      currency: data.currency,
      transactionId: data.transactionId,
      timestamp: now,
    });
    await sendEmail({ to: user.email, ...template }).catch((err) =>
      console.error("[Notification] Email send failed:", err)
    );
  }
}

export async function notifyTransactionBlocked(
  ownerId: string,
  data: { botName: string; merchantName: string; amount: number; currency: string; reason: string; ruleTriggered: string | null }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user) return;

  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  // Telegram
  if (user.notificationChannel === "telegram" && user.telegramChatId) {
    const message =
      `🚫 <b>Payment Blocked by PayJarvis</b>\n\n` +
      `🛒 Merchant: ${data.merchantName}\n` +
      `💰 Amount: <b>$${data.amount.toFixed(2)} ${data.currency}</b>\n` +
      `❌ Decision: BLOCKED\n` +
      `📋 Reason: ${data.reason}\n` +
      `🤖 Bot: ${data.botName}\n` +
      `🕐 Time: ${now}\n\n` +
      `To change rules: https://www.payjarvis.com/rules`;
    await sendTelegramNotification(user.telegramChatId, message);
  }

  // Email
  if (user.email && isEmailConfigured()) {
    const template = templateTransactionBlocked({
      botName: data.botName,
      merchantName: data.merchantName,
      amount: data.amount,
      currency: data.currency,
      reason: data.reason,
      dashboardUrl: `${DASHBOARD_URL}/rules`,
    });
    await sendEmail({ to: user.email, ...template }).catch((err) =>
      console.error("[Notification] Email send failed:", err)
    );
  }
}

export async function notifyApprovalCreated(
  ownerId: string,
  data: { botName: string; amount: number; merchantName: string; approvalId: string }
): Promise<void> {
  const message =
    `🔔 <b>Approval pending</b>\n\n` +
    `Bot: <b>${data.botName}</b>\n` +
    `Merchant: ${data.merchantName}\n` +
    `Amount: <b>$${data.amount.toFixed(2)}</b>`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ Approve", callback_data: `approve:${data.approvalId}` },
      { text: "❌ Reject", callback_data: `reject:${data.approvalId}` },
    ]],
  };

  // Always send to admin via @Jarvis12Brain_bot
  const adminSent = await sendAdminTelegramNotification(message, reply_markup);

  // Also send to user's linked Telegram if configured (via @Jarvis12Brain_bot)
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  let userSent = false;
  if (user?.notificationChannel === "telegram" && user.telegramChatId) {
    // Skip duplicate if admin chatId matches user's linked chatId
    if (user.telegramChatId !== getAdminChatId()) {
      userSent = await sendTelegramNotification(user.telegramChatId, message, reply_markup);
    }
  }

  if (adminSent || userSent) {
    await prisma.approvalRequest.update({
      where: { id: data.approvalId },
      data: { pushSent: true },
    });
  }

  // Email notification (non-blocking, parallel to Telegram)
  if (user?.email && isEmailConfigured()) {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toLocaleString("en-US", { timeZone: "America/New_York" });
    const template = templateApprovalRequest({
      botName: data.botName,
      merchantName: data.merchantName,
      amount: data.amount,
      currency: "USD",
      category: "general",
      approvalId: data.approvalId,
      expiresAt,
      dashboardUrl: `${DASHBOARD_URL}/approvals`,
    });
    await sendEmail({ to: user.email, ...template }).catch((err) =>
      console.error("[Notification] Email send failed:", err)
    );
  }
}
