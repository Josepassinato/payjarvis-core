/**
 * Generic Store Checkout Service — AI-powered checkout for any US store
 *
 * Orchestrates the generic checkout flow:
 * 1. Start: navigate to product URL, extract info
 * 2. Add to cart: AI clicks "Add to Cart" on any store
 * 3. Checkout: navigate to checkout, fill shipping/payment
 * 4. Screenshot: capture checkout page for user confirmation
 * 5. Confirm: place order after user approves
 *
 * SAFETY: Never executes purchase without explicit user confirmation.
 * Price divergence >10% = automatic abort.
 */

import { prisma } from "@payjarvis/database";

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";

// ── Types ──────────────────────────────────────────────

export interface GenericCheckoutStartParams {
  userId: string;
  productUrl: string;
  productName: string;
  price: number;
  store: string;
  size?: string;
  color?: string;
  quantity?: number;
}

export interface GenericCheckoutResult {
  status: "STARTED" | "CART_ADDED" | "READY_TO_CONFIRM" | "PLACED" | "FAILED" | "PRICE_CHANGED" | "NEEDS_LOGIN" | "CANCELLED";
  orderId?: string;
  bbSessionId?: string;
  bbContextId?: string;
  productInfo?: any;
  summary?: any;
  screenshotUrl?: string;
  orderNumber?: string;
  estimatedDelivery?: string;
  total?: string;
  message?: string;
  error?: string;
}

// ── Resolve userId (same pattern as Amazon) ────────────

async function resolveUserId(userIdOrTelegramId: string): Promise<string> {
  // Clean WhatsApp prefix
  const cleanId = userIdOrTelegramId.replace("whatsapp:", "");

  // If Prisma CUID, use as-is
  if (cleanId.startsWith("c") && cleanId.length > 20) return cleanId;

  // Look up by telegramChatId or phone
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { telegramChatId: cleanId },
        { phone: cleanId },
        { phone: cleanId.replace("+", "") },
      ],
    },
    select: { id: true },
  });
  return user?.id ?? cleanId;
}

// ── Get Butler profile for shipping/payment autofill ──

async function getButlerProfile(userId: string): Promise<{
  fullName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
} | null> {
  try {
    const profile = await prisma.$queryRaw<Array<{
      full_name: string | null;
      email: string | null;
      address_enc: string | null;
      phone_enc: string | null;
    }>>`
      SELECT full_name, email, address_enc, phone_enc
      FROM "butlerProfile"
      WHERE "userId" = ${userId}
      LIMIT 1
    `;

    if (!profile.length || !profile[0].full_name) return null;

    const p = profile[0];
    // Decrypt address if encrypted
    let address: string | undefined;
    let city: string | undefined;
    let state: string | undefined;
    let zip: string | undefined;
    let phone: string | undefined;

    if (p.address_enc) {
      try {
        const { decryptPII } = await import("./vault/crypto.js");
        const decrypted = decryptPII(p.address_enc);
        // Parse "123 Main St, Coconut Creek, FL 33073" format
        const parts = decrypted.split(",").map((s: string) => s.trim());
        address = parts[0];
        city = parts[1];
        const stateZip = parts[2]?.split(" ");
        state = stateZip?.[0];
        zip = stateZip?.[1];
      } catch { /* address not parseable */ }
    }

    if (p.phone_enc) {
      try {
        const { decryptPII } = await import("./vault/crypto.js");
        phone = decryptPII(p.phone_enc);
      } catch { /* phone not decryptable */ }
    }

    return {
      fullName: p.full_name ?? undefined,
      email: p.email ?? undefined,
      address,
      city,
      state,
      zip,
      phone,
    };
  } catch {
    return null;
  }
}

// ── Browser Agent helpers ──────────────────────────────

