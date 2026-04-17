/**
 * Celcoin Provider — Iniciador de Pagamento (PIX via Open Finance BR).
 *
 * What this unlocks: autonomous PIX initiation from the user's bank account,
 * with BACEN-regulated consent (no credential sharing, no QR-code tap).
 *
 * Flow:
 *   1. User grants one-time consent (OAuth-like redirect to their bank)
 *      → POST /open-finance/consents → returns authorizationUrl + consentId
 *   2. For each purchase, Sniffer initiates a PIX
 *      → POST /open-finance/payments (with valid consentId, PIX key, amount)
 *   3. Bank settles (instant or seconds) and Celcoin fires a webhook
 *      → verify status via GET /open-finance/payments/:paymentId
 *
 * Required env:
 *   CELCOIN_API_URL       (sandbox: https://api.sandbox.cel.cash; prod: https://api.celcoin.com.br)
 *   CELCOIN_CLIENT_ID
 *   CELCOIN_CLIENT_SECRET
 *
 * Until these are set, the provider returns clear { mock: true, reason } objects
 * so the payment-factory can gracefully fall back to another rail.
 */

import {
  BasePaymentProvider,
  type PaymentIntent,
  type RefundResult,
} from "../base.provider.js";

const DEFAULT_BASE = "https://api.sandbox.cel.cash";

export interface ConsentRequest {
  userId: string;
  cpf: string;                   // usuário brasileiro — obrigatório
  userName: string;
  callbackUrl: string;           // onde Sniffer recebe o callback após autorização
  validityDays?: number;         // default 365
}

export interface ConsentResult {
  consentId: string;
  authorizationUrl: string;
  expiresAt: string;
  mock?: boolean;
  reason?: string;
}

export interface InitiatePixRequest {
  consentId: string;
  amount: number;                // BRL
  recipientPixKey: string;       // chave PIX do merchant (CNPJ, email, aleatória)
  recipientName?: string;
  recipientDocument?: string;    // CNPJ/CPF do destinatário
  description?: string;
  endToEndId?: string;           // idempotência
}

export interface PixPaymentStatus {
  paymentId: string;
  status: "pending" | "processing" | "confirmed" | "failed" | "cancelled";
  endToEndId?: string;
  settledAt?: string;
  reason?: string;
}

export class CelcoinProvider extends BasePaymentProvider {
  readonly name = "celcoin";
  readonly displayName = "Celcoin (Iniciador PIX)";

  private accessToken: { value: string; expiresAt: number } | null = null;

  get isAvailable(): boolean {
    return Boolean(process.env.CELCOIN_CLIENT_ID && process.env.CELCOIN_CLIENT_SECRET);
  }

