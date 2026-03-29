/**
 * Proactive Messages Service — Jarvis reaches out WITHOUT the user asking.
 *
 * Types: morning_briefing, reengagement, achievement, weekly_report,
 *        smart_tips, birthday, price_alert (existing, referenced here).
 */

import { prisma } from "@payjarvis/database";
import { sendTelegramNotification } from "../notifications.js";
import { sendWhatsAppMessage } from "../twilio-whatsapp.service.js";
import { redisGet, redisSet } from "../redis.js";
import { sendPushToUser } from "./push.service.js";
import { trackInteraction, checkAndGrantAchievements } from "./gamification.service.js";

// ─── Helpers ───

async function getUserPrefs(userId: string) {
  return prisma.userNotificationPreferences.findUnique({ where: { userId } });
}

async function getOrCreatePrefs(userId: string) {
  return prisma.userNotificationPreferences.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

interface UserWithChannel {
  id: string;
  fullName: string;
  phone?: string | null;
  telegramChatId?: string | null;
  notificationChannel: string;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
  dateOfBirth?: Date | null;
}

async function getActiveUsers(): Promise<UserWithChannel[]> {
  return prisma.user.findMany({
    where: { status: { in: ["ACTIVE", "PENDING_KYC"] } },
    select: {
      id: true,
      fullName: true,
      phone: true,
      telegramChatId: true,
      notificationChannel: true,
      latitude: true,
      longitude: true,
      country: true,
      dateOfBirth: true,
    },
  });
}

async function sendToUserChannel(user: UserWithChannel, message: string, type: string) {
  const channels: string[] = [];
  try {
    // Telegram
    if (user.telegramChatId) {
      await sendTelegramNotification(user.telegramChatId, message);
      channels.push("telegram");
      console.log(`[PROACTIVE] Sent ${type} to ${user.fullName} (${user.id}) via Telegram`);
    }
    // WhatsApp
    if (user.phone) {
      try {
        await sendWhatsAppMessage(user.phone, message.replace(/<[^>]+>/g, "")); // strip HTML
        channels.push("whatsapp");
        console.log(`[PROACTIVE] Sent ${type} to ${user.fullName} (${user.id}) via WhatsApp`);
      } catch {
        console.log(`[PROACTIVE] WhatsApp failed for ${user.fullName} (24h window expired?)`);
      }
    }
    // Push notification (always try)
    await sendPushToUser(user.id, `Jarvis 🦀`, message.replace(/<[^>]+>/g, "").substring(0, 200));
  } catch (err) {
    console.error(`[PROACTIVE] Failed to send ${type} to ${user.id}:`, err);
  }

  if (channels.length === 0 && !user.telegramChatId && !user.phone) {
    console.log(`[PROACTIVE] SKIP ${type} for ${user.fullName} (${user.id}) — no Telegram or WhatsApp`);
    return;
  }

  const channel = channels.length > 1 ? "multi" : channels[0] || "web";

  // Log
  await prisma.proactiveMessageLog.create({
    data: { userId: user.id, type, channel, message: message.substring(0, 2000) },
  });
}

// ─── User Facts Helper ───

async function getUserFacts(userId: string): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<{ fact_key: string; fact_value: string }[]>`
    SELECT fact_key, fact_value FROM openclaw_user_facts WHERE user_id = ${userId}
  `;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.fact_key] = r.fact_value;
  return map;
}

// ─── Weather (Open-Meteo API — free, no key) ───

