/**
 * Circuit Breaker — protects external service calls.
 *
 * States: CLOSED (normal) → OPEN (blocked after 3 failures) → HALF_OPEN (test one request)
 * Each service has its own breaker. Auto-resets after 60s.
 *
 * Usage:
 *   const cb = getBreaker("apify");
 *   if (!cb.isAllowed()) throw new Error("Circuit open for apify");
 *   try { const result = await callApify(); cb.recordSuccess(); return result; }
 *   catch (err) { cb.recordFailure(); throw err; }
 *
 * Or use the wrapper:
 *   const result = await withCircuitBreaker("apify", () => callApify());
 */

import { redisGet, redisSet, redisIncr, redisDel } from "../redis.js";

// ─── Configuration ───

const FAILURE_THRESHOLD = 3; // failures before opening
const RESET_TIMEOUT_MS = 60_000; // 60 seconds in OPEN state
const HALF_OPEN_MAX = 1; // requests to test in HALF_OPEN

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface BreakerState {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  halfOpenAttempts: number;
}

// In-memory state (fast, per-process)
const breakers = new Map<string, BreakerState>();

function getState(service: string): BreakerState {
  if (!breakers.has(service)) {
    breakers.set(service, {
      state: "CLOSED",
      failures: 0,
      lastFailure: 0,
      halfOpenAttempts: 0,
    });
  }
  return breakers.get(service)!;
}

// ─── Core API ───

export function getBreaker(service: string) {
  return {
    isAllowed(): boolean {
      const b = getState(service);

      if (b.state === "CLOSED") return true;

      if (b.state === "OPEN") {
        // Check if timeout elapsed → transition to HALF_OPEN
        if (Date.now() - b.lastFailure >= RESET_TIMEOUT_MS) {
          b.state = "HALF_OPEN";
          b.halfOpenAttempts = 0;
          console.log(`[CIRCUIT-BREAKER] ${service}: OPEN → HALF_OPEN`);
          return true;
        }
        return false;
      }

      // HALF_OPEN — allow limited requests
      if (b.halfOpenAttempts < HALF_OPEN_MAX) {
        return true;
      }
      return false;
    },

    recordSuccess() {
      const b = getState(service);
      if (b.state === "HALF_OPEN") {
        console.log(`[CIRCUIT-BREAKER] ${service}: HALF_OPEN → CLOSED (success)`);
      }
      b.state = "CLOSED";
      b.failures = 0;
      b.halfOpenAttempts = 0;
      // Publish recovery to Redis for monitoring
      redisSet(`cb:${service}:state`, "CLOSED", 300).catch(() => {});
    },

    recordFailure() {
      const b = getState(service);
      b.failures++;
      b.lastFailure = Date.now();

      if (b.state === "HALF_OPEN") {
        b.halfOpenAttempts++;
        b.state = "OPEN";
        console.log(`[CIRCUIT-BREAKER] ${service}: HALF_OPEN → OPEN (test failed)`);
      } else if (b.failures >= FAILURE_THRESHOLD) {
        b.state = "OPEN";
        console.error(`[CIRCUIT-BREAKER] ${service}: CLOSED → OPEN (${b.failures} failures)`);
      }

      redisSet(`cb:${service}:state`, b.state, 300).catch(() => {});
      redisSet(`cb:${service}:failures`, String(b.failures), 300).catch(() => {});
    },

    getState(): BreakerState {
      return { ...getState(service) };
    },
  };
}

// ─── Convenience Wrapper ───

export async function withCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  const cb = getBreaker(service);

  if (!cb.isAllowed()) {
    console.warn(`[CIRCUIT-BREAKER] ${service}: circuit OPEN, request blocked`);
    if (fallback) return fallback();
    throw new Error(`Service ${service} is temporarily unavailable (circuit open)`);
  }

  try {
    const result = await fn();
    cb.recordSuccess();
    return result;
  } catch (err) {
    cb.recordFailure();
    if (fallback) return fallback();
    throw err;
  }
}

// ─── Status (for admin/monitoring) ───

export function getAllBreakerStates(): Record<string, BreakerState> {
  const result: Record<string, BreakerState> = {};
  for (const [service, state] of breakers) {
    result[service] = { ...state };
  }
  return result;
}

// ─── Known Services ───

export const SERVICES = [
  "apify",
  "serpapi",
  "gemini",
  "elevenlabs",
  "twilio",
  "amadeus",
  "yelp",
  "ticketmaster",
  "browserbase",
  "stripe",
  "openweather",
] as const;

export type ServiceName = (typeof SERVICES)[number];
