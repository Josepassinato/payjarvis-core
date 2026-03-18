/**
 * Amazon Checkout Service — Real purchases via BrowserBase persistent session
 *
 * Uses BrowserBase Contexts (persisted cookies) + Playwright over CDP.
 * The user logs in once via a live browser link; the bot reuses that session.
 */

import crypto from "node:crypto";
import { prisma, Prisma } from "@payjarvis/database";
import { getAmazonBaseUrl } from "./domains.js";

const BROWSER_AGENT_URL =
  process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";
const WEB_URL = process.env.WEB_URL ?? "https://www.payjarvis.com";
// MUST match the secret in vault.ts (VAULT_ENCRYPTION_KEY) for token verification
const VAULT_LINK_SECRET = process.env.VAULT_ENCRYPTION_KEY!;

function generateConnectUrl(userId: string): string {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes
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

  // Check authentication: store_contexts status OR vault session (legacy)
  let isAuthenticated = ctx.status === "authenticated";
  if (!isAuthenticated) {
    // Fallback: check if vault has a valid session (login via email/password flow)
    try {
      const vaultSession = await prisma.userAccountVault.findFirst({
        where: { userId, provider: "amazon", isValid: true },
        select: { isValid: true },
      });
      if (vaultSession?.isValid) {
        console.log(`[AMAZON-CHECKOUT] getOrCreateContext: Vault session is valid, syncing store_contexts`);
        isAuthenticated = true;
        // Sync: mark store_contexts as authenticated too
        await prisma.storeContext.update({
          where: { id: ctx.id },
          data: { status: "authenticated", authenticatedAt: new Date(), updatedAt: new Date() },
        });
      }
    } catch {
      // Non-blocking — vault table may not exist for all users
    }
  }

  return {
    contextId: ctx.id,
    bbContextId: ctx.bbContextId,
    authenticated: isAuthenticated,
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
  console.log(`[AMAZON-CHECKOUT] checkSession: userId=${userId}`);
  const { contextId, bbContextId, authenticated, resolvedUserId } = await getOrCreateContext(userId);
  console.log(`[AMAZON-CHECKOUT] checkSession: contextId=${contextId}, bbContextId=${bbContextId ?? 'null'}, authenticated=${authenticated}`);

  if (authenticated) {
    // Check if vault has valid cookies — if yes, user is authenticated regardless of BB context
    let vaultValid = false;
    try {
      const vaultSession = await prisma.userAccountVault.findFirst({
        where: { userId: resolvedUserId, provider: "amazon", isValid: true },
        select: { isValid: true },
      });
      vaultValid = !!vaultSession?.isValid;
    } catch { /* vault table may not exist */ }

    if (vaultValid) {
      console.log(`[AMAZON-CHECKOUT] checkSession: Vault session is valid — user is authenticated`);
      return { connected: true, authenticated: true };
    }

    if (bbContextId) {
      console.log(`[AMAZON-CHECKOUT] checkSession: No vault session, verifying via BB context...`);
      // Verify session is still valid by opening a quick session
      try {
        const result = await bbOpenSession(bbContextId, "https://www.amazon.com", "verify");
        if (result.success && result.loggedIn) {
          console.log(`[AMAZON-CHECKOUT] checkSession: BB session still valid, user is logged in`);
          if (result.bbSessionId) await bbCloseSession(result.bbSessionId);
          return { connected: true, authenticated: true };
        }
        // Not logged in — session expired
        console.log(`[AMAZON-CHECKOUT] checkSession: BB session expired, marking as configured`);
        if (result.bbSessionId) await bbCloseSession(result.bbSessionId);
        await prisma.storeContext.update({
          where: { id: contextId },
          data: { status: "configured", updatedAt: new Date() },
        });
      } catch (err) {
        console.error(`[AMAZON-CHECKOUT] checkSession: BB verify error — ${err instanceof Error ? err.message : err}`);
        // Fall through to needs auth
      }
    } else {
      // Authenticated store_contexts but no vault and no BB context — shouldn't happen
      console.log(`[AMAZON-CHECKOUT] checkSession: Authenticated in DB but no vault/BB — stale, resetting`);
      await prisma.storeContext.update({
        where: { id: contextId },
        data: { status: "configured", updatedAt: new Date() },
      });
    }
  }

  // Need authentication — generate a secure connect page URL
  const connectUrl = generateConnectUrl(resolvedUserId);
  console.log(`[AMAZON-CHECKOUT] checkSession: Login required, authUrl generated for userId=${resolvedUserId}`);

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
  console.log(`[AMAZON-CHECKOUT] startCheckout: userId=${userId}, asin=${asin}, title="${title}", price=${price}, qty=${quantity}`);

  // 1. Get authenticated context
  const { contextId, bbContextId, authenticated, resolvedUserId } = await getOrCreateContext(userId);
  console.log(`[AMAZON-CHECKOUT] startCheckout: contextId=${contextId}, authenticated=${authenticated}`);

  if (!authenticated || !bbContextId) {
    // Need to authenticate first
    console.log(`[AMAZON-CHECKOUT] startCheckout: Not authenticated, creating BB context...`);
    const realBBContextId = await ensureBBContext(contextId);
    console.log(`[AMAZON-CHECKOUT] startCheckout: NEEDS_AUTH, bbContextId=${realBBContextId}`);

    // Save pending product so we can recover after login
    const pendingProduct = { asin, name: title, price, url: `https://www.amazon.com/dp/${asin}` };
    await prisma.storeContext.update({
      where: { id: contextId },
      data: { pendingProduct: pendingProduct as any, updatedAt: new Date() },
    });
    console.log(`[AMAZON-CHECKOUT] Saved pending product: ${JSON.stringify(pendingProduct)}`);

    return {
      status: "NEEDS_AUTH",
      authUrl: generateConnectUrl(userId),
      message: "Please log into Amazon first using the link above.",
    };
  }

  // Check for recovered pending product
  const ctx = await prisma.storeContext.findFirst({ where: { userId: resolvedUserId, store: "amazon" } });
  if (ctx?.pendingProduct) {
    console.log(`[AMAZON-CHECKOUT] Recovered pending product: ${JSON.stringify(ctx.pendingProduct)}`);
    // Clear pending product after recovery
    await prisma.storeContext.update({
      where: { id: contextId },
      data: { pendingProduct: Prisma.DbNull, updatedAt: new Date() },
    });
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
  console.log(`[AMAZON-CHECKOUT] startCheckout: Order created, orderId=${order.id}`);

  let bbSessionId: string | undefined;

  try {
    // 2b. Ensure BB Context has cookies from vault (if vault-authenticated but BB empty)
    try {
      const vaultSession = await prisma.userAccountVault.findFirst({
        where: { userId: resolvedUserId, provider: "amazon", isValid: true },
        select: { cookiesEnc: true },
      });
      if (vaultSession?.cookiesEnc) {
        // Decrypt cookies and inject into BB Context
        const { decryptCookies } = await import("../vault/crypto.js");
        const cookies = decryptCookies(vaultSession.cookiesEnc) as any[];
        if (Array.isArray(cookies) && cookies.length > 0) {
          console.log(`[AMAZON-CHECKOUT] startCheckout: Injecting ${cookies.length} vault cookies into BB context ${bbContextId.slice(0, 8)}`);
          const injectRes = await fetch(`${BROWSER_AGENT_URL}/bb/inject-cookies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bbContextId, cookies }),
            signal: AbortSignal.timeout(90_000),
          });
          const injectData = (await injectRes.json()) as { success: boolean; loggedIn?: boolean; error?: string };
          console.log(`[AMAZON-CHECKOUT] startCheckout: Cookie injection result — success=${injectData.success}, loggedIn=${injectData.loggedIn}`);
        }
      }
    } catch (err) {
      console.error(`[AMAZON-CHECKOUT] startCheckout: Cookie injection error (non-blocking) — ${(err as Error).message}`);
      // Non-blocking — continue with checkout attempt anyway
    }

    // 3. Open BrowserBase session with persisted cookies
    console.log(`[AMAZON-CHECKOUT] startCheckout: Opening BB session, navigating to ${amazonBase}/dp/${asin}`);
    const session = await bbOpenSession(bbContextId, `${amazonBase}/dp/${asin}`, "checkout");

    if (!session.success) {
      console.error(`[AMAZON-CHECKOUT] startCheckout: Failed to open session — ${session.error}`);
      await updateOrderStatus(order.id, "FAILED", session.error ?? "Failed to open browser");
      return { status: "CHECKOUT_FAILED", orderId: order.id, message: session.error };
    }

    bbSessionId = session.bbSessionId;
    console.log(`[AMAZON-CHECKOUT] startCheckout: Session opened, bbSessionId=${bbSessionId?.slice(0, 8)}, loggedIn=${session.loggedIn}`);

    // 4. Verify we're logged in
    if (!session.loggedIn) {
      console.log(`[AMAZON-CHECKOUT] startCheckout: Not logged in, session expired`);
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
    console.log(`[AMAZON-CHECKOUT] startCheckout: Adding to cart — asin=${asin}, qty=${quantity}`);
    const addResult = await bbAction(bbSessionId!, "add_to_cart", { asin, quantity });
    console.log(`[AMAZON-CHECKOUT] startCheckout: Add to cart result=${JSON.stringify(addResult)}`);
    if (!addResult.success) {
      await updateOrderStatus(order.id, "FAILED", addResult.error ?? "Failed to add to cart");
      return { status: "CHECKOUT_FAILED", orderId: order.id, message: addResult.error };
    }

    // 6. Proceed to checkout
    console.log(`[AMAZON-CHECKOUT] startCheckout: Proceeding to checkout...`);
    const checkoutResult = await bbAction(bbSessionId!, "proceed_to_checkout", {});
    console.log(`[AMAZON-CHECKOUT] startCheckout: Checkout result=${JSON.stringify(checkoutResult)}`);
    if (!checkoutResult.success) {
      await updateOrderStatus(order.id, "FAILED", checkoutResult.error ?? "Failed to reach checkout");
      return { status: "CHECKOUT_FAILED", orderId: order.id, message: checkoutResult.error };
    }

    // 7. Extract summary
    const summary = checkoutResult.data?.summary ?? { title, price };
    console.log(`[AMAZON-CHECKOUT] startCheckout: Checkout summary=${JSON.stringify(summary)}`);

    // Check price change
    if (summary.price && Math.abs(summary.price - price) > 0.5) {
      console.log(`[AMAZON-CHECKOUT] startCheckout: PRICE_CHANGED from $${price} to $${summary.price}`);
      return {
        status: "PRICE_CHANGED",
        orderId: order.id,
        newPrice: summary.price,
        summary,
        message: `Price changed from $${price.toFixed(2)} to $${summary.price.toFixed(2)}.`,
      };
    }

    // Don't close session — keep it for confirmOrder
    console.log(`[AMAZON-CHECKOUT] startCheckout: READY_TO_CONFIRM, orderId=${order.id}`);
    return {
      status: "READY_TO_CONFIRM",
      orderId: order.id,
      summary,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Checkout failed";
    console.error(`[AMAZON-CHECKOUT] startCheckout: FAILED — ${errorMsg}`);
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
  console.log(`[AMAZON-CHECKOUT] confirmOrder: orderId=${orderId}, userId=${userId}`);
  const order = await prisma.amazonOrder.findFirst({
    where: { id: orderId, userId },
  });

  if (!order || order.status !== "CHECKOUT_STARTED") {
    console.log(`[AMAZON-CHECKOUT] confirmOrder: Order not found or already processed`);
    return { status: "FAILED", errorMsg: "Order not found or already processed" };
  }

  const { bbContextId } = await getOrCreateContext(userId);
  if (!bbContextId) {
    console.log(`[AMAZON-CHECKOUT] confirmOrder: No BB context available`);
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
    console.log(`[AMAZON-CHECKOUT] confirmOrder: Opening session at checkout page...`);
    const session = await bbOpenSession(
      bbContextId,
      `${amazonBase}/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1`,
      "confirm",
    );

    if (!session.success || !session.loggedIn) {
      console.log(`[AMAZON-CHECKOUT] confirmOrder: Session expired or not logged in`);
      await updateOrderStatus(orderId, "FAILED", "Session expired");
      return { status: "FAILED", errorMsg: "Amazon session expired. Please reconnect." };
    }

    bbSessionId = session.bbSessionId;
    console.log(`[AMAZON-CHECKOUT] confirmOrder: Placing order, bbSessionId=${bbSessionId?.slice(0, 8)}`);

    // Place the order
    const placeResult = await bbAction(bbSessionId!, "place_order", {});
    console.log(`[AMAZON-CHECKOUT] confirmOrder: Place result=${JSON.stringify(placeResult)}`);

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

      console.log(`[AMAZON-CHECKOUT] confirmOrder: Order PLACED, amazonOrderId=${amazonOrderId}, total=${total}`);
      return {
        status: "PLACED",
        amazonOrderId: amazonOrderId ?? undefined,
        estimatedDelivery: estimatedDelivery ?? undefined,
        total: total ?? undefined,
      };
    }

    console.log(`[AMAZON-CHECKOUT] confirmOrder: Order confirmation not detected on page`);
    await updateOrderStatus(orderId, "FAILED", "Order confirmation not detected on page");
    return {
      status: "FAILED",
      errorMsg: "Could not confirm order was placed. Check your Amazon account.",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Order placement failed";
    console.error(`[AMAZON-CHECKOUT] confirmOrder: FAILED — ${errorMsg}`);
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
