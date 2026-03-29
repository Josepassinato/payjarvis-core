/**
 * Rate Limiter Middleware — Redis-based per-user rate limiting.
 *
 * Limits:
 *   - 5 messages / 30 seconds
 *   - 15 messages / 5 minutes
 *   - 60 messages / 1 hour
 *
 * Uses sliding window via Redis INCR + TTL.
 * Reports violations to kill-switch auto-kill system.
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { redisIncr, redisGet } from "../services/redis.js";
import { reportRateLimitViolation } from "../services/resilience/kill-switch.js";
import { alertRateLimitAbuse } from "../services/monitoring/telegram-alerts.service.js";

interface RateLimitWindow {
  max: number;
  windowSeconds: number;
  label: string;
}

const WINDOWS: RateLimitWindow[] = [
  { max: 5, windowSeconds: 30, label: "30s" },
  { max: 15, windowSeconds: 300, label: "5min" },
  { max: 60, windowSeconds: 3600, label: "1h" },
];

function getUserId(req: FastifyRequest): string | null {
  // Try different auth contexts
  return (req as any).userId || (req as any).botId || req.ip;
}

export async function rateLimiter(req: FastifyRequest, reply: FastifyReply) {
  // Skip internal/service-to-service calls
  const internalSecret = (req.headers as any)["x-internal-secret"];
  if (internalSecret && internalSecret === process.env.INTERNAL_SECRET) return;

  // Skip localhost/loopback for health checks, smoke tests
  const ip = req.ip;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return;

  const userId = getUserId(req);
  if (!userId) return; // Can't rate limit without identity

  for (const window of WINDOWS) {
    const key = `rl:${userId}:${window.windowSeconds}`;
    const count = await redisIncr(key, window.windowSeconds);

    if (count > window.max) {
      // Report violation
      await reportRateLimitViolation("api").catch(() => {});
      await alertRateLimitAbuse(userId, "api").catch(() => {});

      reply.status(429).send({
        error: "Too many requests",
        retryAfter: window.windowSeconds,
        limit: `${window.max} requests per ${window.label}`,
      });
      return;
    }
  }

  // Add rate limit headers
  const shortKey = `rl:${userId}:30`;
  const shortCount = await redisGet(shortKey);
  reply.header("X-RateLimit-Limit", "5");
  reply.header("X-RateLimit-Remaining", String(Math.max(0, 5 - parseInt(shortCount || "0", 10))));
}

/**
 * Stricter rate limiter for webhook endpoints (WhatsApp, Telegram).
 * 30 messages / minute per phone number.
 */
export async function webhookRateLimiter(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as any;
  const from = body?.From || body?.message?.from?.id || req.ip;
  const key = `rl:wh:${from}:60`;
  const count = await redisIncr(key, 60);

  if (count > 30) {
    await reportRateLimitViolation("webhook").catch(() => {});
    reply.status(429).send({ error: "Too many messages" });
    return;
  }
}