// WMO Weather interpretation codes → emoji + condition
const WMO_CODES: Record<number, { emoji: string; en: string; pt: string }> = {
  0:  { emoji: "☀️", en: "Clear sky", pt: "Céu limpo" },
  1:  { emoji: "🌤️", en: "Mostly clear", pt: "Predominantemente limpo" },
  2:  { emoji: "⛅", en: "Partly cloudy", pt: "Parcialmente nublado" },
  3:  { emoji: "☁️", en: "Overcast", pt: "Nublado" },
  45: { emoji: "🌫️", en: "Fog", pt: "Neblina" },
  48: { emoji: "🌫️", en: "Rime fog", pt: "Neblina gelada" },
  51: { emoji: "🌦️", en: "Light drizzle", pt: "Garoa leve" },
  53: { emoji: "🌦️", en: "Drizzle", pt: "Garoa" },
  55: { emoji: "🌧️", en: "Heavy drizzle", pt: "Garoa forte" },
  61: { emoji: "🌧️", en: "Light rain", pt: "Chuva leve" },
  63: { emoji: "🌧️", en: "Rain", pt: "Chuva" },
  65: { emoji: "🌧️", en: "Heavy rain", pt: "Chuva forte" },
  66: { emoji: "🌧️", en: "Freezing rain", pt: "Chuva congelante" },
  67: { emoji: "🌧️", en: "Heavy freezing rain", pt: "Chuva congelante forte" },
  71: { emoji: "🌨️", en: "Light snow", pt: "Neve leve" },
  73: { emoji: "🌨️", en: "Snow", pt: "Neve" },
  75: { emoji: "❄️", en: "Heavy snow", pt: "Neve forte" },
  77: { emoji: "❄️", en: "Snow grains", pt: "Granizo de neve" },
  80: { emoji: "🌦️", en: "Light showers", pt: "Pancadas leves" },
  81: { emoji: "🌧️", en: "Showers", pt: "Pancadas de chuva" },
  82: { emoji: "🌧️", en: "Heavy showers", pt: "Pancadas fortes" },
  85: { emoji: "🌨️", en: "Light snow showers", pt: "Pancadas de neve leves" },
  86: { emoji: "🌨️", en: "Snow showers", pt: "Pancadas de neve" },
  95: { emoji: "⛈️", en: "Thunderstorm", pt: "Tempestade" },
  96: { emoji: "⛈️", en: "Thunderstorm + hail", pt: "Tempestade com granizo" },
  99: { emoji: "⛈️", en: "Severe thunderstorm", pt: "Tempestade severa" },
};

function getWmoInfo(code: number): { emoji: string; en: string; pt: string } {
  return WMO_CODES[code] || WMO_CODES[Object.keys(WMO_CODES).map(Number).reduce((prev, curr) => Math.abs(curr - code) < Math.abs(prev - code) ? curr : prev)] || { emoji: "🌤️", en: "Unknown", pt: "Desconhecido" };
}

interface WeatherResult {
  tempC: number;
  tempF: number;
  condition: string;
  conditionPt: string;
  emoji: string;
}

async function getWeather(lat: number, lon: number, _cityName?: string): Promise<WeatherResult> {
  const cacheKey = `weather:${lat.toFixed(1)}:${lon.toFixed(1)}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json() as any;

    const tempC = Math.round(data.current.temperature_2m);
    const tempF = Math.round(tempC * 9 / 5 + 32);
    const code = data.current.weather_code ?? 0;
    const wmo = getWmoInfo(code);

    const result: WeatherResult = { tempC, tempF, condition: wmo.en, conditionPt: wmo.pt, emoji: wmo.emoji };
    await redisSet(cacheKey, JSON.stringify(result), 1800); // 30 min cache
    console.log(`[WEATHER] Open-Meteo OK: ${tempC}°C / ${tempF}°F, ${wmo.en} ${wmo.emoji}`);
    return result;
  } catch (err) {
    console.error("[WEATHER] Open-Meteo failed:", (err as Error).message);
    // Fallback: SerpAPI weather
    try {
      const serpKey = process.env.SERPAPI_KEY;
      if (serpKey) {
        const res = await fetch(`https://serpapi.com/search.json?engine=google&q=weather+${lat.toFixed(2)},${lon.toFixed(2)}&api_key=${serpKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json() as any;
        const answer = data.answer_box;
        if (answer?.temperature) {
          const tempF = parseInt(answer.temperature, 10);
          const tempC = Math.round((tempF - 32) * 5 / 9);
          const condition = answer.weather || "Unknown";
          const condLower = condition.toLowerCase();
          const emoji = condLower.includes("sun") || condLower.includes("clear") ? "☀️"
            : condLower.includes("cloud") ? "☁️" : condLower.includes("rain") ? "🌧️"
            : condLower.includes("storm") || condLower.includes("thunder") ? "⛈️"
            : condLower.includes("snow") ? "❄️" : condLower.includes("fog") ? "🌫️" : "🌤️";
          const result: WeatherResult = { tempC, tempF, condition, conditionPt: condition, emoji };
          await redisSet(cacheKey, JSON.stringify(result), 1800);
          console.log(`[WEATHER] SerpAPI fallback OK: ${tempF}°F, ${condition}`);
          return result;
        }
      }
    } catch { /* both failed */ }
    return { tempC: 0, tempF: 0, condition: "unavailable", conditionPt: "indisponível", emoji: "🌤️" };
  }
}

