/**
 * Amazon Checkout Service — Real purchases via BrowserBase persistent session
 *
 * Uses BrowserBase Contexts (persisted cookies) + Playwright over CDP.
 * The user logs in once via a live browser link; the bot reuses that session.
 */

import crypto from "node:crypto";
import { prisma } from "@payjarvis/database";
import { getAmazonBaseUrl } from "./domains.js";

const BROWSER_AGENT_URL =
  process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";
const WEB_URL = process.env.WEB_URL ?? "https://www.payjarvis.com";
// MUST match the secret in vault.ts (VAULT_ENCRYPTION_KEY) for token verification
const VAULT_LINK_SECRET = process.env.VAULT_ENCRYPTION_KEY!;

function generateConnectUrl(userId: string): string {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const payload = JSON.stringify({
    userId,
    purpose: "amazon-connect",
    exp: expiresAt.getTime(),
  });
  const signature = crypto
    .createHmac("sha256", VAULT_LINK_SECRET)
    .update(payload)
    .digest("hex");
  const token = Buffer.from(payload).toString("base64url") + "." + signature;
  return `${WEB_URL}/connect/amazon?token=${token}`;
}

export type CheckoutStatus =
  | "NEEDS_AUTH"
  | "READY_TO_CONFIRM"
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "CAPTCHA_REQUIRED"
  | "OUT_OF_STOCK"
  | "PRICE_CHANGED"
  | "CHECKOUT_FAILED";

export interface CheckoutResult {
  status: CheckoutStatus;
  orderId?: string;
  authUrl?: string;
  summary?: {
    title: string;
    price: number;
    address?: string;
    paymentMethod?: string;
    estimatedDelivery?: string;
  };
  newPrice?: number;
  message?: string;
}

export interface OrderResult {
  status: "PLACED" | "FAILED";
  amazonOrderId?: string;
  estimatedDelivery?: string;
  total?: string;
  errorMsg?: string;
}

interface StartCheckoutParams {
  userId: string;
  botId: string;
  asin: string;
  title: string;
  price: number;
  quantity?: number;
}

// ── BrowserBase helpers (calls browser-agent endpoints) ──

async function bbOpenSession(
  bbContextId: string,
  storeUrl: string,
  purpose: string,
): Promise<{
  success: boolean;
  bbSessionId?: string;
  liveUrl?: string;
  loggedIn?: boolean;
  userName?: string;
  error?: string;
}> {
  const res = await fetch(`${BROWSER_AGENT_URL}/bb/open-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbContextId, storeUrl, purpose }),
    signal: AbortSignal.timeout(60_000),
  });
  return (await res.json()) as any;
}

async function bbAction(
  bbSessionId: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  const res = await fetch(`${BROWSER_AGENT_URL}/bb/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbSessionId, action, ...params }),
    signal: AbortSignal.timeout(60_000),
  });
  return (await res.json()) as any;
}

