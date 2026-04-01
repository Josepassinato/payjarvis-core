/**
 * Trial Service — 7-day WhatsApp trial for new users.
 *
 * Flow:
 * 1. First WhatsApp contact → auto-activate 7-day trial
 * 2. Day 5 → reminder: "2 days left"
 * 3. Day 7 → trial ends, show 3 options: Premium (R$30) / Telegram / PWA
 * 4. Referral: invite 3 friends → +7 days bonus
 *
 * Free channels (Telegram + PWA) are always unlimited.
 * WhatsApp after trial requires Premium subscription.
 */

import { prisma } from "@payjarvis/database";

const TRIAL_DAYS = 7;
const REFERRAL_BONUS_DAYS = 7;
const REFERRALS_NEEDED = 3;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Jarvis12Brain_bot";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+17547145921";

// ─── Helpers ─────────────────────────────────────────────

function detectLang(phone: string): "pt" | "en" | "es" {
  if (phone.includes("+55")) return "pt";
  if (phone.includes("+34") || phone.includes("+52") || phone.includes("+54")) return "es";
  return "en";
}

async function sendWhatsApp(to: string, body: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: TWILIO_WHATSAPP_NUMBER,
        To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
        Body: body,
      }).toString(),
    });
  } catch (err) {
    console.error("[Trial] sendWhatsApp error:", (err as Error).message);
  }
}

// ─── Core Functions ──────────────────────────────────────

export interface TrialStatus {
  hasActiveTrial: boolean;
  trialExpired: boolean;
  isPremium: boolean;
  daysLeft: number;
  canUseWhatsApp: boolean;
  referralCount: number;
  referralsNeeded: number;
}

/**
 * Check if a WhatsApp user can send messages.
 * Auto-activates trial on first contact.
 * Returns whether the message should be processed.
 */
export async function checkWhatsAppAccess(userId: string, phone: string): Promise<{
  allowed: boolean;
  status: TrialStatus;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      planType: true,
      subscriptionStatus: true,
      whatsappTrialStartsAt: true,
      whatsappTrialEndsAt: true,
      whatsappTrialExpired: true,
      referralBonusDays: true,
      referralCount: true,
    },
  });

  if (!user) {
    return {
      allowed: false,
      status: {
        hasActiveTrial: false, trialExpired: false, isPremium: false,
        daysLeft: 0, canUseWhatsApp: false, referralCount: 0, referralsNeeded: REFERRALS_NEEDED,
      },
    };
  }

  // Premium users always have access
  if (user.planType === "premium" && user.subscriptionStatus === "active") {
    return {
      allowed: true,
      status: {
        hasActiveTrial: false, trialExpired: false, isPremium: true,
        daysLeft: -1, canUseWhatsApp: true, referralCount: user.referralCount, referralsNeeded: 0,
      },
    };
  }

  // No trial started yet → activate now
  if (!user.whatsappTrialStartsAt) {
    const totalDays = TRIAL_DAYS + (user.referralBonusDays || 0);
    const startsAt = new Date();
    const endsAt = new Date(Date.now() + totalDays * 86_400_000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappTrialStartsAt: startsAt,
        whatsappTrialEndsAt: endsAt,
        planType: "trial",
      },
    });

    console.log(`[Trial] Activated ${totalDays}-day WhatsApp trial for ${userId}`);

    return {
      allowed: true,
      status: {
        hasActiveTrial: true, trialExpired: false, isPremium: false,
        daysLeft: totalDays, canUseWhatsApp: true, referralCount: user.referralCount, referralsNeeded: REFERRALS_NEEDED,
      },
    };
  }

  // Trial exists — check if still active
  const now = Date.now();
  const endsAt = user.whatsappTrialEndsAt!.getTime();
  const daysLeft = Math.max(0, Math.ceil((endsAt - now) / 86_400_000));

  if (now < endsAt) {
    // Trial still active
    return {
      allowed: true,
      status: {
        hasActiveTrial: true, trialExpired: false, isPremium: false,
        daysLeft, canUseWhatsApp: true, referralCount: user.referralCount, referralsNeeded: REFERRALS_NEEDED,
      },
    };
  }

  // Trial expired
  if (!user.whatsappTrialExpired) {
    await prisma.user.update({
      where: { id: userId },
      data: { whatsappTrialExpired: true, planType: "free" },
    });
  }

  return {
    allowed: false,
    status: {
      hasActiveTrial: false, trialExpired: true, isPremium: false,
      daysLeft: 0, canUseWhatsApp: false, referralCount: user.referralCount, referralsNeeded: REFERRALS_NEEDED,
    },
  };
}

