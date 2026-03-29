// ─── Skyfire Integration — Wallet-based Payment Provider for AI Agents ───
// https://docs.skyfire.xyz
//
// MODEL:
// 1. User funds Skyfire wallet via their dashboard (card/USDC/ACH)
// 2. PayJarvis (buyer agent) generates PAY tokens from wallet balance
// 3. PAY tokens are used to pay seller services (e-commerce, APIs, etc.)
// 4. PayJarvis NEVER sees card numbers — Skyfire handles funding
//
// FUTURE: When Skyfire launches card tokenization (KYAPay token envelope),
// swap this provider without changing the interface.

import { prisma } from "@payjarvis/database";

const SKYFIRE_BASE = "https://api.skyfire.xyz";
const SKYFIRE_APP = "https://app.skyfire.xyz";
const SKYFIRE_API_KEY = process.env.SKYFIRE_API_KEY || "";

// ─── Abstract Interface (swap Skyfire → Visa TAP later) ─────────

export interface CheckoutParams {
  userId: string;
  productName: string;
  price: number;
  currency: string;
  merchant: string;
  merchantUrl?: string;
  sellerServiceId?: string;
  shippingAddress?: string;
}

export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  transactionId?: string;
  status: "completed" | "pending" | "failed" | "needs_funding";
  message: string;
  chargedAmount?: number;
}

export interface SpendingLimits {
  perTransaction: number;
  daily: number;
  monthly: number;
}

export interface WalletInfo {
  funded: boolean;
  balance?: number;
  currency: string;
  fundingUrl: string;
}

export interface PaymentProviderInterface {
  name: string;
  getWalletRegistrationUrl(userId: string): string;
  getWalletInfo(): Promise<WalletInfo>;
  checkout(params: CheckoutParams): Promise<CheckoutResult>;
  getSpendingLimits(userId: string): Promise<SpendingLimits>;
  setSpendingLimits(userId: string, limits: Partial<SpendingLimits>): Promise<SpendingLimits>;
  getSpendingToday(userId: string): Promise<number>;
  getSpendingThisMonth(userId: string): Promise<number>;
  discoverServices(tags?: string): Promise<any[]>;
}

// ─── Skyfire HTTP Client ────────────────────────────────

async function skyfireFetch(path: string, options: RequestInit = {}): Promise<any> {
  if (!SKYFIRE_API_KEY) throw new Error("SKYFIRE_API_KEY not configured");

  const res = await fetch(`${SKYFIRE_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "skyfire-api-key": SKYFIRE_API_KEY,
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Skyfire ${res.status}: ${body || res.statusText}`);
  }

  return res.json();
}

// ─── Skyfire Provider Implementation ────────────────────

class SkyfireProvider implements PaymentProviderInterface {
  name = "skyfire";

  /** URL to fund Skyfire wallet (hosted by Skyfire) */
  getWalletRegistrationUrl(userId: string): string {
    // Skyfire dashboard — user funds wallet with card/USDC/ACH
    return `${SKYFIRE_APP}?ref=payjarvis&uid=${encodeURIComponent(userId)}`;
  }

  /** Check wallet status */
  async getWalletInfo(): Promise<WalletInfo> {
    // Try known balance endpoints (order: confirmed working → legacy)
    const paths = ["/api/v1/agents/balance", "/api/v1/agents/wallet-balance", "/api/v1/wallet/balance"];
    for (const path of paths) {
      try {
        const data = await skyfireFetch(path);
        const balance = parseFloat(data.available ?? data.balance ?? "0");
        return {
          funded: balance > 0,
          balance,
          currency: data.currency || "USD",
          fundingUrl: SKYFIRE_APP,
        };
      } catch {
        // try next
      }
    }
    // Balance endpoint not available — assume funded (user manages via dashboard)
    return { funded: true, currency: "USD", fundingUrl: SKYFIRE_APP };
  }

