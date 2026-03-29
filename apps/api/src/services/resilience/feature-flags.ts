/**
 * Feature Flags — Redis-based, supports canary (user-specific) rollout.
 *
 * Flags are stored in Redis as JSON. Each flag has:
 * - enabled: boolean (global on/off)
 * - canaryUserIds: string[] (users who get the feature even if not globally enabled)
 * - rolloutPercent: number (0-100, gradual rollout based on hash of userId)
 *
 * Usage:
 *   if (await isFeatureEnabled("instagram_integration", userId)) { ... }
 *
 * Admin:
 *   setFeatureFlag("instagram_integration", { enabled: false, canaryUserIds: ["jose_id"] })
 *   getAllFlags()
 */

import { redisGet, redisSet, redisDel } from "../redis.js";

const KEY_PREFIX = "ff";

interface FeatureFlag {
  enabled: boolean;
  canaryUserIds: string[];
  rolloutPercent: number;
  description?: string;
  updatedAt: string;
}

const DEFAULTS: Record<string, FeatureFlag> = {
  morning_briefing: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Morning briefing cron", updatedAt: "" },
  reengagement: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Reengagement messages", updatedAt: "" },
  weekly_report: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Weekly summary report", updatedAt: "" },
  smart_tips: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Smart feature tips", updatedAt: "" },
  voice_calls: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Twilio voice calls", updatedAt: "" },
  price_alerts: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Price drop alerts", updatedAt: "" },
  gamification: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Streaks/achievements", updatedAt: "" },
  push_notifications: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Web push via VAPID", updatedAt: "" },
  manage_settings: { enabled: true, canaryUserIds: [], rolloutPercent: 100, description: "Settings via conversation", updatedAt: "" },
};

// ─── Core ───

export async function isFeatureEnabled(flag: string, userId?: string): Promise<boolean> {
  const raw = await redisGet(`${KEY_PREFIX}:${flag}`);
  const ff: FeatureFlag = raw ? JSON.parse(raw) : DEFAULTS[flag] || { enabled: true, canaryUserIds: [], rolloutPercent: 100 };

  // Canary user always gets it
  if (userId && ff.canaryUserIds.includes(userId)) return true;

  // Global off
  if (!ff.enabled) return false;

  // Rollout percent (deterministic hash)
  if (ff.rolloutPercent < 100 && userId) {
    const hash = simpleHash(userId + flag);
    return (hash % 100) < ff.rolloutPercent;
  }

  return ff.enabled;
}

export async function setFeatureFlag(flag: string, update: Partial<FeatureFlag>): Promise<void> {
  const raw = await redisGet(`${KEY_PREFIX}:${flag}`);
  const current: FeatureFlag = raw
    ? JSON.parse(raw)
    : DEFAULTS[flag] || { enabled: true, canaryUserIds: [], rolloutPercent: 100, updatedAt: "" };

  const merged = { ...current, ...update, updatedAt: new Date().toISOString() };
  await redisSet(`${KEY_PREFIX}:${flag}`, JSON.stringify(merged));
  console.log(`[FEATURE-FLAG] ${flag} updated:`, JSON.stringify(merged));
}

export async function deleteFeatureFlag(flag: string): Promise<void> {
  await redisDel(`${KEY_PREFIX}:${flag}`);
}

export async function getAllFlags(): Promise<Record<string, FeatureFlag>> {
  const result: Record<string, FeatureFlag> = {};

  for (const flag of Object.keys(DEFAULTS)) {
    const raw = await redisGet(`${KEY_PREFIX}:${flag}`);
    result[flag] = raw ? JSON.parse(raw) : { ...DEFAULTS[flag], updatedAt: "default" };
  }

  return result;
}

// ─── Deterministic hash for rollout ───

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
