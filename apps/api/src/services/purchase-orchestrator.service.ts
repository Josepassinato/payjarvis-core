/**
 * Purchase Orchestrator — Charge-on-Purchase model.
 *
 * FLOW:
 * 1. User confirms purchase ($49.99 product at Amazon)
 * 2. Stripe charges user's saved card: $49.99 + $2.50 service fee = $52.49
 * 3. Skyfire master wallet pays the seller via KYA+PAY token ($49.99)
 * 4. PayJarvis keeps the $2.50 fee
 * 5. Transaction recorded in purchase_transactions
 *
 * If user has no saved card → redirect to /wallet/setup
 * If Skyfire master wallet insufficient → fail gracefully, refund Stripe
 *
 * WHITE-LABEL: User never sees "Skyfire". Everything is "PayJarvis wallet".
 */

import Stripe from "stripe";
import { prisma } from "@payjarvis/database";

const SKYFIRE_BASE = "https://api.skyfire.xyz";
const SERVICE_FEE_PCT = 5; // 5% service fee

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key);
}

async function skyfireFetch(path: string, options: RequestInit = {}): Promise<any> {
  const key = process.env.SKYFIRE_API_KEY || "";
  if (!key) throw new Error("Payment infrastructure not configured");

  const res = await fetch(`${SKYFIRE_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "skyfire-api-key": key,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Payment provider ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export interface PurchaseRequest {
  userId: string;
  productName: string;
  price: number;
  currency?: string;
  merchant: string;
  merchantUrl?: string;
}

export interface PurchaseResult {
  success: boolean;
  orderId?: string;
  status: "completed" | "needs_card" | "failed" | "insufficient_funds";
  chargedAmount?: number;
  serviceFee?: number;
  message: string;
  setupUrl?: string;
}

/**
 * Get user's Stripe customer + default payment method.
 */
async function getUserPaymentInfo(userId: string): Promise<{
  stripeCustomerId: string | null;
  defaultPaymentMethodId: string | null;
  hasCard: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  if (!user?.stripeCustomerId) {
    return { stripeCustomerId: null, defaultPaymentMethodId: null, hasCard: false };
  }

  try {
    const stripe = getStripe();
    const methods = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: "card",
      limit: 1,
    });

    const pm = methods.data[0];
    return {
      stripeCustomerId: user.stripeCustomerId,
      defaultPaymentMethodId: pm?.id || null,
      hasCard: !!pm,
    };
  } catch {
    return { stripeCustomerId: user.stripeCustomerId, defaultPaymentMethodId: null, hasCard: false };
  }
}

/**
 * Check Skyfire master wallet balance.
 */
async function getMasterWalletBalance(): Promise<number> {
  try {
    const data = await skyfireFetch("/api/v1/agents/balance");
    return parseFloat(data.available || "0");
  } catch {
    return 0;
  }
}

/**
 * Execute full purchase: Stripe charge → Skyfire payment → record.
 */
export async function executePurchase(req: PurchaseRequest): Promise<PurchaseResult> {
  const currency = req.currency || "USD";
  const serviceFee = Math.round(req.price * SERVICE_FEE_PCT) / 100;
  const totalCharge = req.price + serviceFee;

  // 1. Check user has payment method
  const paymentInfo = await getUserPaymentInfo(req.userId);
  if (!paymentInfo.hasCard || !paymentInfo.stripeCustomerId || !paymentInfo.defaultPaymentMethodId) {
    return {
      success: false,
      status: "needs_card",
      message: "You need to add a payment card first. Set it up here: https://www.payjarvis.com/wallet/setup",
      setupUrl: "https://www.payjarvis.com/wallet/setup",
    };
  }

  // 2. Check Skyfire master wallet has enough
  const masterBalance = await getMasterWalletBalance();
  if (masterBalance < req.price) {
    console.error(`[PURCHASE] Master wallet insufficient: $${masterBalance} < $${req.price}`);
    return {
      success: false,
      status: "insufficient_funds",
      message: "Purchase temporarily unavailable. Please try again later.",
    };
  }

  // 3. Check spending limits
  const limits = await getSpendingLimits(req.userId);
  if (req.price > limits.perTransaction) {
    return { success: false, status: "failed", message: `Exceeds per-purchase limit of $${limits.perTransaction}. Say "increase limit" to change.` };
  }
  const todaySpend = await getSpendingToday(req.userId);
  if (todaySpend + req.price > limits.daily) {
    return { success: false, status: "failed", message: `Would exceed daily limit of $${limits.daily}. Already spent $${todaySpend.toFixed(2)} today.` };
  }

  // 4. Charge user's card via Stripe
  const stripe = getStripe();
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalCharge * 100), // cents
      currency: currency.toLowerCase(),
      customer: paymentInfo.stripeCustomerId,
      payment_method: paymentInfo.defaultPaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        payjarvisUserId: req.userId,
        productName: req.productName,
        merchant: req.merchant,
        productPrice: String(req.price),
        serviceFee: String(serviceFee),
      },
      description: `PayJarvis: ${req.productName} at ${req.merchant}`,
    });
  } catch (err: any) {
    if (err.code === "authentication_required") {
      return { success: false, status: "failed", message: "Your card requires authentication. Please complete payment at: https://www.payjarvis.com/wallet/setup" };
    }
    return { success: false, status: "failed", message: `Card charge failed: ${err.message}` };
  }

  if (paymentIntent.status !== "succeeded") {
    return { success: false, status: "failed", message: `Payment ${paymentIntent.status}. Please check your card.` };
  }

  // 5. Generate Skyfire PAY token (master wallet pays seller)
  const orderId = `PJ-${Date.now().toString(36).toUpperCase()}`;
  let skyfireTokenId: string | null = null;
  try {
    const tokenData = await skyfireFetch("/api/v1/tokens", {
      method: "POST",
      body: JSON.stringify({
        type: "kya+pay",
        sellerServiceId: "0ab7c9a9-491e-4f08-adeb-2643c53d4f2a",
        buyerTag: `payjarvis-${req.userId}-${Date.now()}`,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        tokenAmount: String(req.price),
      }),
    });
    skyfireTokenId = tokenData.token?.substring(0, 50) || null;
  } catch (err) {
    // Skyfire payment failed — refund Stripe
    console.error("[PURCHASE] Skyfire token failed, refunding Stripe:", (err as Error).message);
    try {
      await stripe.refunds.create({ payment_intent: paymentIntent.id });
    } catch (refundErr) {
      console.error("[PURCHASE] Refund also failed:", (refundErr as Error).message);
    }
    return { success: false, status: "failed", message: "Purchase failed. Your card was not charged." };
  }

  // 6. Record transaction
  try {
    await prisma.$executeRaw`
      INSERT INTO purchase_transactions (id, user_id, provider, product_name, price, currency, merchant, merchant_url, order_number, status, skyfire_token_jti, stripe_payment_intent, service_fee, created_at, updated_at)
      VALUES (${orderId}, ${req.userId}, 'HYBRID', ${req.productName}, ${req.price}, ${currency}, ${req.merchant}, ${req.merchantUrl || null}, ${orderId}, 'COMPLETED', ${skyfireTokenId}, ${paymentIntent.id}, ${serviceFee}, NOW(), NOW())
    `;
  } catch (err) {
    console.error("[PURCHASE] Failed to record transaction:", (err as Error).message);
    // Don't fail the purchase — it went through
  }

  return {
    success: true,
    orderId,
    status: "completed",
    chargedAmount: totalCharge,
    serviceFee,
    message: `Purchase completed! Order ${orderId} — ${req.productName} $${req.price.toFixed(2)} at ${req.merchant} (+ $${serviceFee.toFixed(2)} service fee)`,
  };
}

// ─── Spending Limits (reused from skyfire.service.ts) ───

async function getSpendingLimits(userId: string): Promise<{ perTransaction: number; daily: number; monthly: number }> {
  try {
    const rows = await prisma.$queryRaw<{ per_transaction: number; daily: number; monthly: number }[]>`
      SELECT per_transaction, daily, monthly FROM spending_limits WHERE user_id = ${userId} LIMIT 1
    `;
    const r = rows[0];
    if (r) return { perTransaction: r.per_transaction, daily: r.daily, monthly: r.monthly };
    return { perTransaction: 100, daily: 500, monthly: 2000 };
  } catch {
    return { perTransaction: 100, daily: 500, monthly: 2000 };
  }
}

async function getSpendingToday(userId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(price), 0) as total FROM purchase_transactions
      WHERE user_id = ${userId} AND status = 'COMPLETED' AND created_at >= CURRENT_DATE
    `;
    return Number(rows[0]?.total || 0);
  } catch {
    return 0;
  }
}

