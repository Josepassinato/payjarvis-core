# PayPal Integration

Accept PayPal payments through PayJarvis. This guide covers sandbox setup, going live, and the end-to-end payment flow.

---

## 1. Get Sandbox Credentials

1. Go to [developer.paypal.com](https://developer.paypal.com) and log in (or create a free account)
2. Navigate to **Apps & Credentials**
3. Make sure the toggle is set to **Sandbox**
4. Click **Create App**
   - App Name: `PayJarvis` (or any name)
   - App Type: **Merchant**
5. After creation, copy:
   - **Client ID** — starts with `AYSq...` or similar
   - **Secret** — visible after clicking "Show"

These are your sandbox credentials. They work against PayPal's test environment — no real money moves.

### Sandbox test accounts

PayPal automatically creates two sandbox accounts:
- **Business** — the seller (receives payments)
- **Personal** — the buyer (makes payments)

You can manage these at **Testing Tools → Sandbox Accounts** in the developer dashboard.

---

## 2. Connect PayPal to PayJarvis

### Option A: Environment variables

Add to your `.env`:

```env
PAYPAL_CLIENT_ID="AYSq..."
PAYPAL_CLIENT_SECRET="EGnH..."
PAYPAL_ENVIRONMENT="sandbox"
```

### Option B: Dashboard API

```bash
curl -X POST https://api.payjarvis.com/payment-methods/paypal/connect \
  -H "Authorization: Bearer <your-auth-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "AYSq...",
    "clientSecret": "EGnH..."
  }'
```

PayJarvis validates the credentials against PayPal's OAuth2 endpoint before saving. If invalid, you'll get a clear error.

Credentials are encrypted with AES-256-GCM before storage — the raw secret is never persisted.

---

## 3. Payment Flow

```
Agent → PayJarvis API → Rules Engine → PayPal Orders API
```

### Step-by-step:

1. **Agent requests payment** via `POST /v1/payments/request`
   - PayJarvis checks agent trust score
   - If score < 400: **BLOCKED** — PayPal is never called
   - If score 400-700: **PENDING_HUMAN** — requires human approval
   - If score > 700 and rules pass: proceeds

2. **PayJarvis creates PayPal order** via `POST /v2/checkout/orders`
   - Returns an `orderId` and `approveUrl`
   - The buyer must approve at the `approveUrl` (PayPal checkout page)

3. **Buyer approves** on PayPal's hosted checkout

4. **PayJarvis captures the order** via `POST /v2/checkout/orders/{id}/capture`
   - Funds are transferred from buyer to merchant
   - Returns a `captureId` for tracking

5. **BDIT token issued** — signed JWT proving the transaction occurred, including agent identity data

### Key difference from Stripe

| | Stripe | PayPal |
|---|---|---|
| Auth | Secret key (`sk_test_...`) | OAuth2 client credentials |
| Payment object | PaymentIntent | Order |
| Capture | Automatic or manual | Always manual (approve → capture) |
| Buyer flow | Card form (embedded) | Redirect to PayPal checkout |
| Refund target | PaymentIntent ID | Capture ID |

---

## 4. Refunds

```bash
# Full refund
POST /v1/payments/{captureId}/refund

# Partial refund
POST /v1/payments/{captureId}/refund
{ "amount": 10.00 }
```

PayJarvis calls `POST /v2/payments/captures/{captureId}/refund` on PayPal's API. Refund status is either `succeeded` (immediate) or `pending` (PayPal processing).

---

## 5. Switch to Live

1. In [developer.paypal.com](https://developer.paypal.com), toggle to **Live**
2. Create a Live app (or use the same app if already created)
3. Complete PayPal's account verification if prompted
4. Update your credentials:

```env
PAYPAL_CLIENT_ID="<live-client-id>"
PAYPAL_CLIENT_SECRET="<live-client-secret>"
PAYPAL_ENVIRONMENT="live"
```

Or reconnect via the API:

```bash
curl -X POST https://api.payjarvis.com/payment-methods/paypal/connect \
  -H "Authorization: Bearer <your-auth-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "<live-client-id>",
    "clientSecret": "<live-client-secret>"
  }'
```

The environment is auto-detected during validation. Live credentials hit `api-m.paypal.com`; sandbox credentials hit `api-m.sandbox.paypal.com`.

---

## 6. Error Handling

PayPal errors are normalized into a consistent format:

```json
{
  "message": "Request is not well-formed",
  "code": "INVALID_REQUEST",
  "provider": "paypal",
  "statusCode": 400
}
```

Common error codes:
- `AUTHENTICATION_FAILURE` — invalid credentials
- `INVALID_REQUEST` — malformed request body
- `UNPROCESSABLE_ENTITY` — business validation failed (e.g., invalid amount)
- `RESOURCE_NOT_FOUND` — order/capture ID doesn't exist
- `ORDER_NOT_APPROVED` — tried to capture before buyer approved

Sensitive data (client secrets, access tokens) is never included in error responses.

---

## 7. Architecture

```
PayPalProvider (paypal.provider.ts)
├── getAccessToken()      — OAuth2 with 60s-early token caching
├── validateCredentials() — test credentials without side effects
├── createPaymentIntent() — creates PayPal order, returns approve URL
├── captureOrder()        — captures approved order, returns capture ID
├── refund()              — full or partial refund via capture ID
├── getAccountStatus()    — connection health check
└── normalizeError()      — structured error formatting
```

The provider follows the same `BasePaymentProvider` interface as Stripe, so switching providers requires no changes to the rest of the codebase.
