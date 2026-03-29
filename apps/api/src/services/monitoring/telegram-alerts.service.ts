/**
 * Telegram Alerts — sends automated alerts to the admin Telegram bot.
 *
 * Monitors:
 * - Error rate (5%+ = WARNING, 15%+ = CRITICAL)
 * - Response time (>15s = CRITICAL)
 * - Service outages (circuit breaker OPEN)
 * - Kill switch activations
 * - Rate limit abuse
 *
 * Sends to TELEGRAM_ADMIN_CHAT_ID via TELEGRAM_ADMIN_BOT_TOKEN.
 */

import { redisGet, redisSet, redisIncr } from "../redis.js";
import { getAllBreakerStates } from "../resilience/circuit-breaker.js";
import { getKillSwitchStatus } from "../resilience/kill-switch.js";

const ADMIN_BOT_TOKEN = process.env.TELEGRAM_ADMIN_BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
const ALERT_COOLDOWN_SECONDS = 300; // 5 min between same-type alerts

// ─── Send Alert ───

async function sendTelegramAlert(message: string): Promise<void> {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn("[TELEGRAM-ALERT] No admin bot configured, skipping alert");
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("[TELEGRAM-ALERT] Failed to send:", err);
  }
}

// ─── Cooldown (prevent spam) ───

async function canAlert(alertType: string): Promise<boolean> {
  const key = `alert_cooldown:${alertType}`;
  const existing = await redisGet(key);
  if (existing) return false;
  await redisSet(key, "1", ALERT_COOLDOWN_SECONDS);
  return true;
}

// ─── Alert Types ───

export async function alertErrorRate(errorCount: number, totalCount: number, service: string): Promise<void> {
  if (totalCount === 0) return;
  const rate = (errorCount / totalCount) * 100;

  if (rate >= 15) {
    if (await canAlert(`critical_error_${service}`)) {
      await sendTelegramAlert(
        `🔴 <b>CRITICAL — ${service}</b>\n` +
        `Error rate: ${rate.toFixed(1)}% (${errorCount}/${totalCount})\n` +
        `Action: Consider kill switch or investigate immediately`
      );
    }
  } else if (rate >= 5) {
    if (await canAlert(`warning_error_${service}`)) {
      await sendTelegramAlert(
        `🟡 <b>WARNING — ${service}</b>\n` +
        `Error rate: ${rate.toFixed(1)}% (${errorCount}/${totalCount})\n` +
        `Monitoring...`
      );
    }
  }
}

export async function alertSlowResponse(service: string, durationMs: number): Promise<void> {
  if (durationMs >= 15_000) {
    if (await canAlert(`slow_${service}`)) {
      await sendTelegramAlert(
        `🐢 <b>SLOW RESPONSE — ${service}</b>\n` +
        `Duration: ${(durationMs / 1000).toFixed(1)}s\n` +
        `Threshold: 15s`
      );
    }
  }
}

export async function alertCircuitOpen(service: string, failures: number): Promise<void> {
  if (await canAlert(`circuit_${service}`)) {
    await sendTelegramAlert(
      `⚡ <b>CIRCUIT BREAKER OPEN — ${service}</b>\n` +
      `Failures: ${failures}\n` +
      `Service blocked for 60s. Auto-recovery will attempt.`
    );
  }
}

export async function alertKillSwitch(service: string, reason: string): Promise<void> {
  if (await canAlert(`kill_${service}`)) {
    await sendTelegramAlert(
      `⛔ <b>KILL SWITCH ACTIVATED — ${service}</b>\n` +
      `Reason: ${reason}`
    );
  }
}

export async function alertRateLimitAbuse(userId: string, service: string): Promise<void> {
  if (await canAlert(`ratelimit_${service}`)) {
    await sendTelegramAlert(
      `🚫 <b>RATE LIMIT — ${service}</b>\n` +
      `User: ${userId.substring(0, 8)}...\n` +
      `Multiple violations detected`
    );
  }
}

// ─── Request Tracking (for error rate computation) ───

export async function trackRequest(service: string, success: boolean): Promise<void> {
  const bucket = Math.floor(Date.now() / 300_000); // 5-min bucket
  const totalKey = `metrics:${service}:total:${bucket}`;
  const errorKey = `metrics:${service}:errors:${bucket}`;

  await redisIncr(totalKey, 600);
  if (!success) {
    const errors = await redisIncr(errorKey, 600);
    const totalRaw = await redisGet(totalKey);
    const total = parseInt(totalRaw || "0", 10);
    await alertErrorRate(errors, total, service);
  }
}

// ─── Health Summary (for admin commands) ───

export async function getHealthSummary(): Promise<string> {
  const breakers = getAllBreakerStates();
  const kills = await getKillSwitchStatus();

  let summary = "📊 <b>System Health</b>\n\n";

  // Circuit breakers
  summary += "<b>Circuit Breakers:</b>\n";
  const breakerEntries = Object.entries(breakers);
  if (breakerEntries.length === 0) {
    summary += "  All circuits CLOSED ✅\n";
  } else {
    for (const [svc, state] of breakerEntries) {
      const emoji = state.state === "CLOSED" ? "✅" : state.state === "OPEN" ? "🔴" : "🟡";
      summary += `  ${emoji} ${svc}: ${state.state} (${state.failures} failures)\n`;
    }
  }

  // Kill switches
  summary += "\n<b>Kill Switches:</b>\n";
  let anyKilled = false;
  for (const [svc, status] of Object.entries(kills)) {
    if (status) {
      summary += `  ⛔ ${svc}: KILLED (${status.reason})\n`;
      anyKilled = true;
    }
  }
  if (!anyKilled) summary += "  All services ACTIVE ✅\n";

  return summary;
}

// ─── Metrics Summary ───

export async function getMetricsSummary(): Promise<string> {
  const bucket = Math.floor(Date.now() / 300_000);
  const services = ["gemini", "apify", "serpapi", "twilio", "elevenlabs", "amadeus", "yelp"];
  let summary = "📈 <b>Metrics (last 5 min)</b>\n\n";

  for (const svc of services) {
    const totalRaw = await redisGet(`metrics:${svc}:total:${bucket}`);
    const errorRaw = await redisGet(`metrics:${svc}:errors:${bucket}`);
    const total = parseInt(totalRaw || "0", 10);
    const errors = parseInt(errorRaw || "0", 10);
    if (total > 0) {
      const rate = ((errors / total) * 100).toFixed(1);
      const emoji = errors === 0 ? "✅" : parseFloat(rate) >= 15 ? "🔴" : "🟡";
      summary += `${emoji} ${svc}: ${total} req, ${errors} err (${rate}%)\n`;
    }
  }

  return summary || "📈 No metrics in the last 5 minutes.";
}
