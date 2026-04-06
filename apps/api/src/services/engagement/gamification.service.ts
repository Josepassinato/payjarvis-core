/**
 * Gamification Service — streaks, levels, achievements, tracking.
 *
 * Levels:
 *   newbie      (0-10 interactions)
 *   explorer    (11-50)
 *   power_user  (51-200)
 *   jarvis_vip  (200+)
 *
 * Achievements unlock at milestones and are sent as proactive messages.
 */

import { prisma } from "@payjarvis/database";
import { sendTelegramNotification } from "../notifications.js";
import { sendWhatsAppMessage } from "../twilio-whatsapp.service.js";
import { sendPushToUser } from "./push.service.js";

// ─── Achievement Definitions ───

interface Achievement {
  id: string;
  label: string;
  check: (g: GamStats) => boolean;
}

interface GamStats {
  totalInteractions: number;
  totalSearches: number;
  totalCalls: number;
  totalRestaurants: number;
  totalSavingsUsd: number;
  streakDays: number;
  achievements: string[];
}

const ACHIEVEMENTS: Achievement[] = [
  { id: "first_search", label: "🔍 First search!", check: (g) => g.totalSearches >= 1 },
  { id: "first_call", label: "📞 First phone call!", check: (g) => g.totalCalls >= 1 },
  { id: "first_restaurant", label: "🍽️ First restaurant found!", check: (g) => g.totalRestaurants >= 1 },
  { id: "searches_10", label: "🔍 10 searches! You're a pro shopper!", check: (g) => g.totalSearches >= 10 },
  { id: "searches_50", label: "🔍 50 searches! Unstoppable!", check: (g) => g.totalSearches >= 50 },
  { id: "streak_3", label: "🔥 3 days in a row!", check: (g) => g.streakDays >= 3 },
  { id: "streak_7", label: "🔥🔥 7-day streak! On fire!", check: (g) => g.streakDays >= 7 },
  { id: "streak_30", label: "🔥🔥🔥 30-day streak! Legendary!", check: (g) => g.streakDays >= 30 },
  { id: "savings_50", label: "💰 Saved $50 with Sniffer!", check: (g) => g.totalSavingsUsd >= 50 },
  { id: "savings_100", label: "💰💰 Saved $100!", check: (g) => g.totalSavingsUsd >= 100 },
  { id: "savings_500", label: "💰💰💰 Saved $500! Shopping legend!", check: (g) => g.totalSavingsUsd >= 500 },
  { id: "interactions_50", label: "⭐ 50 interactions — Explorer unlocked!", check: (g) => g.totalInteractions >= 50 },
  { id: "interactions_200", label: "🏆 200 interactions — Sniffer VIP!", check: (g) => g.totalInteractions >= 200 },
];

// ─── Level Calculation (savings-based Sniffer tiers) ───

function calculateSavingsLevel(totalSavingsUsd: number): string {
  if (totalSavingsUsd >= 10000) return "legend";
  if (totalSavingsUsd >= 5000) return "master";
  if (totalSavingsUsd >= 2000) return "hunter";
  if (totalSavingsUsd >= 500) return "sniffer";
  return "puppy";
}

function calculateLevel(totalInteractions: number, totalSavingsUsd: number = 0): string {
  // Primary: savings-based level
  return calculateSavingsLevel(totalSavingsUsd);
}

const LEVEL_LABELS: Record<string, string> = {
  puppy: "🐶 Puppy",
  sniffer: "🐕 Sniffer",
  hunter: "🦮 Hunter",
  master: "🏅 Master",
  legend: "🏆 Legend",
};

const LEVEL_THRESHOLDS: Record<string, number> = {
  puppy: 0,
  sniffer: 500,
  hunter: 2000,
  master: 5000,
  legend: 10000,
};

const LEVEL_REWARDS: Record<string, string> = {
  sniffer: "🎁 Caneca Sniffer exclusiva!",
  hunter: "🎁 Camiseta Sniffer + 1 mes Pro!",
  master: "🎁 Kit Sniffer completo + 3 meses Pro!",
  legend: "🎁 Sniffer Pro vitalicio + merch exclusivo!",
};

export function getNextLevelInfo(currentLevel: string, totalSavingsUsd: number) {
  const levels = ["puppy", "sniffer", "hunter", "master", "legend"];
  const idx = levels.indexOf(currentLevel);
  if (idx >= levels.length - 1) return null;
  const nextLevel = levels[idx + 1];
  const threshold = LEVEL_THRESHOLDS[nextLevel];
  return {
    nextLevel,
    nextLevelLabel: LEVEL_LABELS[nextLevel],
    threshold,
    remaining: Math.max(0, threshold - totalSavingsUsd),
  };
}

// ─── Core: Track Interaction ───

