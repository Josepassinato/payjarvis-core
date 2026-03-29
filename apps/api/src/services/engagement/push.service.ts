/**
 * Web Push Notification Service — sends push notifications to PWA subscribers.
 *
 * Uses the web-push npm package with VAPID keys.
 * Subscriptions stored in PushSubscription table.
 */

import webpush from "web-push";
import { prisma } from "@payjarvis/database";

// ─── VAPID Configuration ───

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:admin@payjarvis.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[PUSH] VAPID keys configured");
} else {
  console.warn("[PUSH] VAPID keys not set — web push disabled. Generate with: npx web-push generate-vapid-keys");
}

// ─── Subscribe ───

export async function registerPushSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId, endpoint: subscription.endpoint } },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  });
}

// ─── Unsubscribe ───

export async function removePushSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
}

// ─── Send Push to User ───

export async function sendPushToUser(userId: string, title: string, body: string) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  const payload = JSON.stringify({
    title,
    body: body.substring(0, 200),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: "/chat" },
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      );
    } catch (err: any) {
      // 410 Gone or 404 = subscription expired, clean up
      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }
}

// ─── Get VAPID Public Key (for frontend) ───

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}