async function genericStart(
  productUrl: string,
  store: string,
  bbContextId?: string,
): Promise<{
  success: boolean;
  bbSessionId?: string;
  bbContextId?: string;
  liveUrl?: string;
  productInfo?: any;
  error?: string;
}> {
  const res = await fetch(`${BROWSER_AGENT_URL}/generic/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productUrl, store, bbContextId }),
    signal: AbortSignal.timeout(60_000),
  });
  return (await res.json()) as any;
}

async function genericAddToCart(
  bbSessionId: string,
  options: { size?: string; color?: string; quantity?: number },
): Promise<{ success: boolean; data?: any; error?: string }> {
  const res = await fetch(`${BROWSER_AGENT_URL}/generic/add-to-cart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbSessionId, ...options }),
    signal: AbortSignal.timeout(60_000),
  });
  return (await res.json()) as any;
}

async function genericCheckout(
  bbSessionId: string,
  shipping?: any,
  payment?: any,
  email?: string,
): Promise<{ success: boolean; pageState?: any; error?: string; message?: string }> {
  const res = await fetch(`${BROWSER_AGENT_URL}/generic/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbSessionId, shipping, payment, email }),
    signal: AbortSignal.timeout(90_000),
  });
  return (await res.json()) as any;
}

async function genericScreenshot(
  bbSessionId: string,
): Promise<{ success: boolean; summary?: any; screenshotPath?: string; screenshotId?: string; error?: string }> {
  const res = await fetch(`${BROWSER_AGENT_URL}/generic/screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbSessionId }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json()) as any;
}

async function genericPlaceOrder(
  bbSessionId: string,
  expectedTotal: number,
): Promise<{ success: boolean; data?: any; error?: string; message?: string }> {
  const res = await fetch(`${BROWSER_AGENT_URL}/generic/place-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbSessionId, expectedTotal }),
    signal: AbortSignal.timeout(90_000),
  });
  return (await res.json()) as any;
}

async function genericCancel(bbSessionId: string): Promise<void> {
  try {
    await fetch(`${BROWSER_AGENT_URL}/generic/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bbSessionId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* non-blocking */ }
}

// ═══════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════

/**
 * Start a generic store checkout:
 * 1. Navigate to product URL
 * 2. Add to cart
 * 3. Navigate to checkout
 * 4. Fill shipping/payment from Butler profile
 * 5. Take screenshot for user confirmation
 *
 * Returns READY_TO_CONFIRM with screenshot URL, or error.
 */
