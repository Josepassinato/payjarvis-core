/**
 * Leaderboard Cron — Monthly savings ranking
 * Day 1 of each month at 9AM: announce top 10 from previous month
 * Reward top 3 with Pro access
 */

import cron from "node-cron";
import { prisma } from "@payjarvis/database";
import { execFileSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DEALS_CHANNEL_ID = process.env.SNIFFER_DEALS_CHANNEL_ID || "";

async function sendTelegramMessage(chatId: string, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function runMonthlyLeaderboard() {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

  console.log(`[Leaderboard] Processing month: ${monthStr}`);

  const top10 = await prisma.savingsLeaderboard.findMany({
    where: { month: monthStr },
    orderBy: { totalSaved: "desc" },
    take: 10,
  });

  if (top10.length === 0) {
    console.log("[Leaderboard] No entries for this month");
    return;
  }

  // Build ranking message
  const medals = ["🥇", "🥈", "🥉"];
  let ranking = `🏆 <b>Ranking Sniffer — ${monthStr}</b>\n\n`;

  for (let i = 0; i < top10.length; i++) {
    const entry = top10[i];
    const user = await prisma.user.findUnique({
      where: { id: entry.userId },
      select: { fullName: true, telegramChatId: true },
    });
    const name = user?.fullName?.split(" ")[0] || "Farejador";
    const medal = medals[i] || `${i + 1}.`;
    ranking += `${medal} ${name} — $${entry.totalSaved.toFixed(2)} (${entry.totalPurchases} buscas)\n`;
  }

  ranking += `\n🐕 Fareja mais, economiza mais! sniffershop.com`;

  // Post to channel
  if (DEALS_CHANNEL_ID) {
    await sendTelegramMessage(DEALS_CHANNEL_ID, ranking);
  }

  // Reward top 3 with Pro access
  for (let i = 0; i < Math.min(3, top10.length); i++) {
    const entry = top10[i];
    const user = await prisma.user.findUnique({
      where: { id: entry.userId },
      select: { telegramChatId: true, fullName: true, planType: true },
    });

    const months = i === 0 ? 3 : i === 1 ? 2 : 1;
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + months * 30);

    await prisma.user.update({
      where: { id: entry.userId },
      data: {
        planType: "premium",
        subscriptionStatus: "active",
        subscriptionEndsAt: trialEnd,
      },
    });

    if (user?.telegramChatId) {
      const pos = i === 0 ? "1o" : i === 1 ? "2o" : "3o";
      await sendTelegramMessage(
        user.telegramChatId,
        `🏆 Parabéns! Você foi o ${pos} maior farejador de ${monthStr}!\n\nEconomia: $${entry.totalSaved.toFixed(2)}\nPrêmio: ${months} ${months > 1 ? "meses" : "mês"} de Sniffer Pro! 🐕`
      );
    }
  }

  console.log(`[Leaderboard] Done. Top 3 rewarded.`);
}

// Day 1 of each month at 9AM UTC
cron.schedule("0 9 1 * *", () => {
  runMonthlyLeaderboard().catch((err) => console.error("[Leaderboard] Fatal:", err));
});

console.log("[Cron] Leaderboard: monthly 1st at 9AM UTC");

export { runMonthlyLeaderboard };
