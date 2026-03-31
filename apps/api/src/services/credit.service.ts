/**
 * Credit Service — LLM message credits, billing, alerts.
 *
 * Every user gets 5,000 free messages. Beta users get unlimited access.
 * After credits run out, user must purchase a pack or subscribe.
 * Alerts at 75%, 90%, 100% usage. Legacy trial alerts kept for existing users.
 */

import { prisma } from "@payjarvis/database";

// ─── Pricing ─────────────────────────────────────────────

const COST_PER_MSG_REAL = 0.0001;
const COST_PER_MSG_CHARGED = 0.0012; // 12x markup (was 10x/15x)
const FREE_MESSAGES = 5000;
const FREE_TRIAL_DAYS = 60; // legacy — kept for existing trial users

export const CREDIT_PACKAGES = [
  { id: "pack_15k", messages: 15000, priceUsd: 10.0, label: "15,000 messages — $10" },
  { id: "pack_50k", messages: 50000, priceUsd: 25.0, label: "50,000 messages — $25" },
] as const;

// ─── Types ───────────────────────────────────────────────

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  alert: null | "75%" | "90%" | "100%";
}

export interface CreditBalance {
  messagesTotal: number;
  messagesUsed: number;
  messagesRemaining: number;
  percentUsed: number;
  freeTrialActive: boolean;
  freeTrialDaysLeft: number | null;
}

export interface PurchaseResult {
  success: boolean;
  error?: string;
  messagesAdded?: number;
  newBalance?: number;
  stripePaymentId?: string;
}

// ─── Messaging ───────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+17547145921";

function detectLang(chatId: string): "en" | "pt" {
  return chatId.includes("+55") ? "pt" : "en";
}

async function sendAlert(platform: string, chatId: string, text: string): Promise<void> {
  try {
    if (platform === "telegram" && TELEGRAM_BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      });
    } else if (platform === "whatsapp" && TWILIO_ACCOUNT_SID) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: TWILIO_WHATSAPP_NUMBER, To: chatId, Body: text }).toString(),
      });
    }
  } catch (err) {
    console.error("[Credit] sendAlert error:", (err as Error).message);
  }
}

// ─── Chat ID resolver ────────────────────────────────────

async function getUserChatInfo(userId: string): Promise<{ platform: string; chatId: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, phone: true, notificationChannel: true },
  });
  if (!user) return null;
  if (user.telegramChatId) return { platform: "telegram", chatId: user.telegramChatId };
  if (user.phone) return { platform: "whatsapp", chatId: `whatsapp:${user.phone}` };
  return null;
}

// ─── Core Functions ──────────────────────────────────────

export async function initCredits(userId: string, referredBy?: string): Promise<void> {
  const existing = await prisma.llmCredit.findUnique({ where: { userId } });
  if (existing) return;

  const hasReferral = !!referredBy;

  await prisma.llmCredit.create({
    data: {
      userId,
      messagesTotal: FREE_MESSAGES,
      messagesUsed: 0,
      messagesRemaining: FREE_MESSAGES,
      freeTrialActive: hasReferral,
      freeTrialEndsAt: hasReferral ? new Date(Date.now() + FREE_TRIAL_DAYS * 86400000) : null,
    },
  });

  console.log(`[Credit] Initialized for ${userId}${hasReferral ? " (beta referral)" : ""}`);
}

