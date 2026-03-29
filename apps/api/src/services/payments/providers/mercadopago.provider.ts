/**
 * Mercado Pago Provider — Checkout Pro + PIX (Brasil)
 *
 * Uses REST API directly (no SDK). Supports:
 * - Checkout Pro (preference → init_point link that accepts PIX, card, boleto, saldo MP)
 * - Direct PIX payment (QR code + copia-e-cola)
 * - Payment status check
 * - Refunds
 */

import {
  BasePaymentProvider,
  type PaymentIntent,
  type RefundResult,
} from "../base.provider.js";

const BASE_URL = "https://api.mercadopago.com";

interface MpPreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point: string;
}

interface MpPaymentResponse {
  id: number;
  status: string;
  status_detail: string;
  transaction_amount: number;
  currency_id: string;
  date_created: string;
  date_approved?: string;
  payment_method_id: string;
  payment_type_id: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

interface MpRefundResponse {
  id: number;
  payment_id: number;
  amount: number;
  status: string;
  date_created: string;
}

export class MercadoPagoProvider extends BasePaymentProvider {
  readonly name = "mercadopago";
  readonly displayName = "Mercado Pago";

  get isAvailable(): boolean {
    return !!process.env.MP_ACCESS_TOKEN;
  }

  private get token(): string {
    return process.env.MP_ACCESS_TOKEN || "";
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Create a Checkout Pro preference.
   * Returns init_point — a payment link that accepts PIX, card (up to 12x), boleto, saldo MP.
   */
  async createPreference(params: {
    title: string;
    amount: number;
    currencyId?: string;
    payerEmail?: string;
    externalReference?: string;
    notificationUrl?: string;
  }): Promise<{ id: string; initPoint: string }> {
    const body: Record<string, unknown> = {
      items: [
        {
          title: params.title,
          quantity: 1,
          unit_price: params.amount,
          currency_id: params.currencyId || "BRL",
        },
      ],
      back_urls: {
        success: "https://www.payjarvis.com/payment/success",
        failure: "https://www.payjarvis.com/payment/failure",
        pending: "https://www.payjarvis.com/payment/pending",
      },
      auto_return: "approved",
      external_reference: params.externalReference || `pj_${Date.now()}`,
    };

    if (params.payerEmail) {
      body.payer = { email: params.payerEmail };
    }

    if (params.notificationUrl) {
      body.notification_url = params.notificationUrl;
    }

    const res = await fetch(`${BASE_URL}/checkout/preferences`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mercado Pago preference error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as MpPreferenceResponse;
    return { id: data.id, initPoint: data.init_point };
  }

  /**
   * Create a direct PIX payment.
   * Returns QR code (base64 image) and copia-e-cola code.
   */
  async createPixPayment(params: {
    amount: number;
    description: string;
    payerEmail?: string;
    payerCpf?: string;
    payerFirstName?: string;
    payerLastName?: string;
  }): Promise<{
    paymentId: number;
    status: string;
    qrCode: string | null;
    qrCodeBase64: string | null;
    ticketUrl: string | null;
  }> {
    const body: Record<string, unknown> = {
      transaction_amount: params.amount,
      description: params.description,
      payment_method_id: "pix",
      payer: {
        email: params.payerEmail || "customer@payjarvis.com",
        first_name: params.payerFirstName || "PayJarvis",
        last_name: params.payerLastName || "Customer",
      },
    };

    // CPF is required for PIX in production
    if (params.payerCpf) {
      (body.payer as Record<string, unknown>).identification = {
        type: "CPF",
        number: params.payerCpf,
      };
    }

    const res = await fetch(`${BASE_URL}/v1/payments`, {
      method: "POST",
      headers: {
        ...this.headers,
        "X-Idempotency-Key": `pix_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mercado Pago PIX error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as MpPaymentResponse;
    const txData = data.point_of_interaction?.transaction_data;

    return {
      paymentId: data.id,
      status: data.status,
      qrCode: txData?.qr_code || null,
      qrCodeBase64: txData?.qr_code_base64 || null,
      ticketUrl: txData?.ticket_url || null,
    };
  }

  /**
   * Get payment details by ID.
   */
  async getPayment(paymentId: string | number): Promise<MpPaymentResponse> {
    const res = await fetch(`${BASE_URL}/v1/payments/${paymentId}`, {
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mercado Pago payment lookup error (${res.status}): ${text}`);
    }

    return (await res.json()) as MpPaymentResponse;
  }

  /**
   * Search payments with filters.
   */
  async searchPayments(filters: Record<string, string> = {}): Promise<{
    results: MpPaymentResponse[];
    total: number;
  }> {
    const params = new URLSearchParams(filters);
    const res = await fetch(`${BASE_URL}/v1/payments/search?${params}`, {
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mercado Pago search error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { results: MpPaymentResponse[]; paging: { total: number } };
    return { results: data.results, total: data.paging.total };
  }

  // ─── BasePaymentProvider interface ───

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    merchantAccountId: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    const pref = await this.createPreference({
      title: params.metadata?.description || "PayJarvis purchase",
      amount: params.amount,
      currencyId: params.currency.toUpperCase() === "BRL" ? "BRL" : "BRL",
      payerEmail: params.metadata?.payerEmail,
    });

    return {
      id: pref.id,
      provider: this.name,
      amount: params.amount,
      currency: "BRL",
      status: "created",
      redirectUrl: pref.initPoint,
      metadata: {
        ...params.metadata,
        provider: "mercadopago",
        preferenceId: pref.id,
      },
    };
  }

  async refund(params: {
    paymentIntentId: string;
    amount?: number;
  }): Promise<RefundResult> {
    const body: Record<string, unknown> = {};
    if (params.amount !== undefined) {
      body.amount = params.amount;
    }

    const res = await fetch(`${BASE_URL}/v1/payments/${params.paymentIntentId}/refunds`, {
      method: "POST",
      headers: {
        ...this.headers,
        "X-Idempotency-Key": `refund_${params.paymentIntentId}_${Date.now()}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mercado Pago refund error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as MpRefundResponse;
    return {
      id: String(data.id),
      amount: data.amount,
      status: data.status === "approved" ? "succeeded" : "pending",
    };
  }

  async getAccountStatus(): Promise<{
    active: boolean;
    details?: Record<string, unknown>;
  }> {
    if (!this.isAvailable) return { active: false };

    try {
      // Test credentials by fetching user info
      const res = await fetch(`${BASE_URL}/users/me`, {
        headers: this.headers,
      });
      if (!res.ok) return { active: false };
      const data = (await res.json()) as { id: number; nickname: string; site_id: string };
      return {
        active: true,
        details: { userId: data.id, nickname: data.nickname, siteId: data.site_id },
      };
    } catch {
      return { active: false };
    }
  }
}
