/**
 * Watchdog Cron — monitors unfulfilled promises and sends fallbacks.
 *
 * Runs every 60 seconds:
 *   1. Finds PENDING promises older than 60s
 *   2. Sends fallback message to the user
 *   3. Marks promise as FAILED
 *   4. If 3+ failures in 1 hour → alerts admin via Telegram
 */

import cron from "node-cron";
import {
  getExpiredPromises,
  markPromiseFailed,
  getFailedCountLastHour,
  buildFallbackMessage,
  detectLangFromUser,
} from "../services/watchdog/promise-tracker.js";
import { sendWhatsAppMessage } from "../services/twilio-whatsapp.service.js";
import { sendTelegramNotification, sendAdminTelegramNotification } from "../services/notifications.js";
import { redisGet, redisSet } from "../services/redis.js";

// ─── Process Expired Promises (every 60 seconds) ───

cron.schedule("* * * * *", async () => {
  try {
    const expired = await getExpiredPromises();
    if (expired.length === 0) return;

    console.log(`[WATCHDOG-CRON] Found ${expired.length} expired promises`);

    for (const promise of expired) {
      try {
        const lang = detectLangFromUser(promise.user_id);
        const fallbackMessage = buildFallbackMessage(promise.promise_text, lang);

        // Send fallback based on channel
        if (promise.channel === "whatsapp") {
          await sendWhatsAppMessage(promise.user_id, fallbackMessage);
        } else if (promise.channel === "telegram") {
          await sendTelegramNotification(promise.user_id, fallbackMessage);
        }

        await markPromiseFailed(promise.id);
        console.log(`[WATCHDOG-CRON] Fallback sent to ${promise.user_id} (${promise.channel})`);
      } catch (err) {
        console.error(`[WATCHDOG-CRON] Error sending fallback for ${promise.id}:`, (err as Error).message);
        // Still mark as failed to prevent infinite retries
        await markPromiseFailed(promise.id).catch(() => {});
      }
    }

    // ─── Admin Alert: 3+ failures in 1 hour ───
    await checkAndAlertAdmin();
  } catch (err) {
    console.error("[WATCHDOG-CRON] Error:", (err as Error).message);
  }
});

async function checkAndAlertAdmin(): Promise<void> {
  const failedCount = await getFailedCountLastHour();
  if (failedCount < 3) return;

  // Cooldown: only alert once per hour
  const cooldownKey = "watchdog:admin_alert_cooldown";
  const existing = await redisGet(cooldownKey);
  if (existing) return;
  await redisSet(cooldownKey, "1", 3600);

  const message =
    `🐕 <b>WATCHDOG ALERT</b>\n\n` +
    `Jarvis falhou em cumprir <b>${failedCount}</b> promessas na última hora.\n\n` +
    `O sistema auto-healing foi ativado: instruções extras foram adicionadas ao system prompt para evitar promessas vazias.\n\n` +
    `Verifique os logs: <code>pm2 logs payjarvis-api --lines 50 | grep WATCHDOG</code>`;

  try {
    await sendAdminTelegramNotification(message);
    console.log(`[WATCHDOG-CRON] Admin alert sent: ${failedCount} failures in last hour`);
  } catch (err) {
    console.error("[WATCHDOG-CRON] Failed to send admin alert:", (err as Error).message);
  }
}

console.log("[WATCHDOG-CRON] Watchdog cron job scheduled (every 60s)");