async function bbCloseSession(bbSessionId: string): Promise<void> {
  try {
    await fetch(`${BROWSER_AGENT_URL}/bb/close-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bbSessionId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Non-blocking
  }
}

// ── Resolve telegramId → Prisma userId ──

async function resolveUserId(userIdOrTelegramId: string): Promise<string> {
  // If it looks like a Prisma CUID (starts with 'c' + length), use as-is
  if (userIdOrTelegramId.startsWith("c") && userIdOrTelegramId.length > 20) {
    return userIdOrTelegramId;
  }
  // Otherwise treat as telegramChatId and look up
  const user = await prisma.user.findFirst({
    where: { telegramChatId: userIdOrTelegramId },
    select: { id: true },
  });
  if (user) return user.id;
  // Fallback: try as-is (may fail if FK constraint)
  return userIdOrTelegramId;
}

// ── Store context management ──

async function getOrCreateContext(rawUserId: string): Promise<{
  contextId: string;
  bbContextId: string | null;
  authenticated: boolean;
  resolvedUserId: string;
}> {
  const userId = await resolveUserId(rawUserId);

  // Find existing context
  let ctx = await prisma.storeContext.findFirst({
    where: { userId, store: "amazon" },
  });

  if (!ctx) {
    // Create new store_context record (bbContextId will be created on first use)
    ctx = await prisma.storeContext.create({
      data: {
        userId,
        store: "amazon",
        storeUrl: "https://www.amazon.com",
        storeLabel: "Amazon",
        status: "configured",
      },
    });
  }

  return {
    contextId: ctx.id,
    bbContextId: ctx.bbContextId,
    authenticated: ctx.status === "authenticated" && !!ctx.bbContextId,
    resolvedUserId: userId,
  };
}

async function ensureBBContext(contextId: string): Promise<string> {
  const ctx = await prisma.storeContext.findUnique({ where: { id: contextId } });
  if (ctx?.bbContextId) return ctx.bbContextId;

  // Create BrowserBase context via browser-agent
  const res = await fetch(`${BROWSER_AGENT_URL}/bb/create-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json()) as { success: boolean; bbContextId?: string; error?: string };
  if (!data.success || !data.bbContextId) {
    throw new Error(data.error ?? "Failed to create BrowserBase context");
  }

  await prisma.storeContext.update({
    where: { id: contextId },
    data: { bbContextId: data.bbContextId, updatedAt: new Date() },
  });

  return data.bbContextId;
}

// ═══════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════

/**
 * Check if the user has an authenticated Amazon session
 */
export async function checkSession(userId: string): Promise<{
  connected: boolean;
  authenticated: boolean;
  authUrl?: string;
  message?: string;
}> {
  const { contextId, bbContextId, authenticated, resolvedUserId } = await getOrCreateContext(userId);

  if (authenticated && bbContextId) {
    // Verify session is still valid by opening a quick session
    try {
      const result = await bbOpenSession(bbContextId, "https://www.amazon.com", "verify");
      if (result.success && result.loggedIn) {
        if (result.bbSessionId) await bbCloseSession(result.bbSessionId);
        return { connected: true, authenticated: true };
      }
      // Not logged in — session expired
      if (result.bbSessionId) await bbCloseSession(result.bbSessionId);
      await prisma.storeContext.update({
        where: { id: contextId },
        data: { status: "configured", updatedAt: new Date() },
      });
    } catch {
      // Fall through to needs auth
    }
  }

  // Need authentication — generate a secure connect page URL
  // (works on ALL browsers including Safari, unlike the BrowserBase DevTools URL)
  const connectUrl = generateConnectUrl(resolvedUserId);

  return {
    connected: true,
    authenticated: false,
    authUrl: connectUrl,
    message: "Please log into Amazon using the link above. Once done, try again.",
  };
}

/**
 * Start checkout flow — adds item to cart and proceeds to checkout
 */
export async function startCheckout(
  params: StartCheckoutParams,
): Promise<CheckoutResult> {
  const { userId, botId, asin, title, price, quantity = 1 } = params;

  // 1. Get authenticated context
  const { contextId, bbContextId, authenticated, resolvedUserId } = await getOrCreateContext(userId);

  if (!authenticated || !bbContextId) {
    // Need to authenticate first
    const realBBContextId = await ensureBBContext(contextId);
    return {
      status: "NEEDS_AUTH",
      authUrl: generateConnectUrl(userId),
      message: "Please log into Amazon first using the link above.",
    };
  }

  // Determine Amazon domain
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: { owner: { select: { country: true } } },
  });
  const amazonBase = getAmazonBaseUrl(bot?.owner?.country);

  // 2. Create order record
  const order = await prisma.amazonOrder.create({
    data: { botId, userId, asin, title, price, quantity, status: "CHECKOUT_STARTED" },
  });

  let bbSessionId: string | undefined;

  try {
    // 3. Open BrowserBase session with persisted cookies
    const session = await bbOpenSession(bbContextId, `${amazonBase}/dp/${asin}`, "checkout");

    if (!session.success) {
      await updateOrderStatus(order.id, "FAILED", session.error ?? "Failed to open browser");
      return { status: "CHECKOUT_FAILED", orderId: order.id, message: session.error };
    }

    bbSessionId = session.bbSessionId;

    // 4. Verify we're logged in
    if (!session.loggedIn) {
      await prisma.storeContext.update({
        where: { id: contextId },
        data: { status: "configured", updatedAt: new Date() },
      });
      if (bbSessionId) await bbCloseSession(bbSessionId);
      return {
        status: "NEEDS_AUTH",
        orderId: order.id,
        authUrl: generateConnectUrl(userId),
        message: "Amazon session expired. Please log in again.",
      };
    }

    // 5. Add to cart
    const addResult = await bbAction(bbSessionId!, "add_to_cart", { asin, quantity });
    if (!addResult.success) {
      await updateOrderStatus(order.id, "FAILED", addResult.error ?? "Failed to add to cart");
      return { status: "CHECKOUT_FAILED", orderId: order.id, message: addResult.error };
    }

    // 6. Proceed to checkout
    const checkoutResult = await bbAction(bbSessionId!, "proceed_to_checkout", {});
    if (!checkoutResult.success) {
      await updateOrderStatus(order.id, "FAILED", checkoutResult.error ?? "Failed to reach checkout");
      return { status: "CHECKOUT_FAILED", orderId: order.id, message: checkoutResult.error };
    }

    // 7. Extract summary
    const summary = checkoutResult.data?.summary ?? { title, price };

    // Check price change
    if (summary.price && Math.abs(summary.price - price) > 0.5) {
      return {
        status: "PRICE_CHANGED",
        orderId: order.id,
        newPrice: summary.price,
        summary,
        message: `Price changed from $${price.toFixed(2)} to $${summary.price.toFixed(2)}.`,
      };
    }

    // Don't close session — keep it for confirmOrder
    return {
      status: "READY_TO_CONFIRM",
      orderId: order.id,
      summary,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Checkout failed";
    await updateOrderStatus(order.id, "FAILED", errorMsg);
    if (bbSessionId) await bbCloseSession(bbSessionId);
    return { status: "CHECKOUT_FAILED", orderId: order.id, message: errorMsg };
  }
}

