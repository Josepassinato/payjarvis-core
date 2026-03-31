/**
 * Proactive Messages Service — Jarvis reaches out WITHOUT the user asking.
 *
 * Types: morning_briefing, reengagement, achievement, weekly_report,
 *        smart_tips, birthday, price_alert (existing, referenced here).
 */

import { prisma, Prisma } from "@payjarvis/database";
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

async function getUserFacts(userId: string, user?: UserWithChannel): Promise<Record<string, string>> {
  // Facts are stored by telegramChatId or whatsapp:+phone, not by Prisma userId
  const possibleIds = [userId];
  if (user?.telegramChatId) possibleIds.push(user.telegramChatId);
  if (user?.phone) {
    const cleaned = user.phone.replace(/[^+\d]/g, "");
    possibleIds.push(`whatsapp:${cleaned}`);
    if (!cleaned.startsWith("+")) possibleIds.push(`whatsapp:+${cleaned}`);
  }

  const rows = await prisma.$queryRaw<{ fact_key: string; fact_value: string }[]>`
    SELECT fact_key, fact_value FROM openclaw_user_facts WHERE user_id IN (${Prisma.join(possibleIds)})
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
  rainNext12h: boolean;
  maxTempC: number;
  minTempC: number;
}

async function getWeather(lat: number, lon: number, _cityName?: string): Promise<WeatherResult> {
  const cacheKey = `weather:${lat.toFixed(1)}:${lon.toFixed(1)}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&hourly=weather_code,temperature_2m&forecast_hours=12&temperature_unit=celsius&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json() as any;

    const tempC = Math.round(data.current.temperature_2m);
    const tempF = Math.round(tempC * 9 / 5 + 32);
    const code = data.current.weather_code ?? 0;
    const wmo = getWmoInfo(code);

    // Check next 12h for rain (codes 51-67, 80-82, 95-99)
    const hourlyWcodes: number[] = data.hourly?.weather_code ?? [];
    const hourlyTemps: number[] = data.hourly?.temperature_2m ?? [];
    const rainCodes = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
    const rainNext12h = hourlyWcodes.some((c: number) => rainCodes.has(c));
    const maxTempC = hourlyTemps.length > 0 ? Math.round(Math.max(...hourlyTemps)) : tempC;
    const minTempC = hourlyTemps.length > 0 ? Math.round(Math.min(...hourlyTemps)) : tempC;

    const result: WeatherResult = { tempC, tempF, condition: wmo.en, conditionPt: wmo.pt, emoji: wmo.emoji, rainNext12h, maxTempC, minTempC };
    await redisSet(cacheKey, JSON.stringify(result), 1800); // 30 min cache
    console.log(`[WEATHER] Open-Meteo OK: ${tempC}°C / ${tempF}°F, ${wmo.en} ${wmo.emoji}, rain12h=${rainNext12h}`);
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
          const rainNext12h = condLower.includes("rain") || condLower.includes("storm") || condLower.includes("shower");
          const result: WeatherResult = { tempC, tempF, condition, conditionPt: condition, emoji, rainNext12h, maxTempC: tempC, minTempC: tempC };
          await redisSet(cacheKey, JSON.stringify(result), 1800);
          console.log(`[WEATHER] SerpAPI fallback OK: ${tempF}°F, ${condition}`);
          return result;
        }
      }
    } catch { /* both failed */ }
    return { tempC: 0, tempF: 0, condition: "unavailable", conditionPt: "indisponível", emoji: "🌤️", rainNext12h: false, maxTempC: 0, minTempC: 0 };
  }
}

// ─── News (SerpAPI — returns multiple headlines with snippets) ───

interface NewsItem { title: string; snippet: string }

async function getTopNewsItems(topic: string, count: number = 3): Promise<NewsItem[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];

  const cacheKey = `news_items:${topic}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(topic)}&api_key=${key}&num=${count}`
    );
    const data = await res.json() as any;
    const items: NewsItem[] = (data.news_results ?? []).slice(0, count).map((r: any) => ({
      title: r.title ?? "",
      snippet: r.snippet ?? "",
    })).filter((i: NewsItem) => i.title);
    if (items.length > 0) await redisSet(cacheKey, JSON.stringify(items), 7200);
    return items;
  } catch {
    return [];
  }
}