// ─── News (SerpAPI) ───

async function getTopNews(topic: string): Promise<string> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return "";

  const cached = await redisGet(`news:${topic}`);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(topic)}&api_key=${key}&num=1`
    );
    const data = await res.json() as any;
    const headline = data.news_results?.[0]?.title ?? "";
    if (headline) await redisSet(`news:${topic}`, headline, 7200);
    return headline;
  } catch {
    return "";
  }
}

// ─── Dollar Rate ───

async function getDollarRate(): Promise<string> {
  const cached = await redisGet("fx:usd_brl");
  if (cached) return cached;

  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const data = await res.json() as any;
    const rate = data.rates?.BRL?.toFixed(2) ?? "?";
    await redisSet("fx:usd_brl", rate, 7200);
    return rate;
  } catch {
    return "?";
  }
}

// ─── Reminders Count ───

async function getTodayRemindersCount(userId: string): Promise<number> {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM openclaw_reminders
    WHERE user_id = ${userId} AND remind_at BETWEEN ${now} AND ${endOfDay} AND sent = false
  `;
  return Number(rows[0]?.count ?? 0);
}

// ═══════════════════════════════════════════════════════════
// MORNING BRIEFING
// ═══════════════════════════════════════════════════════════

export async function sendMorningBriefing(user: UserWithChannel) {
  const prefs = await getOrCreatePrefs(user.id);
  if (!prefs.morningBriefing) return;

  const facts = await getUserFacts(user.id);
  const name = facts.name || facts.first_name || user.fullName.split(" ")[0];

  // Weather
  let weatherLine = "";
  if (user.latitude && user.longitude) {
    const city = facts.city || facts.location || "your area";
    const w = await getWeather(user.latitude, user.longitude, city);
    if (w.tempC !== 0 || w.condition !== "unavailable") {
      const isUS = user.country === "US" || facts.country === "US";
      const isPT = facts.language === "pt" || user.country === "BR" || facts.country === "BR";
      const tempStr = isUS ? `${w.tempF}°F` : `${w.tempC}°C`;
      const condStr = isPT ? w.conditionPt : w.condition;
      weatherLine = `🌡️ ${tempStr} in ${city}, ${condStr} ${w.emoji}\n`;
    }
  }

  // Reminders
  const reminderCount = await getTodayRemindersCount(user.id);
  const reminderLine = reminderCount > 0 ? `📅 You have ${reminderCount} reminder(s) today\n` : "";

  // News
  const newsTopic = facts.news_interests || facts.interests || "technology";
  const headline = await getTopNews(newsTopic);
  const newsLine = headline ? `📰 ${headline}\n` : "";

  // Dollar rate for Brazilians
  let fxLine = "";
  if (user.country === "BR" || facts.country === "BR" || facts.language === "pt") {
    const rate = await getDollarRate();
    fxLine = `💰 Dólar: R$${rate}\n`;
  }

  const greeting = facts.language === "pt" ? "Bom dia" : facts.language === "es" ? "Buenos días" : "Good morning";
  const cta = facts.language === "pt"
    ? "Precisa de algo? É só falar! 🦀"
    : facts.language === "es"
    ? "¿Necesitas algo? ¡Solo dime! 🦀"
    : "Need anything? Just say the word! 🦀";

  const message = `${greeting} ${name}! ☀️\n${weatherLine}${reminderLine}${newsLine}${fxLine}\n${cta}`;
  await sendToUserChannel(user, message, "morning_briefing");
}

// ═══════════════════════════════════════════════════════════
// REENGAGEMENT
// ═══════════════════════════════════════════════════════════