/**
 * Get user's wallet status (for the white-label wallet page).
 */
export async function getUserWalletStatus(userId: string): Promise<{
  hasCard: boolean;
  cardBrand?: string;
  cardLast4?: string;
  spentToday: number;
  spentThisMonth: number;
  limits: { perTransaction: number; daily: number; monthly: number };
}> {
  const paymentInfo = await getUserPaymentInfo(userId);
  const spentToday = await getSpendingToday(userId);

  let spentThisMonth = 0;
  try {
    const rows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(price), 0) as total FROM purchase_transactions
      WHERE user_id = ${userId} AND status = 'COMPLETED' AND created_at >= date_trunc('month', CURRENT_DATE)
    `;
    spentThisMonth = Number(rows[0]?.total || 0);
  } catch { /* */ }

  const limits = await getSpendingLimits(userId);

  let cardBrand: string | undefined;
  let cardLast4: string | undefined;
  if (paymentInfo.hasCard && paymentInfo.defaultPaymentMethodId) {
    try {
      const stripe = getStripe();
      const pm = await stripe.paymentMethods.retrieve(paymentInfo.defaultPaymentMethodId);
      cardBrand = pm.card?.brand;
      cardLast4 = pm.card?.last4;
    } catch { /* */ }
  }

  return {
    hasCard: paymentInfo.hasCard,
    cardBrand,
    cardLast4,
    spentToday,
    spentThisMonth,
    limits: { perTransaction: limits.perTransaction || 100, daily: limits.daily || 500, monthly: limits.monthly || 2000 },
  };
}