export async function trackInteraction(
  userId: string,
  type: "message" | "search" | "call" | "restaurant" | "savings",
  value?: number
) {
  const gam = await prisma.userGamification.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  const now = new Date();
  const lastDate = new Date(gam.lastInteraction);
  const daysDiff = Math.floor((now.getTime() - lastDate.getTime()) / 86_400_000);

  // Streak logic
  let newStreak = gam.streakDays;
  if (daysDiff === 0) {
    // Same day — ensure at least 1 (first interaction of the day)
    if (newStreak === 0) newStreak = 1;
  } else if (daysDiff === 1) {
    newStreak++;
  } else {
    newStreak = 1; // Reset after gap
  }
  const longestStreak = Math.max(gam.longestStreak, newStreak);

  // Increment counters
  const updates: Record<string, any> = {
    totalInteractions: gam.totalInteractions + 1,
    streakDays: newStreak,
    longestStreak,
    lastInteraction: now,
  };

  if (type === "search") updates.totalSearches = gam.totalSearches + 1;
  if (type === "call") updates.totalCalls = gam.totalCalls + 1;
  if (type === "restaurant") updates.totalRestaurants = gam.totalRestaurants + 1;
  if (type === "savings" && value) {
    updates.totalSavingsUsd = gam.totalSavingsUsd + value;
    // Also update monthly leaderboard
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    prisma.savingsLeaderboard.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, totalSaved: value, totalPurchases: 1 },
      update: { totalSaved: { increment: value }, totalPurchases: { increment: 1 } },
    }).catch((e: any) => console.error("[Leaderboard] Upsert failed:", e.message));
  }

  // Level (savings-based)
  const savingsTotal = updates.totalSavingsUsd ?? gam.totalSavingsUsd;
  const newLevel = calculateLevel(updates.totalInteractions, savingsTotal);
  updates.level = newLevel;

  await prisma.userGamification.update({
    where: { userId },
    data: updates,
  });

  // Level up notification with Sniffer branding
  if (newLevel !== gam.level && newLevel !== "puppy") {
    const reward = LEVEL_REWARDS[newLevel] || "";
    const savingsStr = `$${savingsTotal.toFixed(2)}`;
    const levelMsg = [
      `🎉 Parabéns! Você é agora ${LEVEL_LABELS[newLevel]}!`,
      `Economia total: ${savingsStr}`,
      reward ? `\nVocê ganhou: ${reward}` : "",
      reward ? `Me manda seu endereço que a gente envia. 🐕` : "",
    ].filter(Boolean).join("\n");
    await notifyUser(userId, levelMsg);
  }

  return { ...gam, ...updates };
}

// ─── Check & Grant Achievements ───

export async function checkAndGrantAchievements(userId: string) {
  const gam = await prisma.userGamification.findUnique({ where: { userId } });
  if (!gam) return;

  const stats: GamStats = {
    totalInteractions: gam.totalInteractions,
    totalSearches: gam.totalSearches,
    totalCalls: gam.totalCalls,
    totalRestaurants: gam.totalRestaurants,
    totalSavingsUsd: gam.totalSavingsUsd,
    streakDays: gam.streakDays,
    achievements: gam.achievements,
  };

  const newAchievements: string[] = [];

  for (const a of ACHIEVEMENTS) {
    if (stats.achievements.includes(a.id)) continue;
    if (a.check(stats)) {
      newAchievements.push(a.id);
      // Check if user wants achievement notifications
      const prefs = await prisma.userNotificationPreferences.findUnique({ where: { userId } });
      if (prefs?.achievements !== false) {
        await notifyUser(userId, `🎉 Achievement unlocked: ${a.label}`);
      }
    }
  }

  if (newAchievements.length > 0) {
    await prisma.userGamification.update({
      where: { userId },
      data: { achievements: [...stats.achievements, ...newAchievements] },
    });
  }
}

// ─── Get User Gamification Stats ───

export async function getGamificationStats(userId: string) {
  const gam = await prisma.userGamification.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  return {
    level: gam.level,
    levelLabel: LEVEL_LABELS[gam.level] || gam.level,
    streakDays: gam.streakDays,
    longestStreak: gam.longestStreak,
    totalSearches: gam.totalSearches,
    totalCalls: gam.totalCalls,
    totalRestaurants: gam.totalRestaurants,
    totalSavingsUsd: gam.totalSavingsUsd,
    totalInteractions: gam.totalInteractions,
    achievements: gam.achievements,
    allAchievements: ACHIEVEMENTS.map((a) => ({
      id: a.id,
      label: a.label,
      unlocked: gam.achievements.includes(a.id),
    })),
  };
}

// ─── Notify helper ───

async function notifyUser(userId: string, message: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, phone: true },
  });
  if (!user) return;

  if (user.telegramChatId) {
    await sendTelegramNotification(user.telegramChatId, message).catch(() => {});
  }
  if (user.phone) {
    await sendWhatsAppMessage(user.phone, message).catch(() => {});
  }
  await sendPushToUser(userId, "Sniffer 🐕", message).catch(() => {});

  await prisma.proactiveMessageLog.create({
    data: { userId, type: "achievement", channel: "multi", message },
  });
}
