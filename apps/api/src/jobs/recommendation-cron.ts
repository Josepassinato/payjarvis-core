// Recommendation Cron — Runs every 6 hours, generates proactive
// personalized product recommendations for active users.
// Schedule: "0 0,6,12,18 * * *" (00:00, 06:00, 12:00, 18:00 UTC)

import { prisma } from "@payjarvis/database";
import {
  generateRecommendationsForUser,
  buildRecommendationMessage,
  saveRecommendation,
  markStaleAsIgnored,
} from "../services/engagement/recommendation-engine.service.js";
import { sendTelegramNotification } from "../services/notifications.js";
import { sendPushToUser } from "../services/engagement/push.service.js";

const PAYJARVIS_URL = process.env.PAYJARVIS_URL || "http://localhost:3001";
const BATCH_DELAY = 2000; // 2s between users to avoid API hammering
const ACTIVE_DAYS = 14;

async function sendWhatsAppSafe(phone: string, message: string) {
  try {
    const { sendWhatsAppMessage } = await import("../services/twilio-whatsapp.service.js");
    await sendWhatsAppMessage(phone, message);
    return true;
  } catch {
    return false;
  }
}

function isQuietHours(timezone: string, quietStart: number, quietEnd: number): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
    const hour = parseInt(formatter.format(now), 10);
    if (quietStart > quietEnd) return hour >= quietStart || hour < quietEnd;
    return hour >= quietStart && hour < quietEnd;
  } catch {
    const hour = new Date().getUTCHours();
    return hour < 8 || hour >= 22;
  }
}

export async function runRecommendationCron() {
  const ts = new Date().toISOString();
  console.log(`[RECOMMENDATION-CRON] Started at ${ts}`);

  // 1. Mark stale recommendations as ignored
  await markStaleAsIgnored();

  // 2. Get active users (interacted in last 14 days via gamification table)
  const activeThreshold = new Date(Date.now() - ACTIVE_DAYS * 86_400_000);
  const activeUserIds = await prisma.userGamification.findMany({
    where: { lastInteraction: { gte: activeThreshold } },
    select: { userId: true },
  });
  const activeIdSet = new Set(activeUserIds.map(u => u.userId));

  const allUsers = await prisma.user.findMany({
    where: { status: { in: ["ACTIVE", "PENDING_KYC"] } },
    select: {
      id: true,
      fullName: true,
      phone: true,
      telegramChatId: true,
      notificationChannel: true,
      country: true,
    },
  });
  const users = allUsers.filter(u => activeIdSet.has(u.id));

  console.log(`[RECOMMENDATION-CRON] ${users.length} active users to process`);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      // Check notification preferences
      const prefs = await prisma.userNotificationPreferences.findUnique({
        where: { userId: user.id },
      });
      if (prefs && !prefs.recommendations) {
        skipped++;
        continue;
      }

      // Check quiet hours
      const timezone = prefs?.timezone || "America/New_York";
      const quietStart = prefs?.quietHoursStart ?? 22;
      const quietEnd = prefs?.quietHoursEnd ?? 8;
      if (isQuietHours(timezone, quietStart, quietEnd)) {
        skipped++;
        continue;
      }

      // Generate recommendation
      const candidate = await generateRecommendationsForUser(
        user.id,
        user.telegramChatId,
        user.phone,
      );

      if (!candidate) {
        skipped++;
        continue;
      }

      // Detect language from facts
      const facts = await prisma.$queryRaw<{ fact_key: string; fact_value: string }[]>`
        SELECT fact_key, fact_value FROM openclaw_user_facts
        WHERE user_id = ${user.telegramChatId || user.id}
        AND fact_key IN ('language', 'country')
      `;
      const factsMap: Record<string, string> = {};
      for (const f of facts) factsMap[f.fact_key] = f.fact_value;
      const lang = factsMap.language === "pt" || factsMap.country === "BR" || user.country === "BR" ? "pt"
        : factsMap.language === "es" ? "es" : "en";

      // Build message
      const message = buildRecommendationMessage(candidate, lang as "pt" | "en" | "es");

      // Save to DB first to get recommendation ID for buttons
      const channel = user.telegramChatId ? "telegram" : user.phone ? "whatsapp" : "web";
      const recId = await saveRecommendation(user.id, candidate, message, channel);

      // Build inline keyboard buttons
      const isPt = lang === "pt";
      const tgButtons = {
        inline_keyboard: [
          [
            ...(candidate.productUrl
              ? [{ text: isPt ? "🔗 Ver produto" : "🔗 View product", url: candidate.productUrl }]
              : [{ text: isPt ? "✅ Quero ver" : "✅ Want to see", callback_data: `rec:${recId}:click` }]),
            { text: isPt ? "❌ Não curti" : "❌ Not interested", callback_data: `rec:${recId}:reject` },
          ],
          [{ text: isPt ? "⏸️ Parar dicas" : "⏸️ Stop tips", callback_data: `rec:${recId}:stop` }],
        ],
      };

      // Send via available channels
      const channels: string[] = [];
      if (user.telegramChatId) {
        try {
          await sendTelegramNotification(user.telegramChatId, message, tgButtons);
          channels.push("telegram");
        } catch (err) {
          console.error(`[RECOMMENDATION-CRON] Telegram failed for ${user.fullName}:`, (err as Error).message);
        }
      }
      if (user.phone) {
        const ok = await sendWhatsAppSafe(user.phone, message);
        if (ok) channels.push("whatsapp");
      }
      // Always try push
      try {
        await sendPushToUser(user.id, "🐕 Sniffer", message.substring(0, 200));
      } catch { /* non-critical */ }

      if (channels.length === 0 && !user.telegramChatId && !user.phone) {
        skipped++;
        continue;
      }

      // Also log in proactive_message_logs for dedup with other proactive messages
      const actualChannel = channels.length > 1 ? "multi" : channels[0] || "web";
      await prisma.proactiveMessageLog.create({
        data: {
          userId: user.id,
          type: "recommendation",
          channel: actualChannel,
          message: message.substring(0, 2000),
        },
      });

      sent++;
      console.log(`[RECOMMENDATION-CRON] Sent ${candidate.triggerType} to ${user.fullName} (score: ${candidate.confidenceScore.toFixed(2)})`);

      // Delay between users
      if (sent < users.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    } catch (err) {
      errors++;
      console.error(`[RECOMMENDATION-CRON] Error for ${user.fullName} (${user.id}):`, (err as Error).message);
    }
  }

  console.log(`[RECOMMENDATION-CRON] Complete: ${sent} sent, ${skipped} skipped, ${errors} errors out of ${users.length} users`);
  return { sent, skipped, errors, total: users.length };
}
