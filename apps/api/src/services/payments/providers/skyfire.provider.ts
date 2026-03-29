import {
  BasePaymentProvider,
  type PaymentIntent,
  type RefundResult,
} from "../base.provider.js";

const SKYFIRE_BASE = "https://api.skyfire.xyz";

export class SkyfirePaymentProvider extends BasePaymentProvider {
  readonly name = "skyfire";
  readonly displayName = "Skyfire";

  get isAvailable(): boolean {
    return !!process.env.SKYFIRE_API_KEY;
  }

  private async skyfireFetch(path: string, options: RequestInit = {}): Promise<any> {
    const key = process.env.SKYFIRE_API_KEY;
    if (!key) throw new Error("SKYFIRE_API_KEY not configured");

    const res = await fetch(`${SKYFIRE_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "skyfire-api-key": key,
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

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    merchantAccountId: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    const tokenData = await this.skyfireFetch("/api/v1/tokens", {
      method: "POST",
      body: JSON.stringify({
        type: "kya+pay",
        sellerServiceId: params.merchantAccountId || "0ab7c9a9-491e-4f08-adeb-2643c53d4f2a",
        buyerTag: params.metadata?.userId ? `payjarvis-${params.metadata.userId}` : "payjarvis",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        tokenAmount: String(params.amount),
      }),
    });

    return {
      id: tokenData.token?.substring(0, 50) || `sf_${Date.now()}`,
      provider: this.name,
      amount: params.amount,
      currency: params.currency,
      status: "succeeded",
    };
  }

  async refund(_params: { paymentIntentId: string; amount?: number }): Promise<RefundResult> {
    // Skyfire refunds are handled via their dashboard
    return { id: `sf_refund_${Date.now()}`, amount: _params.amount || 0, status: "pending" };
  }

  async getAccountStatus(_accountId: string): Promise<{ active: boolean; details?: Record<string, unknown> }> {
    try {
      // Test API key validity by fetching directory
      await this.skyfireFetch("/api/v1/directory/services");
      return { active: true, details: { provider: "skyfire", dashboardUrl: "https://app.skyfire.xyz" } };
    } catch {
      return { active: false };
    }
  }
}