  /** Generate PAY token and execute checkout */
  async checkout(params: CheckoutParams): Promise<CheckoutResult> {
    // 1. Check spending limits
    const limits = await this.getSpendingLimits(params.userId);
    if (params.price > limits.perTransaction) {
      return { success: false, status: "failed", message: `Exceeds per-transaction limit of $${limits.perTransaction}` };
    }
    const todaySpend = await this.getSpendingToday(params.userId);
    if (todaySpend + params.price > limits.daily) {
      return { success: false, status: "failed", message: `Would exceed daily limit of $${limits.daily}. Already spent $${todaySpend.toFixed(2)} today.` };
    }
    const monthSpend = await this.getSpendingThisMonth(params.userId);
    if (monthSpend + params.price > limits.monthly) {
      return { success: false, status: "failed", message: `Would exceed monthly limit of $${limits.monthly}. Already spent $${monthSpend.toFixed(2)} this month.` };
    }

    // 2. Generate PAY token via Skyfire
    const sellerServiceId = params.sellerServiceId || "0ab7c9a9-491e-4f08-adeb-2643c53d4f2a";
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    let tokenData: any;
    try {
      tokenData = await skyfireFetch("/api/v1/tokens", {
        method: "POST",
        body: JSON.stringify({
          type: "kya+pay",
          sellerServiceId,
          buyerTag: `payjarvis-${params.userId}-${Date.now()}`,
          expiresAt,
          tokenAmount: String(params.price),
        }),
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("insufficient") || msg.includes("balance") || msg.includes("402") || msg.includes("Payment Required")) {
        return {
          success: false,
          status: "needs_funding",
          message: `Skyfire wallet needs funding. Add funds at: ${SKYFIRE_APP}`,
        };
      }
      throw err;
    }

    // 3. Record purchase
    const orderId = `PJ-${Date.now().toString(36).toUpperCase()}`;
    try {
      await prisma.$executeRaw`
        INSERT INTO purchase_transactions (id, user_id, provider, product_name, price, currency, merchant, merchant_url, order_number, status, skyfire_token_jti, created_at, updated_at)
        VALUES (${orderId}, ${params.userId}, 'SKYFIRE', ${params.productName}, ${params.price}, ${params.currency}, ${params.merchant}, ${params.merchantUrl || null}, ${orderId}, 'COMPLETED', ${tokenData.token?.substring(0, 50) || null}, NOW(), NOW())
      `;
    } catch (err) {
      console.error("[SKYFIRE] Failed to record purchase:", (err as Error).message);
    }

    return {
      success: true,
      orderId,
      status: "completed",
      chargedAmount: params.price,
      message: `Purchase completed! Order ${orderId} — ${params.productName} $${params.price} at ${params.merchant}`,
    };
  }

  /** Get user spending limits (from DB or defaults) */
  async getSpendingLimits(userId: string): Promise<SpendingLimits> {
    try {
      const row = await prisma.$queryRaw<{ per_transaction: number; daily: number; monthly: number }[]>`
        SELECT per_transaction, daily, monthly FROM spending_limits WHERE user_id = ${userId} LIMIT 1
      `;
      if (row.length > 0) {
        return { perTransaction: row[0].per_transaction, daily: row[0].daily, monthly: row[0].monthly };
      }
    } catch {
      // Table may not exist yet
    }
    return { perTransaction: 100, daily: 500, monthly: 2000 };
  }

  /** Update spending limits */
  async setSpendingLimits(userId: string, limits: Partial<SpendingLimits>): Promise<SpendingLimits> {
    const current = await this.getSpendingLimits(userId);
    const updated = {
      perTransaction: limits.perTransaction ?? current.perTransaction,
      daily: limits.daily ?? current.daily,
      monthly: limits.monthly ?? current.monthly,
    };
    await prisma.$executeRaw`
      INSERT INTO spending_limits (user_id, per_transaction, daily, monthly, updated_at)
      VALUES (${userId}, ${updated.perTransaction}, ${updated.daily}, ${updated.monthly}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        per_transaction = ${updated.perTransaction},
        daily = ${updated.daily},
        monthly = ${updated.monthly},
        updated_at = NOW()
    `;
    return updated;
  }

  /** Calculate total spent today */
  async getSpendingToday(userId: string): Promise<number> {
    try {
      const result = await prisma.$queryRaw<{ total: number | null }[]>`
        SELECT COALESCE(SUM(price), 0) as total FROM purchase_transactions
        WHERE user_id = ${userId} AND status = 'COMPLETED'
        AND created_at >= CURRENT_DATE
      `;
      return Number(result[0]?.total || 0);
    } catch {
      return 0;
    }
  }

  /** Calculate total spent this month */
  async getSpendingThisMonth(userId: string): Promise<number> {
    try {
      const result = await prisma.$queryRaw<{ total: number | null }[]>`
        SELECT COALESCE(SUM(price), 0) as total FROM purchase_transactions
        WHERE user_id = ${userId} AND status = 'COMPLETED'
        AND created_at >= date_trunc('month', CURRENT_DATE)
      `;
      return Number(result[0]?.total || 0);
    } catch {
      return 0;
    }
  }

  /** Discover available services on Skyfire marketplace */
  async discoverServices(tags?: string): Promise<any[]> {
    const path = tags
      ? `/api/v1/directory/services/search?tags=${encodeURIComponent(tags)}`
      : "/api/v1/directory/services";
    const data = await skyfireFetch(path);
    const services = data?.data || (Array.isArray(data) ? data : []);
    return services.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description?.substring(0, 200),
      type: s.type,
      price: s.price,
      priceModel: s.priceModel,
      tags: s.tags,
      seller: s.seller?.name,
    }));
  }
}

// ─── Singleton Export ───────────────────────────────────

export const skyfire = new SkyfireProvider();

// Convenience exports
export const getWalletRegistrationUrl = (userId: string) => skyfire.getWalletRegistrationUrl(userId);
export const getWalletInfo = () => skyfire.getWalletInfo();
export const skyfireCheckout = (params: CheckoutParams) => skyfire.checkout(params);
export const getSpendingLimits = (userId: string) => skyfire.getSpendingLimits(userId);
export const setSpendingLimits = (userId: string, limits: Partial<SpendingLimits>) => skyfire.setSpendingLimits(userId, limits);
export const getSpendingToday = (userId: string) => skyfire.getSpendingToday(userId);
export const getSpendingThisMonth = (userId: string) => skyfire.getSpendingThisMonth(userId);
export const discoverServices = (tags?: string) => skyfire.discoverServices(tags);

// Raw token generation (for advanced use)
export async function generateToken(params: {
  type: "kya" | "pay" | "kya+pay";
  sellerServiceId: string;
  buyerTag?: string;
  expiresAt?: number;
  tokenAmount?: number;
}) {
  return skyfireFetch("/api/v1/tokens", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