export async function consumeMessage(
  userId: string,
  platform: string,
  inputTokens: number,
  outputTokens: number,
): Promise<ConsumeResult> {
  // Premium subscribers = unlimited messages
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { planType: true, subscriptionStatus: true },
  });

  if (user?.planType === "premium" && user.subscriptionStatus === "active") {
    const totalTokens = inputTokens + outputTokens;
    const costReal = totalTokens * COST_PER_MSG_REAL / 1000;
    const usageLog = await prisma.llmUsageLog.create({
      data: {
        userId, platform, model: "gemini-2.5-flash",
        inputTokens, outputTokens, totalTokens,
        costReal,
        costCharged: 0,
        messagesCharged: 0,
      },
    });
    await prisma.costEntry.create({
      data: {
        category: "llm",
        description: `gemini-2.5-flash — ${totalTokens} tokens`,
        amountUsd: costReal,
        userId,
        reference: usageLog.id,
      },
    }).catch((e: unknown) => console.error("[Credit] CostEntry error:", e));
    return { allowed: true, remaining: -1, alert: null };
  }

  const credit = await prisma.llmCredit.findUnique({ where: { userId } });

  // No credit record = free trial user or not initialized — allow but init
  if (!credit) {
    await initCredits(userId);
    return { allowed: true, remaining: FREE_MESSAGES - 1, alert: null };
  }

  // Free trial active = unlimited messages
  if (credit.freeTrialActive && credit.freeTrialEndsAt && credit.freeTrialEndsAt > new Date()) {
    // Log usage but don't deduct
    const totalTokens = inputTokens + outputTokens;
    const costReal = totalTokens * COST_PER_MSG_REAL / 1000;
    const usageLog = await prisma.llmUsageLog.create({
      data: {
        userId, platform, model: "gemini-2.5-flash",
        inputTokens, outputTokens, totalTokens,
        costReal,
        costCharged: 0,
        messagesCharged: 0,
      },
    });
    await prisma.costEntry.create({
      data: {
        category: "llm",
        description: `gemini-2.5-flash — ${totalTokens} tokens`,
        amountUsd: costReal,
        userId,
        reference: usageLog.id,
      },
    }).catch((e: unknown) => console.error("[Credit] CostEntry error:", e));
    // Update usage counter for stats (but don't deduct remaining)
    await prisma.llmCredit.update({
      where: { userId },
      data: { messagesUsed: { increment: 1 } },
    });
    return { allowed: true, remaining: credit.messagesRemaining, alert: null };
  }

  // Check if messages remain
  if (credit.messagesRemaining <= 0) {
    // Send 100% alert if not sent
    if (!credit.alert100Sent) {
      const info = await getUserChatInfo(userId);
      if (info) {
        const lang = detectLang(info.chatId);
        const msg = lang === "pt"
          ? "Suas mensagens acabaram.\n\nRecarregue para continuar:\n\n1. 15.000 msgs — $10\n2. 50.000 msgs — $25\n\nOu seja ilimitado: payjarvis.com/upgrade"
          : "Your messages have run out.\n\nRecharge to continue:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25\n\nOr go unlimited: payjarvis.com/upgrade";
        sendAlert(info.platform, info.chatId, msg).catch(() => {});
      }
      await prisma.llmCredit.update({ where: { userId }, data: { alert100Sent: true } });
    }
    return { allowed: false, remaining: 0, alert: "100%" };
  }

  // Consume 1 message
  const totalTokens = inputTokens + outputTokens;
  const costReal = totalTokens * COST_PER_MSG_REAL / 1000;
  const usageLog = await prisma.llmUsageLog.create({
    data: {
      userId, platform, model: "gemini-2.5-flash",
      inputTokens, outputTokens, totalTokens,
      costReal,
      costCharged: COST_PER_MSG_CHARGED,
      messagesCharged: 1,
    },
  });
  await prisma.costEntry.create({
    data: {
      category: "llm",
      description: `gemini-2.5-flash — ${totalTokens} tokens`,
      amountUsd: costReal,
      userId,
      reference: usageLog.id,
    },
  }).catch((e: unknown) => console.error("[Credit] CostEntry error:", e));

  const updated = await prisma.llmCredit.update({
    where: { userId },
    data: {
      messagesUsed: { increment: 1 },
      messagesRemaining: { decrement: 1 },
    },
  });

  // Check alert thresholds
  let alert: ConsumeResult["alert"] = null;
  const percentUsed = updated.messagesUsed / updated.messagesTotal;

  if (percentUsed >= 1.0 && !updated.alert100Sent) {
    alert = "100%";
    await prisma.llmCredit.update({ where: { userId }, data: { alert100Sent: true } });
    const info = await getUserChatInfo(userId);
    if (info) {
      const lang = detectLang(info.chatId);
      const msg = lang === "pt"
        ? "Suas mensagens acabaram.\n\nRecarregue para continuar:\n\n1. 15.000 msgs — $10\n2. 50.000 msgs — $25"
        : "Your messages have run out.\n\nRecharge to continue:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25";
      sendAlert(info.platform, info.chatId, msg).catch(() => {});
    }
  } else if (percentUsed >= 0.9 && !updated.alert90Sent) {
    alert = "90%";
    await prisma.llmCredit.update({ where: { userId }, data: { alert90Sent: true } });
    const info = await getUserChatInfo(userId);
    if (info) {
      const lang = detectLang(info.chatId);
      const remaining = updated.messagesRemaining;
      const msg = lang === "pt"
        ? `Apenas ${remaining} mensagens restantes.\n\nRecarregue agora:\n\n1. 15.000 msgs — $10\n2. 50.000 msgs — $25`
        : `Only ${remaining} messages left.\n\nRecharge now:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25`;
      sendAlert(info.platform, info.chatId, msg).catch(() => {});
    }
  } else if (percentUsed >= 0.75 && !updated.alert75Sent) {
    alert = "75%";
    await prisma.llmCredit.update({ where: { userId }, data: { alert75Sent: true } });
    const info = await getUserChatInfo(userId);
    if (info) {
      const lang = detectLang(info.chatId);
      const remaining = updated.messagesRemaining;
      const msg = lang === "pt"
        ? `You've used 75% of your messages.\n\n${remaining} remaining.\n\nAdd more to keep Jarvis:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25`
        : `You've used 75% of your messages.\n\n${remaining} remaining.\n\nAdd more to keep Jarvis running:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25`;
      sendAlert(info.platform, info.chatId, msg).catch(() => {});
    }
  }

  return { allowed: true, remaining: updated.messagesRemaining, alert };
}

