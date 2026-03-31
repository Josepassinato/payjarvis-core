/**
 * Subscription Cron — Renewal alerts + waste detection.
 *
 * Daily (10AM UTC): Check upcoming renewals (3 days + tomorrow)
 * Monthly (1st, 10AM UTC): Detect unused/wasted subscriptions
 */

import { prisma } from "@payjarvis/database";
import { getUpcomingRenewals, detectWaste, getSubscriptionSummary } from "./subscription-manager.service.js";
import { sendTelegramNotification } from "../notifications.js";
import { sendWhatsAppMessage } from "../twilio-whatsapp.service.js";

// ─── Renewal Alert (daily) ───

export async function checkRenewalAlerts(): Promise<void> {
  console.log("[SUBS-CRON] Checking renewal alerts...");

  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, fullName: true, phone: true, telegramChatId: true, country: true },
  });

  let sent = 0;

  for (const user of users) {
    try {
      // Get subs renewing in 3 days
      const upcoming = await getUpcomingRenewals(user.id, 3);
      if (upcoming.length === 0) continue;

      const name = user.fullName.split(" ")[0];
      const isPt = user.country === "BR";

      for (const sub of upcoming) {
        const curr = sub.currency === "BRL" ? "R$" : "$";
        const daysUntil = sub.nextBillingDate
          ? Math.ceil((new Date(sub.nextBillingDate).getTime() - Date.now()) / 86_400_000)
          : null;

        let urgency = "";
        if (daysUntil === 0 || daysUntil === 1) urgency = isPt ? "AMANHA" : "TOMORROW";
        else if (daysUntil !== null) urgency = isPt ? `em ${daysUntil} dias` : `in ${daysUntil} days`;

        const message = isPt
          ? `📢 ${name}, sua assinatura do ${sub.serviceName} renova ${urgency} por ${curr}${sub.amount}.\n\nQuer manter ou cancelar? 🦀`
          : `📢 ${name}, your ${sub.serviceName} subscription renews ${urgency} for ${curr}${sub.amount}.\n\nKeep or cancel? 🦀`;

        await sendToUser(user, message);
        sent++;
      }
    } catch (err) {
      console.error(`[SUBS-CRON] Alert failed for ${user.id}:`, (err as Error).message);
    }
  }

  console.log(`[SUBS-CRON] Renewal alerts: ${sent} sent`);
}

// ─── Waste Detection (monthly) ───

export async function checkSubscriptionWaste(): Promise<void> {
  console.log("[SUBS-CRON] Checking subscription waste...");

  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, fullName: true, phone: true, telegramChatId: true, country: true },
  });

  let sent = 0;

  for (const user of users) {
    try {
      const waste = await detectWaste(user.id);
      if (waste.length === 0) continue;

      const summary = await getSubscriptionSummary(user.id);
      const name = user.fullName.split(" ")[0];
      const isPt = user.country === "BR";

      const wasteLines = waste.slice(0, 3).map(w => {
        const curr = w.subscription.currency === "BRL" ? "R$" : "$";
        return isPt
          ? `⚠️ ${w.subscription.serviceName} — ${curr}${w.subscription.amount}/${w.subscription.billingCycle}, sem uso ha ${w.daysSinceLastBilled} dias`
          : `⚠️ ${w.subscription.serviceName} — ${curr}${w.subscription.amount}/${w.subscription.billingCycle}, unused for ${w.daysSinceLastBilled} days`;
      });

      const totalSavings = waste.reduce((acc, w) => acc + w.potentialAnnualSavings, 0);

      const message = isPt
        ? `💡 ${name}, resumo mensal de assinaturas:\n\n${wasteLines.join("\n")}\n\n💰 Economia potencial: $${totalSavings}/ano\nQuer cancelar alguma? 🦀`
        : `💡 ${name}, monthly subscription review:\n\n${wasteLines.join("\n")}\n\n💰 Potential savings: $${totalSavings}/year\nWant to cancel any? 🦀`;

      await sendToUser(user, message);
      sent++;
    } catch (err) {
      console.error(`[SUBS-CRON] Waste check failed for ${user.id}:`, (err as Error).message);
    }
  }

  console.log(`[SUBS-CRON] Waste detection: ${sent} users notified`);
}

// ─── Send helper ───

async function sendToUser(
  user: { telegramChatId?: string | null; phone?: string | null },
  message: string,
): Promise<void> {
  if (user.telegramChatId) {
    await sendTelegramNotification(user.telegramChatId, message).catch(() => {});
  }
  if (user.phone) {
    await sendWhatsAppMessage(user.phone, message).catch(() => {});
  }
}
