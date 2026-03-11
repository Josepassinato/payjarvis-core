import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PayPalProvider } from "../src/services/payments/providers/paypal.provider.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("PayPalProvider", () => {
  let provider: PayPalProvider;

  beforeEach(() => {
    provider = new PayPalProvider();
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("PAYPAL_ENVIRONMENT", "sandbox");
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isAvailable", () => {
    it("returns true when both env vars are set", () => {
      expect(provider.isAvailable).toBe(true);
    });

    it("returns false when client ID is missing", () => {
      vi.stubEnv("PAYPAL_CLIENT_ID", "");
      expect(provider.isAvailable).toBe(false);
    });

    it("returns false when client secret is missing", () => {
      vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
      expect(provider.isAvailable).toBe(false);
    });
  });

  describe("getAccessToken", () => {
    it("returns access token on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "A21AAF...", expires_in: 32400 }),
      });

      const token = await provider.getAccessToken();
      expect(token).toBe("A21AAF...");
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe("grant_type=client_credentials");
    });

    it("caches token for env credentials", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "cached-token", expires_in: 32400 }),
      });

      await provider.getAccessToken();
      const token2 = await provider.getAccessToken();
      expect(token2).toBe("cached-token");
      expect(mockFetch).toHaveBeenCalledOnce(); // only 1 fetch
    });

    it("does not cache token for custom credentials", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "tok-1", expires_in: 32400 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "tok-2", expires_in: 32400 }),
        });

      await provider.getAccessToken("custom-id", "custom-secret");
      await provider.getAccessToken("custom-id", "custom-secret");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on auth failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ name: "AUTHENTICATION_FAILURE", message: "Bad credentials" }),
      });

      await expect(provider.getAccessToken()).rejects.toThrow("Bad credentials");
    });

    it("throws when env vars are missing", async () => {
      vi.stubEnv("PAYPAL_CLIENT_ID", "");
      vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
      await expect(provider.getAccessToken()).rejects.toThrow("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
    });
  });

  describe("validateCredentials", () => {
    it("returns valid: true on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });

      const result = await provider.validateCredentials("id", "secret");
      expect(result.valid).toBe(true);
      expect(result.environment).toBe("sandbox");
    });

    it("returns valid: false on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await provider.validateCredentials("bad-id", "bad-secret");
      expect(result.valid).toBe(false);
    });
  });

  describe("createPaymentIntent", () => {
    it("creates PayPal order and returns PaymentIntent", async () => {
      // First call: getAccessToken
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      // Second call: create order
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER-123",
          status: "CREATED",
          links: [
            { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-123" },
            { rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123" },
          ],
        }),
      });

      const result = await provider.createPaymentIntent({
        amount: 29.99,
        currency: "usd",
        merchantAccountId: "merchant@example.com",
        metadata: { transactionId: "tx_123" },
      });

      expect(result.id).toBe("ORDER-123");
      expect(result.provider).toBe("paypal");
      expect(result.amount).toBe(29.99);
      expect(result.currency).toBe("USD");
      expect(result.status).toBe("created");
      expect(result.redirectUrl).toContain("sandbox.paypal.com");

      // Verify order creation request
      const [url, opts] = mockFetch.mock.calls[1];
      expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
      const body = JSON.parse(opts.body);
      expect(body.intent).toBe("CAPTURE");
      expect(body.purchase_units[0].amount.value).toBe("29.99");
      expect(body.purchase_units[0].amount.currency_code).toBe("USD");
      expect(body.purchase_units[0].payee.email_address).toBe("merchant@example.com");
    });

    it("throws on order creation failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ name: "UNPROCESSABLE_ENTITY", message: "Invalid amount" }),
      });

      await expect(
        provider.createPaymentIntent({
          amount: -1,
          currency: "usd",
          merchantAccountId: "m@e.com",
        }),
      ).rejects.toThrow("Invalid amount");
    });
  });

  describe("captureOrder", () => {
    it("captures an approved order", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ORDER-123",
          status: "COMPLETED",
          purchase_units: [
            {
              payments: {
                captures: [
                  { id: "CAP-456", status: "COMPLETED", amount: { value: "29.99", currency_code: "USD" } },
                ],
              },
            },
          ],
        }),
      });

      const result = await provider.captureOrder("ORDER-123");
      expect(result.captureId).toBe("CAP-456");
      expect(result.status).toBe("COMPLETED");
      expect(result.amount).toBe(29.99);
      expect(result.currency).toBe("USD");
    });

    it("throws when no capture in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ORDER-123", status: "COMPLETED", purchase_units: [] }),
      });

      await expect(provider.captureOrder("ORDER-123")).rejects.toThrow("No capture found");
    });
  });

  describe("refund / refundCapture", () => {
    it("refunds a captured payment fully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "REF-789",
          status: "COMPLETED",
          amount: { value: "29.99", currency_code: "USD" },
        }),
      });

      const result = await provider.refund({ paymentIntentId: "CAP-456" });
      expect(result.id).toBe("REF-789");
      expect(result.amount).toBe(29.99);
      expect(result.status).toBe("succeeded");
    });

    it("refunds partially", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "REF-PARTIAL",
          status: "COMPLETED",
          amount: { value: "10.00", currency_code: "USD" },
        }),
      });

      const result = await provider.refundCapture("CAP-456", 10.0, "Partial refund");
      expect(result.id).toBe("REF-PARTIAL");
      expect(result.amount).toBe(10);
      expect(result.status).toBe("succeeded");

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.amount.value).toBe("10.00");
      expect(body.note_to_payer).toBe("Partial refund");
    });

    it("returns pending status for non-COMPLETED refunds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "REF-PEND",
          status: "PENDING",
          amount: { value: "5.00", currency_code: "USD" },
        }),
      });

      const result = await provider.refund({ paymentIntentId: "CAP-456" });
      expect(result.status).toBe("pending");
    });
  });

  describe("getAccountStatus", () => {
    it("returns active when credentials work", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      });

      const result = await provider.getAccountStatus();
      expect(result.active).toBe(true);
      expect(result.details?.environment).toBe("sandbox");
    });

    it("returns inactive when not available", async () => {
      vi.stubEnv("PAYPAL_CLIENT_ID", "");
      vi.stubEnv("PAYPAL_CLIENT_SECRET", "");

      const result = await provider.getAccountStatus();
      expect(result.active).toBe(false);
    });
  });

  describe("normalizeError", () => {
    it("produces structured error from PayPal error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            name: "INVALID_REQUEST",
            message: "Request is not well-formed",
            debug_id: "abc123",
            details: [{ issue: "MISSING_FIELD", description: "Field 'amount' is required" }],
          }),
      });

      try {
        await provider.getAccessToken();
      } catch (e: any) {
        expect(e.message).toBe("Request is not well-formed");
        expect(e.code).toBe("INVALID_REQUEST");
        expect(e.provider).toBe("paypal");
        expect(e.statusCode).toBe(400);
      }
    });
  });
});
