import {
  BasePaymentProvider,
  type PaymentIntent,
  type RefundResult,
} from "../base.provider.js";

interface PayPalTokenCache {
  token: string;
  expiresAt: number;
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: Array<{ rel: string; href: string }>;
}

interface PayPalCaptureResponse {
  id: string;
  status: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount?: { value: string; currency_code: string };
      }>;
    };
  }>;
}

interface PayPalRefundResponse {
  id: string;
  status: string;
  amount?: { value: string; currency_code: string };
}

interface PayPalError {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string }>;
}

export class PayPalProvider extends BasePaymentProvider {
  readonly name = "paypal";
  readonly displayName = "PayPal";
  private tokenCache: PayPalTokenCache | null = null;

  get isAvailable(): boolean {
    return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  }

  private get baseUrl(): string {
    const env = process.env.PAYPAL_ENVIRONMENT ?? "sandbox";
    return env === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  }

  private get environment(): "sandbox" | "live" {
    return process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";
  }

  /**
   * Authenticate with PayPal OAuth2 and return a bearer token.
   * Caches token until 60s before expiry.
   */
  async getAccessToken(
    clientId?: string,
    clientSecret?: string,
  ): Promise<string> {
    const id = clientId ?? process.env.PAYPAL_CLIENT_ID;
    const secret = clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
    if (!id || !secret) {
      throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
    }

    // Use cache only when using env credentials (not custom ones)
    const useCache = !clientId && !clientSecret;
    if (useCache && this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    const credentials = Buffer.from(`${id}:${secret}`).toString("base64");

    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw this.normalizeError(res.status, body, "Authentication failed");
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    if (useCache) {
      this.tokenCache = {
        token: data.access_token,
        // Expire 60s early to avoid race conditions
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
      };
    }

    return data.access_token;
  }

  /**
   * Validate user-provided PayPal credentials by attempting authentication.
   */
  async validateCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<{ valid: boolean; environment?: string }> {
    try {
      await this.getAccessToken(clientId, clientSecret);
      return { valid: true, environment: this.environment };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Create a PayPal order for the given amount.
   * Maps to the BasePaymentProvider.createPaymentIntent interface.
   */
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    merchantAccountId: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    const token = await this.getAccessToken();

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: params.currency.toUpperCase(),
            value: params.amount.toFixed(2),
          },
          custom_id: params.metadata?.transactionId ?? undefined,
          description: params.metadata?.description ?? "PayJarvis transaction",
          payee: {
            email_address: params.merchantAccountId,
          },
        },
      ],
      application_context: {
        brand_name: "PayJarvis",
        shipping_preference: "NO_SHIPPING",
      },
    };

    const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify(orderPayload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw this.normalizeError(res.status, body, "Failed to create PayPal order");
    }

    const order = (await res.json()) as PayPalOrderResponse;

    const approveLink = order.links?.find((l) => l.rel === "approve")?.href;

    return {
      id: order.id,
      provider: this.name,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      status: "created",
      redirectUrl: approveLink,
      metadata: {
        ...params.metadata,
        provider: "paypal",
        orderId: order.id,
        environment: this.environment,
      },
    };
  }

  /**
   * Capture an approved PayPal order.
   */
  async captureOrder(orderId: string): Promise<{
    captureId: string;
    status: string;
    amount: number;
    currency: string;
  }> {
    const token = await this.getAccessToken();

    const res = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw this.normalizeError(res.status, body, "Failed to capture PayPal order");
    }

    const data = (await res.json()) as PayPalCaptureResponse;
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

    if (!capture) {
      throw new Error("No capture found in PayPal response");
    }

    return {
      captureId: capture.id,
      status: capture.status,
      amount: parseFloat(capture.amount?.value ?? "0"),
      currency: capture.amount?.currency_code ?? "USD",
    };
  }

  /**
   * Refund a captured PayPal payment.
   * Maps to the BasePaymentProvider.refund interface.
   *
   * Note: the `paymentIntentId` parameter is expected to be the capture ID.
   */
  async refund(params: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
  }): Promise<RefundResult> {
    return this.refundCapture(params.paymentIntentId, params.amount, params.reason);
  }

  /**
   * Refund a captured payment. Supports partial refunds.
   */
  async refundCapture(
    captureId: string,
    amount?: number,
    reason?: string,
  ): Promise<RefundResult> {
    const token = await this.getAccessToken();

    const body: Record<string, unknown> = {};
    if (amount !== undefined) {
      body.amount = {
        value: amount.toFixed(2),
        currency_code: "USD", // PayPal requires currency; caller should pass this
      };
    }
    if (reason) {
      body.note_to_payer = reason;
    }

    const res = await fetch(
      `${this.baseUrl}/v2/payments/captures/${captureId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const respBody = await res.text().catch(() => "");
      throw this.normalizeError(res.status, respBody, "Failed to refund PayPal capture");
    }

    const data = (await res.json()) as PayPalRefundResponse;

    return {
      id: data.id,
      amount: data.amount ? parseFloat(data.amount.value) : 0,
      status: data.status === "COMPLETED" ? "succeeded" : "pending",
    };
  }

  /**
   * Check account connection status.
   */
  async getAccountStatus(
    _accountId?: string,
  ): Promise<{ active: boolean; details?: Record<string, unknown> }> {
    if (!this.isAvailable) {
      return { active: false };
    }

    try {
      await this.getAccessToken();
      return {
        active: true,
        details: {
          environment: this.environment,
          baseUrl: this.baseUrl,
        },
      };
    } catch {
      return { active: false };
    }
  }

  /**
   * Normalize PayPal API errors into a structured format.
   * Never exposes client_secret or access tokens.
   */
  private normalizeError(
    statusCode: number,
    responseBody: string,
    fallbackMessage: string,
  ): Error {
    let parsed: PayPalError | null = null;
    try {
      parsed = JSON.parse(responseBody) as PayPalError;
    } catch {
      // Not JSON
    }

    const message =
      parsed?.message ??
      parsed?.details?.[0]?.description ??
      fallbackMessage;

    const error = new Error(message) as Error & {
      code: string;
      provider: string;
      statusCode: number;
      raw: unknown;
    };

    error.code = parsed?.name ?? `PAYPAL_HTTP_${statusCode}`;
    error.provider = "paypal";
    error.statusCode = statusCode;

    // Strip sensitive data from raw response
    if (parsed) {
      const { ...safe } = parsed;
      error.raw = safe;
    }

    return error;
  }
}