/**
 * Send the trial expiry message with 3 options.
 */
export async function sendTrialExpiredMessage(phone: string): Promise<void> {
  const lang = detectLang(phone);
  const telegramLink = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
  const pwaLink = "https://www.payjarvis.com/chat";
  const upgradeLink = "https://www.payjarvis.com/upgrade";

  const messages: Record<string, string> = {
    pt: `🦀 Seu trial de 7 dias no WhatsApp acabou!

Voce pode continuar usando o Jarvis de 3 formas:

1️⃣ *Premium WhatsApp + Chamadas* — R$30/mes
${upgradeLink}

2️⃣ *Telegram* — Gratis, sem limites
${telegramLink}

3️⃣ *App (PWA)* — Gratis, com voz
${pwaLink}

Indica 3 amigos e ganha +7 dias gratis no WhatsApp! Manda "indicar" pra saber mais.`,

    en: `🦀 Your 7-day WhatsApp trial has ended!

You can keep using Jarvis in 3 ways:

1️⃣ *Premium WhatsApp + Calls* — R$30/month
${upgradeLink}

2️⃣ *Telegram* — Free, unlimited
${telegramLink}

3️⃣ *App (PWA)* — Free, with voice
${pwaLink}

Refer 3 friends and get +7 free days on WhatsApp! Send "refer" to learn more.`,

    es: `🦀 Tu trial de 7 dias en WhatsApp termino!

Puedes seguir usando Jarvis de 3 formas:

1️⃣ *Premium WhatsApp + Llamadas* — R$30/mes
${upgradeLink}

2️⃣ *Telegram* — Gratis, sin limites
${telegramLink}

3️⃣ *App (PWA)* — Gratis, con voz
${pwaLink}

Recomienda 3 amigos y gana +7 dias gratis en WhatsApp! Envia "recomendar" para saber mas.`,
  };

  await sendWhatsApp(phone, messages[lang] || messages.en);
}

/**
 * Send trial reminder (called by cron at day 5).
 */
export async function sendTrialReminder(userId: string, daysLeft: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  if (!user?.phone) return;

  const lang = detectLang(user.phone);
  const telegramLink = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

  const messages: Record<string, string> = {
    pt: `🦀 Faltam ${daysLeft} dia${daysLeft > 1 ? "s" : ""} do seu trial no WhatsApp!

Pra continuar aqui:
• *Premium* R$30/mes → payjarvis.com/upgrade
• Ou use gratis no *Telegram*: ${telegramLink}

Indica 3 amigos = +7 dias gratis!`,

    en: `🦀 ${daysLeft} day${daysLeft > 1 ? "s" : ""} left on your WhatsApp trial!

To keep using WhatsApp:
• *Premium* R$30/month → payjarvis.com/upgrade
• Or use free on *Telegram*: ${telegramLink}

Refer 3 friends = +7 free days!`,

    es: `🦀 Quedan ${daysLeft} dia${daysLeft > 1 ? "s" : ""} de tu trial en WhatsApp!

Para continuar aqui:
• *Premium* R$30/mes → payjarvis.com/upgrade
• O usa gratis en *Telegram*: ${telegramLink}

Recomienda 3 amigos = +7 dias gratis!`,
  };

  await sendWhatsApp(user.phone, messages[lang] || messages.en);
}

/**
 * Process a referral signup. Called when a new user signs up with a referral code.
 */