// ─── Dollar/Euro Rate ───

interface FxRates { brl: string; brlChange: string; eur: string; eurChange: string }

async function getCurrencyRates(): Promise<FxRates> {
  const cached = await redisGet("fx:briefing_rates");
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD", { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as any;
    const brl = data.rates?.BRL?.toFixed(2) ?? "?";
    const eurRate = data.rates?.EUR;
    const eurPerUsd = eurRate ? (1 / eurRate).toFixed(2) : "?";

    // Try to get previous day rate for change calculation
    const prevCached = await redisGet("fx:prev_brl");
    let brlChange = "";
    if (prevCached) {
      const prev = parseFloat(prevCached);
      const curr = parseFloat(brl);
      if (!isNaN(prev) && !isNaN(curr) && prev > 0) {
        const pct = ((curr - prev) / prev * 100).toFixed(1);
        brlChange = curr >= prev ? `+${pct}%` : `${pct}%`;
      }
    }
    // Store current as prev for next day
    await redisSet("fx:prev_brl", brl, 86400 * 2);

    const result: FxRates = { brl, brlChange, eur: eurPerUsd, eurChange: "" };
    await redisSet("fx:briefing_rates", JSON.stringify(result), 7200);
    return result;
  } catch {
    return { brl: "?", brlChange: "", eur: "?", eurChange: "" };
  }
}

// ─── Reminders for today ───

interface ReminderInfo { count: number; texts: string[] }

async function getTodayReminders(userId: string): Promise<ReminderInfo> {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const rows = await prisma.$queryRaw<{ reminder_text: string }[]>`
    SELECT reminder_text FROM openclaw_reminders
    WHERE user_id = ${userId} AND remind_at BETWEEN ${now} AND ${endOfDay} AND sent = false
    ORDER BY remind_at ASC LIMIT 3
  `;
  const countRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM openclaw_reminders
    WHERE user_id = ${userId} AND remind_at BETWEEN ${now} AND ${endOfDay} AND sent = false
  `;
  return {
    count: Number(countRows[0]?.count ?? 0),
    texts: rows.map(r => r.reminder_text),
  };
}

// ─── Price Alerts (active, with price drops) ───

interface PriceAlertDrop { query: string; currentPrice: number; targetPrice: number; currency: string }

async function getActivePriceDrops(userId: string): Promise<PriceAlertDrop[]> {
  try {
    const alerts = await prisma.priceAlert.findMany({
      where: {
        userId,
        active: true,
        currentPrice: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });

    return alerts
      .filter(a => a.currentPrice !== null && a.currentPrice <= a.targetPrice)
      .map(a => ({
        query: a.query,
        currentPrice: a.currentPrice!,
        targetPrice: a.targetPrice,
        currency: a.currency,
      }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// MORNING BRIEFING — 5 personalized sections
// ═══════════════════════════════════════════════════════════

// Detect user language
function detectLang(facts: Record<string, string>, user: UserWithChannel): "pt" | "es" | "en" {
  if (facts.language === "pt" || user.country === "BR" || facts.country === "BR") return "pt";
  if (facts.language === "es") return "es";
  return "en";
}

// ─── Geocoding (Open-Meteo Geocoding API — free, no key) ───

async function geocodeCity(city: string, state?: string, country?: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const query = [city, state, country].filter(Boolean).join(", ");
  const cacheKey = `geocode:${query.toLowerCase()}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json() as any;
    const result = data.results?.[0];
    if (!result) return null;

    const geo = { lat: result.latitude, lon: result.longitude, name: result.name };
    await redisSet(cacheKey, JSON.stringify(geo), 86400 * 7); // cache 7 days
    console.log(`[GEOCODE] ${query} → ${geo.lat}, ${geo.lon} (${geo.name})`);
    return geo;
  } catch (err) {
    console.error(`[GEOCODE] Failed for ${query}:`, (err as Error).message);
    return null;
  }
}

