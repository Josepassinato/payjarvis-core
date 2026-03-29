/**
 * Web Push Subscription — registers the browser for push notifications from Jarvis.
 *
 * Flow:
 * 1. Request notification permission
 * 2. Get VAPID public key from API
 * 3. Subscribe via service worker
 * 4. Send subscription to API
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

export async function subscribeToPush(authToken: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("[PUSH] Push notifications not supported");
    return false;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.warn("[PUSH] Notification permission denied");
    return false;
  }

  try {
    // Get VAPID public key
    const vapidRes = await fetch(`${API_URL}/api/engagement/push/vapid-key`);
    const { publicKey } = await vapidRes.json();
    if (!publicKey) {
      console.warn("[PUSH] VAPID key not configured on server");
      return false;
    }

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    // Send to server
    const res = await fetch(`${API_URL}/api/engagement/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });

    return res.ok;
  } catch (err) {
    console.error("[PUSH] Subscription failed:", err);
    return false;
  }
}

export async function unsubscribeFromPush(authToken: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    await subscription.unsubscribe();

    await fetch(`${API_URL}/api/engagement/push/unsubscribe`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });

    return true;
  } catch (err) {
    console.error("[PUSH] Unsubscribe failed:", err);
    return false;
  }
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isPushPermissionGranted(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}