export async function processReferral(referrerUserId: string, newUserId: string): Promise<void> {
  // Update referrer count
  const referrer = await prisma.user.update({
    where: { id: referrerUserId },
    data: {
      referralCount: { increment: 1 },
    },
  });

  // Mark new user as referred
  await prisma.user.update({
    where: { id: newUserId },
    data: { referredByUserId: referrerUserId },
  });

  // Check if referrer earned bonus (every 3 referrals = +7 days)
  if (referrer.referralCount > 0 && referrer.referralCount % REFERRALS_NEEDED === 0) {
    const bonusDays = REFERRAL_BONUS_DAYS;

    // Extend trial if active, or add bonus days for future
    if (referrer.whatsappTrialEndsAt && referrer.whatsappTrialEndsAt > new Date()) {
      // Active trial — extend it
      await prisma.user.update({
        where: { id: referrerUserId },
        data: {
          whatsappTrialEndsAt: new Date(referrer.whatsappTrialEndsAt.getTime() + bonusDays * 86_400_000),
          referralBonusDays: { increment: bonusDays },
        },
      });
    } else if (referrer.whatsappTrialExpired) {
      // Expired trial — reactivate with bonus
      await prisma.user.update({
        where: { id: referrerUserId },
        data: {
          whatsappTrialStartsAt: new Date(),
          whatsappTrialEndsAt: new Date(Date.now() + bonusDays * 86_400_000),
          whatsappTrialExpired: false,
          planType: "trial",
          referralBonusDays: { increment: bonusDays },
        },
      });
    } else {
      // No trial yet — store bonus for when they start
      await prisma.user.update({
        where: { id: referrerUserId },
        data: { referralBonusDays: { increment: bonusDays } },
      });
    }

    // Notify referrer
    const referrerData = await prisma.user.findUnique({
      where: { id: referrerUserId },
      select: { phone: true, telegramChatId: true },
    });

    if (referrerData?.phone) {
      const lang = detectLang(referrerData.phone);
      const msg = lang === "pt"
        ? `🎉 Voce indicou ${referrer.referralCount} amigos! Ganhou +${bonusDays} dias gratis no WhatsApp! 🦀`
        : `🎉 You referred ${referrer.referralCount} friends! Got +${bonusDays} free WhatsApp days! 🦀`;
      await sendWhatsApp(referrerData.phone, msg);
    }
    if (referrerData?.telegramChatId && TELEGRAM_BOT_TOKEN) {
      const msg = `🎉 You referred ${referrer.referralCount} friends! +${bonusDays} free WhatsApp days earned! 🦀`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: referrerData.telegramChatId, text: msg }),
      }).catch(() => {});
    }

    console.log(`[Trial] Referral bonus: ${referrerUserId} earned +${bonusDays} days (total referrals: ${referrer.referralCount})`);
  }
}

/**
 * Cron job: process trial alerts daily.
 * - Day 5 (2 days left): reminder
 * - Day 7 (0 days left): expiry message + block
 */
export async function processWhatsAppTrialAlerts(): Promise<void> {
  const now = new Date();

  // Find trials expiring in 2 days (day 5 reminder)
  const twoDaysFromNow = new Date(now.getTime() + 2 * 86_400_000);
  const twoDaysStart = new Date(twoDaysFromNow.toISOString().split("T")[0]);
  const twoDaysEnd = new Date(twoDaysStart.getTime() + 86_400_000);

  const reminders = await prisma.user.findMany({
    where: {
      whatsappTrialEndsAt: { gte: twoDaysStart, lt: twoDaysEnd },
      whatsappTrialExpired: false,
      planType: "trial",
      // Only send once — check if trial started 5+ days ago
      whatsappTrialStartsAt: { lt: new Date(now.getTime() - 4 * 86_400_000) },
    },
    select: { id: true, phone: true },
  });

  for (const user of reminders) {
    await sendTrialReminder(user.id, 2);
  }

  // Find trials expiring today
  const todayStart = new Date(now.toISOString().split("T")[0]);
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const expiring = await prisma.user.findMany({
    where: {
      whatsappTrialEndsAt: { gte: todayStart, lt: todayEnd },
      whatsappTrialExpired: false,
      planType: "trial",
    },
    select: { id: true, phone: true },
  });

  for (const user of expiring) {
    if (user.phone) {
      await sendTrialExpiredMessage(user.phone);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { whatsappTrialExpired: true, planType: "free" },
    });
  }

  const total = reminders.length + expiring.length;
  if (total > 0) {
    console.log(`[Trial] WhatsApp alerts: ${reminders.length} reminders, ${expiring.length} expired`);
  }
}

export const trialService = {
  checkWhatsAppAccess,
  sendTrialExpiredMessage,
  sendTrialReminder,
  processReferral,
  processWhatsAppTrialAlerts,
};