/**
 * Confirm and place the order
 */
export async function confirmOrder(
  orderId: string,
  userId: string,
): Promise<OrderResult> {
  const order = await prisma.amazonOrder.findFirst({
    where: { id: orderId, userId },
  });

  if (!order || order.status !== "CHECKOUT_STARTED") {
    return { status: "FAILED", errorMsg: "Order not found or already processed" };
  }

  const { bbContextId } = await getOrCreateContext(userId);
  if (!bbContextId) {
    return { status: "FAILED", errorMsg: "No Amazon session available" };
  }

  const bot = await prisma.bot.findUnique({
    where: { id: order.botId },
    include: { owner: { select: { country: true } } },
  });
  const amazonBase = getAmazonBaseUrl(bot?.owner?.country);

  let bbSessionId: string | undefined;

  try {
    // Open session at checkout page
    const session = await bbOpenSession(
      bbContextId,
      `${amazonBase}/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1`,
      "confirm",
    );

    if (!session.success || !session.loggedIn) {
      await updateOrderStatus(orderId, "FAILED", "Session expired");
      return { status: "FAILED", errorMsg: "Amazon session expired. Please reconnect." };
    }

    bbSessionId = session.bbSessionId;

    // Place the order
    const placeResult = await bbAction(bbSessionId!, "place_order", {});

    if (!placeResult.success) {
      await updateOrderStatus(orderId, "FAILED", placeResult.error ?? "Failed to place order");
      return { status: "FAILED", errorMsg: placeResult.error };
    }

    const amazonOrderId = placeResult.data?.amazonOrderId ?? null;
    const estimatedDelivery = placeResult.data?.estimatedDelivery ?? null;
    const total = placeResult.data?.total ?? null;

    if (amazonOrderId || placeResult.data?.confirmed) {
      await prisma.amazonOrder.update({
        where: { id: orderId },
        data: { status: "PLACED", amazonOrderId, updatedAt: new Date() },
      });

      // Update last used
      await prisma.storeContext.updateMany({
        where: { userId, store: "amazon" },
        data: { lastUsedAt: new Date() },
      });

      return {
        status: "PLACED",
        amazonOrderId: amazonOrderId ?? undefined,
        estimatedDelivery: estimatedDelivery ?? undefined,
        total: total ?? undefined,
      };
    }

    await updateOrderStatus(orderId, "FAILED", "Order confirmation not detected on page");
    return {
      status: "FAILED",
      errorMsg: "Could not confirm order was placed. Check your Amazon account.",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Order placement failed";
    await updateOrderStatus(orderId, "FAILED", errorMsg);
    return { status: "FAILED", errorMsg };
  } finally {
    if (bbSessionId) await bbCloseSession(bbSessionId);
  }
}

/**
 * Get order status
 */
export async function getOrderStatus(orderId: string) {
  return prisma.amazonOrder.findUnique({ where: { id: orderId } });
}

// ── Helpers ────────────────────────────────────────────

async function updateOrderStatus(
  orderId: string,
  status: string,
  errorMsg?: string | null,
) {
  await prisma.amazonOrder.update({
    where: { id: orderId },
    data: { status, errorMsg, updatedAt: new Date() },
  });
}