export async function purchaseCredits(
  userId: string,
  packageId: string,
): Promise<PurchaseResult> {
  const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return { success: false, error: "Invalid package" };

  // Get user's saved payment method
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  if (!user?.stripeCustomerId) {
    return { success: false, error: "No payment method. Add card at payjarvis.com/setup-payment" };
  }

  // Charge using Stripe
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

  try {
    // Get default payment method
    const customerRaw = await stripe.customers.retrieve(user.stripeCustomerId);
    const customer = customerRaw as unknown as { deleted?: boolean; invoice_settings?: { default_payment_method?: string } };
    const defaultPM = customer.invoice_settings?.default_payment_method;

    // List payment methods if no default
    let paymentMethodId = defaultPM;
    if (!paymentMethodId) {
      const methods = await stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: "card",
        limit: 1,
      });
      paymentMethodId = methods.data[0]?.id;
    }

    if (!paymentMethodId) {
      return { success: false, error: "No card on file. Add one at payjarvis.com/setup-payment" };
    }

    // Create and confirm payment intent
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(pkg.priceUsd * 100),
      currency: "usd",
      customer: user.stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: { packageId: pkg.id, userId, messages: String(pkg.messages) },
    });

    if (intent.status !== "succeeded") {
      return { success: false, error: `Payment status: ${intent.status}` };
    }

    // Add messages
    const updated = await prisma.llmCredit.update({
      where: { userId },
      data: {
        messagesTotal: { increment: pkg.messages },
        messagesRemaining: { increment: pkg.messages },
        // Reset alerts so they can fire again for new balance
        alert75Sent: false,
        alert90Sent: false,
        alert100Sent: false,
      },
    });

    // Record purchase
    await prisma.creditPurchase.create({
      data: {
        userId,
        packageId: pkg.id,
        messagesAdded: pkg.messages,
        amountUsd: pkg.priceUsd,
        stripePaymentId: intent.id,
        status: "completed",
      },
    });

    console.log(`[Credit] Purchase: ${userId} bought ${pkg.id} (+${pkg.messages} msgs)`);

    return {
      success: true,
      messagesAdded: pkg.messages,
      newBalance: updated.messagesRemaining,
      stripePaymentId: intent.id,
    };
  } catch (err) {
    console.error("[Credit] Purchase error:", (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
}

export async function getBalance(userId: string): Promise<CreditBalance | null> {
  const credit = await prisma.llmCredit.findUnique({ where: { userId } });
  if (!credit) return null;

  let freeTrialDaysLeft: number | null = null;
  if (credit.freeTrialActive && credit.freeTrialEndsAt) {
    const diff = credit.freeTrialEndsAt.getTime() - Date.now();
    freeTrialDaysLeft = Math.max(0, Math.ceil(diff / 86400000));
  }

  return {
    messagesTotal: credit.messagesTotal,
    messagesUsed: credit.messagesUsed,
    messagesRemaining: credit.messagesRemaining,
    percentUsed: credit.messagesTotal > 0 ? Math.round((credit.messagesUsed / credit.messagesTotal) * 100) : 0,
    freeTrialActive: credit.freeTrialActive,
    freeTrialDaysLeft,
  };
}

/**
 * Check trial expiration alerts. Called by cron daily at 9 AM.
 */
export async function processTrialAlerts(): Promise<void> {
  const now = new Date();

  // Day 55 alert (5 days left)
  const day55 = new Date(now.getTime() + 5 * 86400000);
  const day55Start = new Date(day55.toISOString().split("T")[0]);
  const day55End = new Date(day55Start.getTime() + 86400000);

  const trials55 = await prisma.llmCredit.findMany({
    where: {
      freeTrialActive: true,
      alertDay55Sent: false,
      freeTrialEndsAt: { gte: day55Start, lt: day55End },
    },
  });

  for (const credit of trials55) {
    const info = await getUserChatInfo(credit.userId);
    if (info) {
      const lang = detectLang(info.chatId);
      const msg = lang === "pt"
        ? "O periodo Beta esta acabando.\n\nManter seu agente de compras por $20/mes?\n\n1. Sim, manter Jarvis\n2. Agora nao"
        : "The Beta period is ending soon.\n\nKeep your shopping agent for $20/month?\n\n1. Yes, keep Jarvis\n2. Not now";
      await sendAlert(info.platform, info.chatId, msg);
    }
    await prisma.llmCredit.update({ where: { id: credit.id }, data: { alertDay55Sent: true } });
  }

  // Day 58 alert (2 days left)
  const day58 = new Date(now.getTime() + 2 * 86400000);
  const day58Start = new Date(day58.toISOString().split("T")[0]);
  const day58End = new Date(day58Start.getTime() + 86400000);

  const trials58 = await prisma.llmCredit.findMany({
    where: {
      freeTrialActive: true,
      alertDay58Sent: false,
      freeTrialEndsAt: { gte: day58Start, lt: day58End },
    },
  });

  for (const credit of trials58) {
    const info = await getUserChatInfo(credit.userId);
    if (info) {
      const lang = detectLang(info.chatId);
      const msg = lang === "pt"
        ? "2 days left in Beta.\n\n1. Keep Jarvis — $20/month\n2. Not now"
        : "2 days remaining of Beta access.\n\n1. Keep Jarvis — $20/month\n2. Not now";
      await sendAlert(info.platform, info.chatId, msg);
    }
    await prisma.llmCredit.update({ where: { id: credit.id }, data: { alertDay58Sent: true } });
  }

  // Day 60 alert (today)
  const todayStart = new Date(now.toISOString().split("T")[0]);
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const trials60 = await prisma.llmCredit.findMany({
    where: {
      freeTrialActive: true,
      alertDay60Sent: false,
      freeTrialEndsAt: { gte: todayStart, lt: todayEnd },
    },
  });

  for (const credit of trials60) {
    const info = await getUserChatInfo(credit.userId);
    if (info) {
      const lang = detectLang(info.chatId);
      const msg = lang === "pt"
        ? `The Beta period ends today.\n\nYou sent ${credit.messagesUsed} messages with Jarvis.\n\nContinue for $20/month?\n\n1. Yes — keep my assistant\n2. Not now — maybe later`
        : `Your Beta access ends today.\n\nYou've sent ${credit.messagesUsed} messages with Jarvis.\n\nContinue for $20/month?\n\n1. Yes — keep my assistant\n2. Not now — maybe later`;
      await sendAlert(info.platform, info.chatId, msg);
    }
    // Deactivate trial
    await prisma.llmCredit.update({
      where: { id: credit.id },
      data: { alertDay60Sent: true, freeTrialActive: false },
    });
  }

  const total = trials55.length + trials58.length + trials60.length;
  if (total > 0) {
    console.log(`[Credit] Trial alerts: ${trials55.length} day55, ${trials58.length} day58, ${trials60.length} day60`);
  }
}

export const creditService = {
  initCredits,
  consumeMessage,
  purchaseCredits,
  getBalance,
  processTrialAlerts,
  CREDIT_PACKAGES,
};
