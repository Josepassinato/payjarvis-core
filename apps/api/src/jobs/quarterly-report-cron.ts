/**
 * Quarterly Report Cron — Aggregated savings report
 * Runs on day 1 of Jan, Apr, Jul, Oct at 10AM UTC
 * Posts to @SnifferOfertas + admin Telegram
 */

import cron from "node-cron";
import { prisma } from "@payjarvis/database";
import { writeFileSync, mkdirSync } from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DEALS_CHANNEL_ID = process.env.SNIFFER_DEALS_CHANNEL_ID || "";
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
const REPORTS_DIR = "/root/Payjarvis/reports/quarterly";

async function sendTelegramMessage(chatId: string, text: string) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function runQuarterlyReport() {
  const now = new Date();
  const quarter = Math.ceil(now.getMonth() / 3);
  const year = now.getFullYear();
  const qLabel = `Q${quarter === 1 ? 4 : quarter - 1} ${quarter === 1 ? year - 1 : year}`;

  // Determine months in previous quarter
  const prevQ = quarter === 1 ? 4 : quarter - 1;
  const prevYear = quarter === 1 ? year - 1 : year;
  const months = [1, 2, 3].map((i) => {
    const m = (prevQ - 1) * 3 + i;
    return `${prevYear}-${String(m).padStart(2, "0")}`;
  });

  console.log(`[Quarterly] Generating report for ${qLabel}: ${months.join(", ")}`);

  // Aggregate data
  const leaderboard = await prisma.savingsLeaderboard.findMany({
    where: { month: { in: months } },
  });

  if (leaderboard.length === 0) {
    console.log("[Quarterly] No data for this quarter");
    return;
  }

  // Aggregate per user
  const userTotals = new Map<string, { saved: number; purchases: number }>();
  let totalSaved = 0;
  let totalPurchases = 0;

  for (const entry of leaderboard) {
    const existing = userTotals.get(entry.userId) || { saved: 0, purchases: 0 };
    existing.saved += entry.totalSaved;
    existing.purchases += entry.totalPurchases;
    userTotals.set(entry.userId, existing);
    totalSaved += entry.totalSaved;
    totalPurchases += entry.totalPurchases;
  }

  const totalUsers = userTotals.size;
  const avgSavings = totalUsers > 0 ? totalSaved / totalUsers : 0;
  const usersAbove20pct = [...userTotals.values()].filter((u) => u.saved > avgSavings * 0.2).length;
  const pctAbove20 = totalUsers > 0 ? ((usersAbove20pct / totalUsers) * 100).toFixed(0) : "0";

  // Build report
  const report = [
    `📊 <b>Relatório Sniffer ${qLabel}</b>`,
    "",
    `👥 Farejadores ativos: ${totalUsers}`,
    `🔍 Total de buscas: ${totalPurchases}`,
    `💰 Total economizado: $${totalSaved.toFixed(2)}`,
    `📈 Economia média por usuário: $${avgSavings.toFixed(2)}`,
    `✅ ${pctAbove20}% dos usuários economizaram acima da média`,
    "",
    `🐕 Sniffer — Fareja o melhor preço`,
    `sniffershop.com`,
  ].join("\n");

  // Save markdown report
  try {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const filename = `${REPORTS_DIR}/report-${qLabel.replace(" ", "-")}.md`;
    const markdown = [
      `# Relatório Sniffer ${qLabel}`,
      "",
      `- Farejadores ativos: ${totalUsers}`,
      `- Total de buscas: ${totalPurchases}`,
      `- Total economizado: $${totalSaved.toFixed(2)}`,
      `- Economia média: $${avgSavings.toFixed(2)}`,
      `- % acima da média: ${pctAbove20}%`,
      "",
      `Gerado em: ${now.toISOString()}`,
    ].join("\n");
    writeFileSync(filename, markdown);
    console.log(`[Quarterly] Report saved: ${filename}`);
  } catch (err) {
    console.error("[Quarterly] Failed to save report:", (err as Error).message);
  }

  // Post to channel
  if (DEALS_CHANNEL_ID) await sendTelegramMessage(DEALS_CHANNEL_ID, report);
  if (ADMIN_CHAT_ID) await sendTelegramMessage(ADMIN_CHAT_ID, report);

  console.log(`[Quarterly] Report posted for ${qLabel}`);
}

// Day 1 of Jan, Apr, Jul, Oct at 10AM UTC
cron.schedule("0 10 1 1,4,7,10 *", () => {
  runQuarterlyReport().catch((err) => console.error("[Quarterly] Fatal:", err));
});

console.log("[Cron] Quarterly report: 1st of Jan/Apr/Jul/Oct at 10AM UTC");

export { runQuarterlyReport };