// SECTION 1 — Weather + context (not just temp — what it MEANS for the day)
async function buildWeatherSection(user: UserWithChannel, facts: Record<string, string>, lang: "pt" | "es" | "en"): Promise<string> {
  let lat = user.latitude;
  let lon = user.longitude;
  let city = facts.city || facts.location || "";

  // Fallback: geocode from user facts when no GPS coordinates
  if (!lat || !lon) {
    if (city) {
      const geo = await geocodeCity(city, facts.state, facts.country);
      if (geo) {
        lat = geo.lat;
        lon = geo.lon;
        if (!city) city = geo.name;
      }
    }
  }

  if (!lat || !lon) return "";
  if (!city) city = lang === "pt" ? "sua cidade" : "your area";

  const w = await getWeather(lat, lon, city);
  if (w.tempC === 0 && w.condition === "unavailable") return "";

  const isUS = user.country === "US" || facts.country === "US" || lang === "en";
  const temp = isUS ? `${w.tempF}°F` : `${w.tempC}°C`;

  // Context-aware weather comment
  let comment = "";
  if (lang === "pt") {
    if (w.tempC >= 30) comment = "dia quente!";
    else if (w.tempC >= 25) comment = "dia lindo!";
    else if (w.tempC >= 18) comment = "clima agradavel.";
    else if (w.tempC >= 10) comment = "esfriou, se agasalha!";
    else comment = "frio incomum, se proteja!";
    if (w.rainNext12h && !comment.includes("chuva")) comment += " Leva guarda-chuva!";
  } else {
    if (w.tempF >= 90) comment = "hot one today!";
    else if (w.tempF >= 75) comment = "beautiful day!";
    else if (w.tempF >= 60) comment = "nice weather.";
    else if (w.tempF >= 45) comment = "chilly — grab a jacket!";
    else comment = "cold day, bundle up!";
    if (w.rainNext12h && !comment.includes("rain")) comment += " Bring an umbrella!";
  }

  return `${w.emoji} ${temp} ${lang === "pt" ? "em" : "in"} ${city} — ${comment}`;
}

// SECTION 2 — Personalized alerts (price drops, reminders, etc.)
async function buildAlertsSection(user: UserWithChannel, facts: Record<string, string>, lang: "pt" | "es" | "en"): Promise<string> {
  const lines: string[] = [];

  // Price alert drops
  const drops = await getActivePriceDrops(user.id);
  for (const d of drops) {
    const curr = d.currency === "BRL" ? "R$" : "$";
    const saved = Math.round(d.targetPrice - d.currentPrice);
    if (lang === "pt") {
      lines.push(`🔥 ${d.query} caiu $${saved}! Ta ${curr}${d.currentPrice.toFixed(0)}`);
    } else {
      lines.push(`🔥 ${d.query} dropped $${saved}! Now ${curr}${d.currentPrice.toFixed(0)}`);
    }
  }

  // Today's reminders (show up to 2 with text)
  const reminders = await getTodayReminders(user.id);
  if (reminders.count > 0) {
    const shown = reminders.texts.slice(0, 2);
    for (const text of shown) {
      lines.push(`📅 ${text}`);
    }
    if (reminders.count > 2) {
      lines.push(lang === "pt" ? `+${reminders.count - 2} lembretes hoje` : `+${reminders.count - 2} more today`);
    }
  }

  return lines.join("\n");
}

// SECTION 3 — News (2-3 headlines based on user interests, with context)
async function buildNewsSection(facts: Record<string, string>, lang: "pt" | "es" | "en"): Promise<string> {
  const topics = facts.news_interests || facts.interests || "technology";
  // Split by comma and search first topic for better relevance
  const mainTopic = topics.split(",")[0].trim();
  const items = await getTopNewsItems(mainTopic, 3);
  if (items.length === 0) return "";

  return items.slice(0, 2).map(item => {
    // Truncate title to ~60 chars for WhatsApp readability
    const title = item.title.length > 60 ? item.title.substring(0, 57) + "..." : item.title;
    return `📰 ${title}`;
  }).join("\n");
}

// SECTION 4 — Rotating tip (never repeat for same user)
const BRIEFING_TIPS_PT = [
  "Sabia que posso ligar pra restaurante e reservar por voce? E so pedir!",
  "Me manda uma foto de qualquer produto e eu acho o melhor preco!",
  "Diga 'monitora o preco do [produto]' e te aviso quando cair!",
  "Manda audio que eu entendo perfeitamente!",
  "Posso rastrear qualquer encomenda — manda o codigo!",
  "Diga 'compara preco de [produto]' e busco em 100+ lojas!",
  "Posso gerar documentos como PDF — contratos, cartas, relatorios!",
  "Busco voos, hoteis e restaurantes pra sua viagem!",
  "Diga 'relatorio semanal' pra ver suas estatisticas!",
  "Posso fazer ligacoes telefonicas por voce — e so pedir!",
];

