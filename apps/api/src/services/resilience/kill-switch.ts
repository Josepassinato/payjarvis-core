/**
 * Kill Switch — instantly disable services via Redis.
 *
 * Supports per-service and global kills. State lives in Redis for
 * multi-process coordination. Checks are O(1) Redis GETs.
 *
 * Usage:
 *   import { isKilled, killService, reviveService } from "./kill-switch.js";
 *   if (await isKilled("whatsapp")) return; // service disabled
 *
 * Admin commands (via Telegram admin bot or API):
 *   killService("whatsapp")   → disables WhatsApp processing
 *   killService("all")        → kills everything
 *   reviveService("whatsapp") → re-enables WhatsApp
 *   getKillSwitchStatus()     → returns all active kills
 */

import { redisGet, redisSet, redisDel, redisExists } from "../redis.js";

const KEY_PREFIX = "killswitch";

// ─── Core ───

export async function isKilled(service: string): Promise<boolean> {
  // Check global kill first
  const globalKill = await redisExists(`${KEY_PREFIX}:all`);
  if (globalKill) return true;

  return redisExists(`${KEY_PREFIX}:${service}`);
}

export async function killService(service: string, reason?: string, ttlSeconds?: number): Promise<void> {
  const value = JSON.stringify({
    killedAt: new Date().toISOString(),
    reason: reason || "manual",
  });

  await redisSet(`${KEY_PREFIX}:${service}`, value, ttlSeconds);
  console.error(`[KILL-SWITCH] ⛔ ${service} KILLED${reason ? `: ${reason}` : ""}${ttlSeconds ? ` (TTL: ${ttlSeconds}s)` : ""}`);
}

export async function reviveService(service: string): Promise<void> {
  await redisDel(`${KEY_PREFIX}:${service}`);
  console.log(`[KILL-SWITCH] ✅ ${service} REVIVED`);
}

// ─── Status ───

export async function getKillSwitchStatus(): Promise<Record<string, { killedAt: string; reason: string } | null>> {
  const services = ["all", "whatsapp", "telegram", "voice", "search", "browserbase", "payments", "engagement"];
  const result: Record<string, { killedAt: string; reason: string } | null> = {};

  for (const svc of services) {
    const raw = await redisGet(`${KEY_PREFIX}:${svc}`);
    result[svc] = raw ? JSON.parse(raw) : null;
  }

  return result;
}

// ─── Auto-Kill Rules ───

// Track rate limit violations — if 3+ users hit rate limits in 5min, auto-kill
const rateLimitViolations = new Map<string, number>();

export async function reportRateLimitViolation(service: string): Promise<void> {
  const key = `${service}:${Math.floor(Date.now() / 300_000)}`; // 5-min bucket
  const count = (rateLimitViolations.get(key) || 0) + 1;
  rateLimitViolations.set(key, count);

  if (count >= 3) {
    await killService(service, `auto-kill: ${count} rate limit violations in 5min`, 300); // 5min TTL
    rateLimitViolations.delete(key);
  }
}