export async function checkReengagement() {
  const users = await getActiveUsers();
  const now = Date.now();
  let sent = 0;
  console.log(`[CRON] Reengagement: checking ${users.length} users`);

  for (const user of users) {
    const prefs = await getOrCreatePrefs(user.id);
    if (!prefs.reengagement) continue;

    // Check last interaction
    const gam = await prisma.userGamification.findUnique({ where: { userId: user.id } });
    if (!gam) {
      console.log(`[CRON] Reengagement: SKIP ${user.fullName} — no gamification record`);
      continue;
    }

    const daysSince = Math.floor((now - gam.lastInteraction.getTime()) / 86_400_000);
    if (daysSince < 2) continue;

    // Max 1 reengagement per week
    const lastReeng = await prisma.proactiveMessageLog.findFirst({
      where: { userId: user.id, type: "reengagement" },
      orderBy: { sentAt: "desc" },
    });
    if (lastReeng && now - lastReeng.sentAt.getTime() < 7 * 86_400_000) continue;

    const name = user.fullName.split(" ")[0];
    let message: string;

    if (daysSince <= 3) {
      message = `Hey ${name}, how's it going? I found some cool stuff that might interest you! 🦀`;
    } else if (daysSince <= 7) {
      message = `Missing you! 😄 Did you know I can now search flights and hotels? Give it a try!`;
    } else if (daysSince <= 15) {
      message = `${name}, it's been a while! I've got new features since we last talked. Come say hi! 🦀`;
    } else {
      message = `Hi ${name}! Just checking in to say I'm still here if you need me. Take care! 😊`;
    }

    await sendToUserChannel(user, message, "reengagement");
    sent++;
    console.log(`[CRON] Reengagement: sent to ${user.fullName} (${daysSince} days inactive)`);
  }
  console.log(`[CRON] Reengagement: ${sent} messages sent to ${users.length} users checked`);
}

// ═══════════════════════════════════════════════════════════
// WEEKLY REPORT
// ═══════════════════════════════════════════════════════════