  private get baseUrl(): string {
    return process.env.CELCOIN_API_URL || DEFAULT_BASE;
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.isAvailable) return null;
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 30_000) {
      return this.accessToken.value;
    }
    const clientId = process.env.CELCOIN_CLIENT_ID!;
    const clientSecret = process.env.CELCOIN_CLIENT_SECRET!;
    const res = await fetch(`${this.baseUrl}/v5/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`celcoin auth ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    this.accessToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return this.accessToken.value;
  }

  private async celFetch(path: string, init: RequestInit = {}): Promise<any> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("celcoin_not_configured");
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
      signal: init.signal || AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    if (!res.ok) throw new Error(`celcoin ${res.status}: ${(parsed?.message || parsed?.error || text).slice(0, 200)}`);
    return parsed;
  }

  // ─── OPEN FINANCE CONSENT ─────────────────────────────────────────────

  async createConsent(req: ConsentRequest): Promise<ConsentResult> {
    if (!this.isAvailable) {
      return {
        consentId: `consent_mock_${Date.now()}`,
        authorizationUrl: `https://example.bank/mock/authorize?consent=mock_${Date.now()}`,
        expiresAt: new Date(Date.now() + (req.validityDays ?? 365) * 86_400_000).toISOString(),
        mock: true,
        reason: "CELCOIN_CLIENT_ID not configured",
      };
    }
    const validityDays = req.validityDays ?? 365;
    const expiresAt = new Date(Date.now() + validityDays * 86_400_000).toISOString();
    const body = {
      loggedUser: { document: { identification: req.cpf, rel: "CPF" } },
      creditor: { personType: "PESSOA_JURIDICA", cnpjCpf: req.cpf, name: req.userName },
      expiration: expiresAt,
      callbackUrl: req.callbackUrl,
    };
    const data = await this.celFetch("/v5/open-finance/consents", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      consentId: data.consentId || data.body?.consentId,
      authorizationUrl: data.authorizationUrl || data.body?.authorizationUrl,
      expiresAt,
    };
  }

  async getConsentStatus(consentId: string): Promise<{ status: string; raw?: any; mock?: boolean }> {
    if (!this.isAvailable) return { status: "mock_authorized", mock: true };
    const data = await this.celFetch(`/v5/open-finance/consents/${consentId}`, { method: "GET" });
    return { status: data.status || "unknown", raw: data };
  }

  // ─── PIX INITIATION ───────────────────────────────────────────────────

  async initiatePix(req: InitiatePixRequest): Promise<PixPaymentStatus> {
    if (!this.isAvailable) {
      return {
        paymentId: `pix_mock_${Date.now()}`,
        status: "pending",
        reason: "CELCOIN_CLIENT_ID not configured — real PIX skipped",
      };
    }
    const body = {
      consentId: req.consentId,
      amount: req.amount,
      creditor: {
        pixKey: req.recipientPixKey,
        name: req.recipientName,
        cnpjCpf: req.recipientDocument,
      },
      description: req.description?.slice(0, 140),
      endToEndId: req.endToEndId,
    };
    const data = await this.celFetch("/v5/open-finance/payments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      paymentId: data.paymentId || data.body?.paymentId,
      status: (data.status || "pending") as PixPaymentStatus["status"],
      endToEndId: data.endToEndId,
    };
  }

  async getPaymentStatus(paymentId: string): Promise<PixPaymentStatus> {
    if (!this.isAvailable) {
      return { paymentId, status: "confirmed", reason: "mock" };
    }
    const data = await this.celFetch(`/v5/open-finance/payments/${paymentId}`, { method: "GET" });
    return {
      paymentId,
      status: (data.status || "pending") as PixPaymentStatus["status"],
      endToEndId: data.endToEndId,
      settledAt: data.settledAt,
    };
  }

  // ─── BasePaymentProvider interface ────────────────────────────────────

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    merchantAccountId: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    // Requires metadata.consentId + metadata.recipientPixKey from caller.
    const consentId = params.metadata?.consentId;
    const recipientPixKey = params.metadata?.recipientPixKey;
    if (!consentId || !recipientPixKey) {
      return {
        id: `celcoin_noop_${Date.now()}`,
        provider: this.name,
        amount: params.amount,
        currency: params.currency,
        status: "failed",
        metadata: { reason: "missing_consent_or_pix_key" },
      };
    }
    const pix = await this.initiatePix({
      consentId,
      amount: params.amount,
      recipientPixKey,
      recipientName: params.metadata?.recipientName,
      recipientDocument: params.metadata?.recipientDocument,
      description: params.metadata?.description,
    });
    const statusMap: Record<PixPaymentStatus["status"], PaymentIntent["status"]> = {
      pending: "processing",
      processing: "processing",
      confirmed: "succeeded",
      failed: "failed",
      cancelled: "cancelled",
    };
    return {
      id: pix.paymentId,
      provider: this.name,
      amount: params.amount,
      currency: params.currency,
      status: statusMap[pix.status],
      metadata: { endToEndId: pix.endToEndId ?? "", consentId },
    };
  }

  async refund(_params: { paymentIntentId: string; amount?: number }): Promise<RefundResult> {
    // PIX native "devolução" (MED) — out of scope for v1
    return { id: `celcoin_refund_${Date.now()}`, amount: _params.amount || 0, status: "pending" };
  }

  async getAccountStatus(_accountId: string): Promise<{ active: boolean; details?: Record<string, unknown> }> {
    if (!this.isAvailable) {
      return { active: false, details: { reason: "CELCOIN_CLIENT_ID/SECRET not set" } };
    }
    try {
      await this.getAccessToken();
      return { active: true, details: { provider: "celcoin", baseUrl: this.baseUrl } };
    } catch (err: any) {
      return { active: false, details: { error: err.message } };
    }
  }
}
