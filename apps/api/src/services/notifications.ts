import { prisma } from "@payjarvis/database";

const TELEGRAM_API = "https://api.telegram.org/bot";

function getTelegramToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
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
      console.error("[Notification] Telegram API error:", err);
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
  text?: string
): Promise<void> {
  const token = getTelegramToken();
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
  text: string
): Promise<void> {
  const token = getTelegramToken();
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

  if (user.notificationChannel !== "telegram" || !user.telegramChatId) return;

  const obstacleLabels: Record<string, string> = {
    CAPTCHA: "Captcha",
    AUTH: "Autenticação",
    NAVIGATION: "Navegação complexa",
    OTHER: "Outro obstáculo",
  };

  const message =
    `🤖 <b>Ajuda necessária</b>\n\n` +
    `Bot: <b>${data.botName}</b>\n` +
    `Obstáculo: ${obstacleLabels[data.obstacleType] ?? data.obstacleType}\n` +
    `Descrição: ${data.description}`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: "🌐 Abrir Sessão", url: data.sessionUrl }],
      [
        { text: "✅ Concluído", callback_data: `handoff_done:${data.handoffId}` },
        { text: "❌ Cancelar", callback_data: `handoff_cancel:${data.handoffId}` },
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

export async function notifyTransactionApproved(
  ownerId: string,
  data: { botName: string; merchantName: string; amount: number; currency: string; transactionId: string }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user) return;
  if (user.notificationChannel !== "telegram" || !user.telegramChatId) return;

  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/New_York" });
  const message =
    `✅ <b>Pagamento Aprovado pelo PayJarvis</b>\n\n` +
    `🛒 Merchant: ${data.merchantName}\n` +
    `💰 Valor: <b>$${data.amount.toFixed(2)} ${data.currency}</b>\n` +
    `✅ Decisão: APROVADO\n` +
    `🆔 Transação: <code>${data.transactionId}</code>\n` +
    `🤖 Bot: ${data.botName}\n` +
    `🕐 Horário: ${now}`;

  await sendTelegramNotification(user.telegramChatId, message);
}

export async function notifyTransactionBlocked(
  ownerId: string,
  data: { botName: string; merchantName: string; amount: number; currency: string; reason: string; ruleTriggered: string | null }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user) return;
  if (user.notificationChannel !== "telegram" || !user.telegramChatId) return;

  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/New_York" });
  const message =
    `🚫 <b>Pagamento Bloqueado pelo PayJarvis</b>\n\n` +
    `🛒 Merchant: ${data.merchantName}\n` +
    `💰 Valor: <b>$${data.amount.toFixed(2)} ${data.currency}</b>\n` +
    `❌ Decisão: BLOQUEADO\n` +
    `📋 Motivo: ${data.reason}\n` +
    `🤖 Bot: ${data.botName}\n` +
    `🕐 Horário: ${now}\n\n` +
    `Para alterar as regras: https://www.payjarvis.com/rules`;

  await sendTelegramNotification(user.telegramChatId, message);
}

export async function notifyApprovalCreated(
  ownerId: string,
  data: { botName: string; amount: number; merchantName: string; approvalId: string }
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!user) return;

  if (user.notificationChannel !== "telegram" || !user.telegramChatId) return;

  const message =
    `🔔 <b>Aprovação pendente</b>\n\n` +
    `Bot: <b>${data.botName}</b>\n` +
    `Merchant: ${data.merchantName}\n` +
    `Valor: <b>$${data.amount.toFixed(2)}</b>`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ Aprovar", callback_data: `approve:${data.approvalId}` },
      { text: "❌ Rejeitar", callback_data: `reject:${data.approvalId}` },
    ]],
  };

  const sent = await sendTelegramNotification(user.telegramChatId, message, reply_markup);

  if (sent) {
    await prisma.approvalRequest.update({
      where: { id: data.approvalId },
      data: { pushSent: true },
    });
  }
}