export async function sendWeeklyReport(user: UserWithChannel) {
  const prefs = await getOrCreatePrefs(user.id);
  if (!prefs.weeklyReport) return;

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const name = user.fullName.split(" ")[0];

  // Count conversations this week
  const convos = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM openclaw_conversations
    WHERE user_id = ${user.id} AND role = 'user' AND created_at >= ${weekAgo}
  `;
  const convoCount = Number(convos[0]?.count ?? 0);
  if (convoCount === 0) return; // Don't send to inactive users

  const gam = await prisma.userGamification.findUnique({ where: { userId: user.id } });

  // Count searches this week
  const searches = await prisma.commerceSearchLog.count({
    where: { createdAt: { gte: weekAgo } },
  });

  const message =
    `📊 Your week with Jarvis:\n` +
    `💬 ${convoCount} conversations\n` +
    `🔍 ${searches} product searches\n` +
    (gam ? `💰 Total savings: $${gam.totalSavingsUsd.toFixed(0)}\n` : "") +
    (gam ? `🔥 Streak: ${gam.streakDays} day(s)\n` : "") +
    `\nHave a great week! 🦀`;

  await sendToUserChannel(user, message, "weekly_report");
}

// ═══════════════════════════════════════════════════════════
// BIRTHDAY
// ═══════════════════════════════════════════════════════════

export async function checkBirthdays() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      dateOfBirth: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      telegramChatId: true,
      notificationChannel: true,
      latitude: true,
      longitude: true,
      country: true,
      dateOfBirth: true,
    },
  });

  for (const user of users) {
    if (!user.dateOfBirth) continue;
    const dob = new Date(user.dateOfBirth);
    if (dob.getMonth() + 1 !== month || dob.getDate() !== day) continue;

    const prefs = await getOrCreatePrefs(user.id);
    if (!prefs.birthday) continue;

    // Check if already sent today
    const alreadySent = await prisma.proactiveMessageLog.findFirst({
      where: {
        userId: user.id,
        type: "birthday",
        sentAt: { gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()) },
      },
    });
    if (alreadySent) continue;

    const name = user.fullName.split(" ")[0];
    const message = `🎂 Happy Birthday ${name}! As a gift, your next 20 searches are on me! 🎁🦀`;
    await sendToUserChannel(user, message, "birthday");
  }
}

// ═══════════════════════════════════════════════════════════
// SMART TIPS
// ═══════════════════════════════════════════════════════════

const TIPS = [
  "💡 Tip: Send me a photo of any product and I'll find the best price for you!",
  "💡 Tip: Say 'call [name]' and I'll make the call for you!",
  "💡 Tip: Say 'compare prices of [product]' and I'll search 100+ stores in seconds!",
  "💡 Tip: Send me a voice message — I understand audio perfectly!",
  "💡 Tip: Ask me for directions and I'll send you a Google Maps link!",
  "💡 Tip: I can generate documents (contracts, letters, reports) as PDF!",
  "💡 Tip: Track any package — just send me the tracking code!",
  "💡 Tip: I can search flights, hotels, and restaurants for your next trip!",
  "💡 Tip: Set a price alert and I'll notify you when the price drops!",
  "💡 Tip: Say 'weekly report' to see your usage stats!",
];

export async function sendSmartTip(user: UserWithChannel) {
  const prefs = await getOrCreatePrefs(user.id);
  if (!prefs.smartTips) return;

  // Get already sent tips from Redis
  const sentKey = `tips_sent:${user.id}`;
  const sentRaw = await redisGet(sentKey);
  const sentIndices: number[] = sentRaw ? JSON.parse(sentRaw) : [];

  // Find unsent tip
  const available = TIPS.map((_, i) => i).filter((i) => !sentIndices.includes(i));
  if (available.length === 0) {
    // Reset cycle
    await redisSet(sentKey, "[]", 86400 * 30);
    return;
  }

  const tipIdx = available[Math.floor(Math.random() * available.length)];
  sentIndices.push(tipIdx);
  await redisSet(sentKey, JSON.stringify(sentIndices), 86400 * 30);

  await sendToUserChannel(user, TIPS[tipIdx], "tip");
}

// ═══════════════════════════════════════════════════════════
// CRON RUNNERS (called from engagement-cron.ts)
// ═══════════════════════════════════════════════════════════

export async function runMorningBriefings() {
  const ts = new Date().toISOString();
  console.log(`[CRON] Morning Briefing triggered at ${ts}`);
  const users = await getActiveUsers();
  console.log(`[CRON] Morning Briefing: ${users.length} eligible users found`);
  let sent = 0;
  for (const user of users) {
    try {
      await sendMorningBriefing(user);
      sent++;
    } catch (err) {
      console.error(`[CRON] Briefing FAILED for ${user.fullName} (${user.id}):`, err);
    }
  }
  console.log(`[CRON] Morning Briefing complete: ${sent}/${users.length} sent at ${ts}`);
}

export async function runReengagement() {
  const ts = new Date().toISOString();
  console.log(`[CRON] Reengagement triggered at ${ts}`);
  await checkReengagement();
  console.log(`[CRON] Reengagement complete at ${ts}`);
}

export async function runWeeklyReports() {
  const ts = new Date().toISOString();
  console.log(`[CRON] Weekly Report triggered at ${ts}`);
  const users = await getActiveUsers();
  console.log(`[CRON] Weekly Report: ${users.length} eligible users found`);
  let sent = 0;
  for (const user of users) {
    try {
      await sendWeeklyReport(user);
      sent++;
    } catch (err) {
      console.error(`[CRON] Weekly report FAILED for ${user.fullName} (${user.id}):`, err);
    }
  }
  console.log(`[CRON] Weekly Report complete: ${sent}/${users.length} sent at ${ts}`);
}

export async function runSmartTips() {
  const ts = new Date().toISOString();
  console.log(`[CRON] Smart Tips triggered at ${ts}`);
  const users = await getActiveUsers();
  console.log(`[CRON] Smart Tips: ${users.length} eligible users found`);
  let sent = 0;
  for (const user of users) {
    try {
      await sendSmartTip(user);
      sent++;
    } catch (err) {
      console.error(`[CRON] Tip FAILED for ${user.fullName} (${user.id}):`, err);
    }
  }
  console.log(`[CRON] Smart Tips complete: ${sent}/${users.length} sent at ${ts}`);
}

export async function runBirthdayCheck() {
  const ts = new Date().toISOString();
  console.log(`[CRON] Birthday Check triggered at ${ts}`);
  await checkBirthdays();
  console.log(`[CRON] Birthday Check complete at ${ts}`);
}
