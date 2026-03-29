/**
 * Webhook Dispatcher — fire-and-forget webhook delivery
 *
 * Loads active platform registrations (cached 5 min),
 * signs payloads with HMAC-SHA256, POSTs to webhook URLs.
 */

import crypto from "node:crypto";
import { prisma } from "@payjarvis/database";

interface Registration {
  id: string;
  webhookUrl: string;
  events: string[];
  secret: string;
}

let cachedRegistrations: Registration[] = [];
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadRegistrations(): Promise<Registration[]> {
  const now = Date.now();
  if (cachedRegistrations.length > 0 && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedRegistrations;
  }

  try {
    const rows = await prisma.platformRegistration.findMany({
      where: { isActive: true },
      select: { id: true, webhookUrl: true, events: true, secret: true },
    });
    cachedRegistrations = rows;
    cacheLoadedAt = now;
  } catch (err) {
    console.error("[WebhookDispatcher] Failed to load registrations:", err);
    // Return stale cache if available
  }

  return cachedRegistrations;
}

function signPayload(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function postWebhook(
  url: string,
  body: string,
  signature: string,
  event: string
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PayJarvis-Signature": signature,
        "X-PayJarvis-Event": event,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

/**
 * Dispatch a webhook event to all active registrations subscribed to it.
 * Fire-and-forget: logs errors but never throws.
 */
export async function dispatchWebhook(
  event: string,
  payload: object
): Promise<void> {
  try {
    const registrations = await loadRegistrations();
    const subscribers = registrations.filter((r) =>
      r.events.includes(event)
    );

    if (subscribers.length === 0) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

    for (const reg of subscribers) {
      const signature = signPayload(body, reg.secret);

      // Fire-and-forget per subscriber — 3 attempts with exponential backoff
      (async () => {
        const delays = [0, 2_000, 8_000];
        for (let attempt = 0; attempt < delays.length; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
          const ok = await postWebhook(reg.webhookUrl, body, signature, event);
          if (ok) {
            console.log(`[WebhookDispatcher] ${event} → ${reg.id} delivered (attempt ${attempt + 1})`);
            return;
          }
        }
        console.error(
          `[WebhookDispatcher] Failed to deliver ${event} to ${reg.id} (${reg.webhookUrl}) after 3 attempts`
        );
      })().catch((err) => {
        console.error(`[WebhookDispatcher] Error dispatching ${event} to ${reg.id}:`, err);
      });
    }
  } catch (err) {
    console.error("[WebhookDispatcher] dispatchWebhook error:", err);
  }
}