export async function startGenericCheckout(
  params: GenericCheckoutStartParams,
): Promise<GenericCheckoutResult> {
  const { userId, productUrl, productName, price, store, size, color, quantity } = params;
  const resolvedUserId = await resolveUserId(userId);

  console.log(`[CHECKOUT][1-START] userId=${resolvedUserId.slice(0, 8)}, store=${store}, product=${productName}, price=$${price}`);

  // Get Butler profile for autofill
  const profile = await getButlerProfile(resolvedUserId);
  console.log(`[CHECKOUT][1-START] Butler profile: ${profile ? `${profile.fullName}, ${profile.city}` : "not found"}`);

  // Step 1: Start — navigate to product URL
  const startResult = await genericStart(productUrl, store);
  if (!startResult.success) {
    console.error(`[CHECKOUT][1-START] Failed: ${startResult.error}`);
    return { status: "FAILED", error: startResult.error };
  }

  const { bbSessionId, bbContextId, productInfo } = startResult;
  console.log(`[CHECKOUT][1-START] Session: ${bbSessionId?.slice(0, 8)}, product: ${productInfo?.productName}, price: $${productInfo?.price}`);

  // Price sanity check
  if (productInfo?.price && Math.abs(productInfo.price - price) / price > 0.10) {
    console.log(`[CHECKOUT][1-START] PRICE_CHANGED: expected=$${price}, actual=$${productInfo.price}`);
    await genericCancel(bbSessionId!);
    return {
      status: "PRICE_CHANGED",
      message: `Price on ${store} is now $${productInfo.price.toFixed(2)} (was $${price.toFixed(2)})`,
      productInfo,
    };
  }

  // Step 2: Add to cart
  console.log(`[CHECKOUT][2-CART] Adding to cart: size=${size || "default"}, color=${color || "default"}, qty=${quantity || 1}`);
  const cartResult = await genericAddToCart(bbSessionId!, { size, color, quantity });
  if (!cartResult.success) {
    console.error(`[CHECKOUT][2-CART] Failed: ${cartResult.error}`);
    await genericCancel(bbSessionId!);
    return { status: "FAILED", error: cartResult.error, bbSessionId };
  }

  // Step 3: Checkout — navigate and fill shipping/payment
  const shipping = profile ? {
    fullName: profile.fullName!,
    address: profile.address || "",
    city: profile.city || "",
    state: profile.state || "",
    zip: profile.zip || "",
    phone: profile.phone,
  } : undefined;

  console.log(`[CHECKOUT][3-SHIPPING] Navigating to checkout, shipping=${shipping ? "from Butler" : "none"}`);
  const checkoutResult = await genericCheckout(
    bbSessionId!,
    shipping,
    undefined, // payment filled at store — user picks method
    profile?.email,
  );

  if (!checkoutResult.success) {
    if (checkoutResult.error === "NEEDS_LOGIN") {
      console.log(`[CHECKOUT][3-SHIPPING] Store requires login — aborting`);
      await genericCancel(bbSessionId!);
      return { status: "NEEDS_LOGIN", message: checkoutResult.message, bbSessionId };
    }
    console.error(`[CHECKOUT][3-SHIPPING] Failed: ${checkoutResult.error}`);
    await genericCancel(bbSessionId!);
    return { status: "FAILED", error: checkoutResult.error, bbSessionId };
  }

  // Step 4: Screenshot for confirmation
  console.log(`[CHECKOUT][5-REVIEW] Taking screenshot for user confirmation...`);
  const screenshotResult = await genericScreenshot(bbSessionId!);
  if (!screenshotResult.success) {
    console.error(`[CHECKOUT][5-REVIEW] Screenshot failed: ${screenshotResult.error}`);
    // Non-blocking — continue without screenshot
  }

  const screenshotUrl = screenshotResult.screenshotId
    ? `${BROWSER_AGENT_URL}/generic/screenshot/${screenshotResult.screenshotId}`
    : undefined;

  console.log(`[CHECKOUT][5-REVIEW] READY_TO_CONFIRM, summary: $${screenshotResult.summary?.total}`);

  return {
    status: "READY_TO_CONFIRM",
    bbSessionId,
    bbContextId,
    productInfo,
    summary: screenshotResult.summary,
    screenshotUrl,
  };
}

/**
 * Confirm and place a generic store order.
 * Called after user reviews the screenshot and confirms.
 */
export async function confirmGenericOrder(
  bbSessionId: string,
  expectedTotal: number,
): Promise<GenericCheckoutResult> {
  console.log(`[CHECKOUT][6-CONFIRM] Placing order, session=${bbSessionId.slice(0, 8)}, expectedTotal=$${expectedTotal}`);

  const result = await genericPlaceOrder(bbSessionId, expectedTotal);

  if (!result.success) {
    if (result.error === "PRICE_CHANGED") {
      console.log(`[CHECKOUT][6-CONFIRM] Price divergence detected — aborting`);
      return { status: "PRICE_CHANGED", message: result.message };
    }
    console.error(`[CHECKOUT][6-CONFIRM] Failed: ${result.error}`);
    return { status: "FAILED", error: result.error };
  }

  console.log(`[CHECKOUT][7-COMPLETE] Order placed: ${result.data?.orderNumber}, total=${result.data?.total}`);

  return {
    status: "PLACED",
    orderNumber: result.data?.orderNumber,
    estimatedDelivery: result.data?.estimatedDelivery,
    total: result.data?.total,
    message: result.data?.confirmationMessage,
  };
}

/**
 * Cancel an in-progress checkout.
 */
export async function cancelGenericCheckout(bbSessionId: string): Promise<void> {
  console.log(`[CHECKOUT][CANCEL] Cancelling session ${bbSessionId.slice(0, 8)}`);
  await genericCancel(bbSessionId);
}
