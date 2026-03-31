import './sentry.js';
import Sentry from './sentry.js';

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import type { RulesEngineRequest, RulesEngineResponse } from "@payjarvis/types";
import { DecisionEngine } from "./services/decision-engine.js";
import { prisma } from "@payjarvis/database";

const app = Fastify({ logger: true });
const engine = new DecisionEngine();

await app.register(cors, { origin: true });

// Sentry error handler
app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  Sentry.captureException(error, {
    extra: { method: request.method, url: request.url },
  });
  app.log.error(error);
  reply.status(error.statusCode ?? 500).send({
    error: error.message || 'Internal Server Error',
  });
});

// ─── Redis setup ──────────────────────────────────────

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let subscriber: Redis | null = null;
let redisReady = false;

try {
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
  subscriber = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
  await redis.connect();
  await subscriber.connect();
  redisReady = true;
  console.log("[Cache] Redis connected");
} catch {
  console.warn("[Cache] Redis not available — running without cache");
  redis = null;
  subscriber = null;
}

// ─── Cache helpers ────────────────────────────────────

const CACHE_PREFIX = "rules:";
const TTL_POLICY = 300;       // 5 minutes
const TTL_TOTALS = 30;        // 30 seconds (spending totals change frequently)
const TTL_TRUST = 60;         // 1 minute

let cacheHits = 0;
let cacheMisses = 0;

async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redisReady || !redis) return null;
  try {
    const raw = await redis.get(CACHE_PREFIX + key);
    if (raw) {
      cacheHits++;
      return JSON.parse(raw) as T;
    }
  } catch { /* ignore */ }
  cacheMisses++;
  return null;
}

async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  if (!redisReady || !redis) return;
  try {
    await redis.setex(CACHE_PREFIX + key, ttl, JSON.stringify(value));
  } catch { /* ignore */ }
}

async function cacheDel(pattern: string): Promise<void> {
  if (!redisReady || !redis) return;
  try {
    const keys = await redis.keys(CACHE_PREFIX + pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Invalidated ${keys.length} key(s) matching ${pattern}`);
    }
  } catch { /* ignore */ }
}

// ─── Pub/Sub: listen for policy invalidation from API ──

if (subscriber && redisReady) {
  subscriber.subscribe("payjarvis:policy:invalidate", (err) => {
    if (err) console.error("[Cache] Failed to subscribe:", err.message);
    else console.log("[Cache] Subscribed to policy invalidation channel");
  });

  subscriber.on("message", async (_channel: string, message: string) => {
    try {
      const { botId } = JSON.parse(message) as { botId: string };
      if (botId) {
        await cacheDel(`policy:${botId}`);
        await cacheDel(`totals:${botId}:*`);
        console.log(`[Cache] Invalidated cache for bot ${botId} (policy update)`);
      }
    } catch { /* ignore malformed messages */ }
  });
}

// ─── Routes ───────────────────────────────────────────

app.get("/health", async () => ({
  status: "ok",
  service: "rules-engine",
  cache: {
    enabled: redisReady,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0
      ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 100)
      : 0,
  },
}));

app.post<{
  Body: RulesEngineRequest;
  Reply: RulesEngineResponse;
}>("/evaluate", async (request) => {
  const req = request.body;

  // ─── Try cache for spending totals ──────────────────
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Cache key includes the minute bucket so totals stay fresh
  const minuteBucket = `${now.getFullYear()}${now.getMonth()}${now.getDate()}${now.getHours()}${Math.floor(now.getMinutes() / 1)}`;
  const totalsKey = `totals:${req.botId}:${minuteBucket}`;

  let totals = await cacheGet<{ daily: number; weekly: number; monthly: number }>(totalsKey);

  if (!totals) {
    const [dailyResult, weeklyResult, monthlyResult] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          botId: req.botId,
          decision: "APPROVED",
          createdAt: { gte: startOfDay },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          botId: req.botId,
          decision: "APPROVED",
          createdAt: { gte: startOfWeek },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          botId: req.botId,
          decision: "APPROVED",
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
    ]);

    totals = {
      daily: dailyResult._sum.amount ?? 0,
      weekly: weeklyResult._sum.amount ?? 0,
      monthly: monthlyResult._sum.amount ?? 0,
    };

    await cacheSet(totalsKey, totals, TTL_TOTALS);
  }

  return engine.evaluate(req, totals);
});

// ─── Start ────────────────────────────────────────────

const port = parseInt(process.env.RULES_ENGINE_PORT ?? "3002", 10);

try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Rules engine listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