const BRIEFING_TIPS_EN = [
  "I can call restaurants and make reservations for you!",
  "Send me a photo of any product and I'll find the best price!",
  "Say 'monitor price of [product]' and I'll alert you when it drops!",
  "Send me a voice message — I understand audio perfectly!",
  "I can track any package — just send me the tracking code!",
  "Say 'compare prices of [product]' and I'll search 100+ stores!",
  "I can generate PDFs — contracts, letters, reports!",
  "I can search flights, hotels, and restaurants for your trip!",
  "Say 'weekly report' to see your usage stats!",
  "I can make phone calls on your behalf — just ask!",
];

async function buildTipSection(userId: string, lang: "pt" | "es" | "en"): Promise<string> {
  const tips = lang === "pt" ? BRIEFING_TIPS_PT : BRIEFING_TIPS_EN;
  const sentKey = `briefing_tips:${userId}`;
  const sentRaw = await redisGet(sentKey);
  const sentIndices: number[] = sentRaw ? JSON.parse(sentRaw) : [];

  const available = tips.map((_, i) => i).filter(i => !sentIndices.includes(i));
  if (available.length === 0) {
    // Reset cycle
    await redisSet(sentKey, "[]", 86400 * 60);
    return "";
  }

  const idx = available[Math.floor(Math.random() * available.length)];
  sentIndices.push(idx);
  await redisSet(sentKey, JSON.stringify(sentIndices), 86400 * 60);

  return `💡 ${tips[idx]}`;
}

// SECTION 5 — Currency rates (only for Brazilians)
async function buildCurrencySection(lang: "pt" | "es" | "en"): Promise<string> {
  if (lang !== "pt") return "";
  const rates = await getCurrencyRates();
  if (rates.brl === "?") return "";
  const change = rates.brlChange ? ` (${rates.brlChange})` : "";
  return `💰 Dolar: R$${rates.brl}${change}`;
}

// MAIN: Build and send morning briefing
export async function sendMorningBriefing(user: UserWithChannel) {
  const prefs = await getOrCreatePrefs(user.id);
  if (!prefs.morningBriefing) return;

  const facts = await getUserFacts(user.id, user);
  const name = facts.name || facts.first_name || user.fullName.split(" ")[0];
  const lang = detectLang(facts, user);

  // Build all 5 sections in parallel
  const [weather, alerts, news, tip, currency] = await Promise.all([
    buildWeatherSection(user, facts, lang),
    buildAlertsSection(user, facts, lang),
    buildNewsSection(facts, lang),
    buildTipSection(user.id, lang),
    buildCurrencySection(lang),
  ]);

  // Greeting
  const greeting = lang === "pt" ? "Bom dia" : lang === "es" ? "Buenos dias" : "Morning";

  // Assemble sections — only include non-empty ones
  const sections: string[] = [];
  if (weather) sections.push(weather);
  if (alerts) sections.push(alerts);
  if (news) sections.push(news);
  if (tip) sections.push(tip);
  if (currency) sections.push(currency);

  const closing = lang === "pt" ? "Bom dia! 🦀" : lang === "es" ? "Buen dia! 🦀" : "Have a great day! 🦀";

  let message = `${greeting} ${name}!\n\n${sections.join("\n\n")}\n\n${closing}`;

  // Enforce 500 char limit — prioritize: alerts > weather > news > tip > currency
  if (message.length > 500) {
    const priority = [alerts, weather, news, tip, currency].filter(Boolean);
    let trimmed = `${greeting} ${name}!\n\n`;
    for (const section of priority) {
      if (trimmed.length + section.length + closing.length + 4 > 500) break;
      trimmed += section + "\n\n";
    }
    message = trimmed + closing;
  }

  await sendToUserChannel(user, message, "morning_briefing");
  console.log(`[BRIEFING] Sent to ${name} (${lang}): ${message.length} chars`);
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
