import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 5) return null;
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

// Connect silently — in dev, Redis may not be available
redis.connect().catch(() => {
  console.warn("[Redis] Not available — falling back to in-memory stores");
});

// In-memory fallback when Redis is not connected
const memoryStore = new Map<string, { value: string; expiresAt: number | null }>();

function isConnected(): boolean {
  return redis.status === "ready";
}

export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (isConnected()) {
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, value);
    } else {
      await redis.set(key, value);
    }
  } else {
    memoryStore.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
}

export async function redisGet(key: string): Promise<string | null> {
  if (isConnected()) {
    return redis.get(key);
  }
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

export async function redisDel(key: string): Promise<void> {
  if (isConnected()) {
    await redis.del(key);
  } else {
    memoryStore.delete(key);
  }
}

export async function redisPublish(channel: string, message: string): Promise<void> {
  if (isConnected()) {
    await redis.publish(channel, message);
  }
}

export async function redisExists(key: string): Promise<boolean> {
  if (isConnected()) {
    return (await redis.exists(key)) === 1;
  }
  const entry = memoryStore.get(key);
  if (!entry) return false;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return false;
  }
  return true;
}
