/**
 * Price Alert Cron — Checks price alerts every 6 hours.
 * When price drops below target, sends notification via WhatsApp/Telegram.
 */

import { prisma } from "@payjarvis/database";
import { unifiedProductSearch } from "./unified-search.service.js";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE = 10;
const BATCH_DELAY = 2000; // 2s between batches
const PAYJARVIS_URL = process.env.PAYJARVIS_URL || "http://localhost:3001";

export function startPriceAlertCron() {
  console.log("[PRICE-ALERTS] Cron registered — checks every 6 hours");

  // First check after 2 minutes (let server warm up)
  setTimeout(() => {
    checkPriceAlerts().catch(err => console.error("[PRICE-ALERTS] Error:", err.message));
  }, 120_000);

  // Then every 6 hours
  setInterval(() => {
    checkPriceAlerts().catch(err => console.error("[PRICE-ALERTS] Error:", err.message));
  }, CHECK_INTERVAL);
}

export async function checkPriceAlerts() {
  // Auto-expire Deal Radar shadow alerts older than 7 days
  try {
    const expired = await prisma.priceAlert.updateMany({
      where: {
        store: { startsWith: "radar:" },
        active: true,
        createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) },
      },
      data: { active: false },
    });
    if (expired.count > 0) console.log(`[DEAL-RADAR] Expired ${expired.count} shadow alerts (>7 days)`);
  } catch { /* non-critical */ }

  const sixHoursAgo = new Date(Date.now() - CHECK_INTERVAL);

  const alerts = await prisma.priceAlert.findMany({
    where: {
      active: true,
      OR: [
        { lastChecked: null },
        { lastChecked: { lt: sixHoursAgo } },
      ],
    },
    orderBy: { lastChecked: "asc" },
    take: 50, // max 50 alerts per cycle
  });

  if (alerts.length === 0) return;
  console.log(`[PRICE-ALERTS] Checking ${alerts.length} active alerts`);

  // Process in batches
  for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
    const batch = alerts.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async (alert) => {
      try {
        const result = await unifiedProductSearch({
          query: alert.query,
          store: alert.store || undefined,
          country: alert.country,
          maxResults: 1,
        });

        const bestProduct = result.products[0];
        const currentPrice = bestProduct?.price || null;

        // Update current price and lastChecked
        await prisma.priceAlert.update({
          where: { id: alert.id },
          data: { currentPrice, lastChecked: new Date() },
        });

        // Check if price dropped below target
        if (currentPrice !== null && currentPrice <= alert.targetPrice && !alert.notifiedAt) {
          console.log(`[PRICE-ALERTS] TRIGGERED: "${alert.query}" at $${currentPrice} (target: $${alert.targetPrice}) for ${alert.userId}`);

          await prisma.priceAlert.update({
            where: { id: alert.id },
            data: { notifiedAt: new Date() },
          });

          // Send notification
          await sendPriceAlertNotification(alert.userId, {
            query: alert.query,
            store: bestProduct?.store || alert.store || "Online",
            targetPrice: alert.targetPrice,
            currentPrice,
            currency: alert.currency,
            url: bestProduct?.url || "",
          });
        }
      } catch (err) {
        console.error(`[PRICE-ALERTS] Error checking "${alert.query}":`, (err as Error).message);
        // Still update lastChecked to avoid retry storm
        await prisma.priceAlert.update({
          where: { id: alert.id },
          data: { lastChecked: new Date() },
        }).catch(() => {});
      }
    }));

    // Delay between batches
    if (i + BATCH_SIZE < alerts.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  console.log(`[PRICE-ALERTS] Done checking ${alerts.length} alerts`);
}

async function sendPriceAlertNotification(
  userId: string,
  data: { query: string; store: string; targetPrice: number; currentPrice: number; currency: string; url: string }
) {
  const isWhatsApp = userId.startsWith("whatsapp:");
  const curr = data.currency === "BRL" ? "R$" : "$";
  const isRadar = data.store.startsWith("radar:");

  let message: string;
  if (isRadar) {
    // Deal Radar — proactive, unsolicited alert with personality
    const saved = Math.round(data.targetPrice / 0.9 - data.currentPrice);
    const store = data.store.replace("radar:", "");
    message = isWhatsApp
      ? `🦀 Ei! Lembra do ${data.query} que voce pesquisou? Caiu pra ${curr}${data.currentPrice.toFixed(2)}${store !== "multi" ? ` na ${store}` : ""}! Economia de ${curr}${saved}!\n${data.url ? data.url + "\n" : ""}Quer comprar agora?`
      : `🦀 Hey! Remember the ${data.query} you searched? Price dropped to ${curr}${data.currentPrice.toFixed(2)}${store !== "multi" ? ` at ${store}` : ""}! Save ${curr}${saved}!\n${data.url ? data.url + "\n" : ""}Want to buy now?`;
  } else {
    message = isWhatsApp
      ? `Alerta de preco! ${data.query}\n${curr}${data.currentPrice.toFixed(2)} na ${data.store} (meta: ${curr}${data.targetPrice.toFixed(2)})\n${data.url}`
      : `Price alert! ${data.query}\n${curr}${data.currentPrice.toFixed(2)} at ${data.store} (target: ${curr}${data.targetPrice.toFixed(2)})\n${data.url}`;
  }

  if (isWhatsApp) {
    try {
      const { sendWhatsAppMessage } = await import("../twilio-whatsapp.service.js");
      await sendWhatsAppMessage(userId, message);
    } catch (err) {
      console.error(`[PRICE-ALERTS] WhatsApp notification failed for ${userId}:`, (err as Error).message);
    }
  } else {
    // Telegram — send via internal API
    try {
      await fetch(`${PAYJARVIS_URL}/api/notifications/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
        body: JSON.stringify({ chatId: userId, text: message }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      console.error(`[PRICE-ALERTS] Telegram notification failed for ${userId}:`, (err as Error).message);
    }
  }
}
