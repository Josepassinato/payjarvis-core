<p align="center">
  <img src="docs/assets/payjarvis-logo.png" alt="PayJarvis" width="120" />
  <h1 align="center">PayJarvis</h1>
  <p align="center"><strong>Spending Firewall for AI Agents</strong></p>
  <p align="center">Control what your AI agents spend. Verify who they are. Hand off when they're stuck.</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node"></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.3-blue.svg" alt="TypeScript"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://payjarvis.com/partners"><img src="https://img.shields.io/badge/partners-join%20program-blueviolet.svg" alt="Partner Program"></a>
</p>

---

PayJarvis is an open-source spending control layer for AI agents. Bot owners install the SDK, configure spending policies, and receive real-time Telegram notifications when their agent wants to make a purchase above the auto-approve threshold. Every approved transaction is sealed with a cryptographic **BDIT token** that merchants can independently verify.

## How It Works

```
Bot wants to buy something
        │
        ▼
┌──────────────────┐     ┌──────────────────┐
│   PayJarvis API  │────▶│   Rules Engine    │
│   (port 3001)    │◀────│   (port 3002)     │
└──────────────────┘     └──────────────────┘
        │                 Evaluates 7 rules:
        │                 • Transaction limit
        │                 • Daily/Weekly/Monthly limits
        │                 • Category whitelist/blacklist
        │                 • Merchant whitelist/blacklist
        │                 • Time window restrictions
        │
   ┌────┴────┬──────────┐
   ▼         ▼          ▼
APPROVED  PENDING    BLOCKED
   │      HUMAN        │
   │         │         Trust score
   │         ▼         decreases
   │    ┌─────────┐
   │    │Telegram │
   │    │  Alert  │
   │    └────┬────┘
   │         │
   │    Owner approves
   │    or rejects
   │         │
   ▼         ▼
┌──────────────────┐
│  BDIT Token      │  RS256 JWT, 5-min expiry
│  (one-time use)  │  Merchant verifies via JWKS
└──────────────────┘
```

---

## Certified Bot Seal & KYC Levels

Every bot registered on PayJarvis receives a **Certified Bot Seal** — a machine-verifiable identity badge that merchants can check before accepting payment. The seal reflects the bot's current KYC (Know Your Customer) verification level.

### KYC Levels

| Level | Badge | Requirements | Capabilities |
|-------|-------|-------------|--------------|
| `NONE` | — | Bot registered, no verification | Test mode only, no real transactions |
| `BASIC` | `✓ Basic` | Email verified, valid API key | Up to $50/transaction, $500/month |
| `VERIFIED` | `✓✓ Verified` | Owner identity confirmed (ID + selfie) | Up to $500/transaction, $5,000/month |
| `ENHANCED` | `✓✓✓ Enhanced` | Business entity verified, bank linked | Unlimited (policy-bound) |

The KYC level is embedded in every BDIT token as `kyc_level`, so merchants can enforce minimum verification thresholds:

```typescript
// Merchant-side: reject bots below VERIFIED
if (decoded.kyc_level === 'NONE' || decoded.kyc_level === 'BASIC') {
  return res.status(403).json({ error: 'Minimum KYC level: VERIFIED' });
}
```

### Trust Score

Each bot has a dynamic **Trust Score** (0–100) that adjusts in real-time based on behavior. The score is included in BDIT tokens and visible to merchants.

| Event | Delta |
|-------|-------|
| Transaction approved by rules | +1 |
| Transaction approved by owner | +2 |
| Transaction rejected by owner | -5 |
| Transaction blocked by rules | -3 |
| Handoff resolved successfully | +3 |
| Handoff timeout (no owner response) | -10 |
| Spending anomaly detected | -15 |
| 24h with no violations | +1 |
| KYC level upgraded | +10 |

Merchants can set minimum trust score thresholds:

```typescript
if (decoded.trust_score < 60) {
  return res.status(403).json({ error: 'Trust score too low' });
}
```

---

## Human Handoff System

When a bot encounters an obstacle it can't handle (CAPTCHA, login wall, age verification, complex form), it requests a **Human Handoff**. The owner receives a Telegram notification with context and can resolve the issue.

### How It Works

1. Bot calls `requestHandoff()` with context (URL, screenshot, obstacle type)
2. PayJarvis creates a handoff session and notifies the owner via Telegram
3. Owner resolves the obstacle (via browser extension or dashboard)
4. Bot receives resolution via SSE stream and continues

### SSE Stream

The handoff system uses **Server-Sent Events** for real-time updates — no polling required:

```
GET /api/handoffs/:id/stream
Accept: text/event-stream
X-Bot-Api-Key: pj_bot_...

event: status
data: {"status":"pending","message":"Waiting for owner"}

event: status
data: {"status":"in_progress","message":"Owner is resolving"}

event: resolved
data: {"status":"resolved","resolution":{"action":"captcha_solved","cookies":[...]}}

event: done
data: {"status":"completed"}
```

### Handoff Types

| Type | Description |
|------|-------------|
| `captcha` | CAPTCHA challenge the bot can't solve |
| `login` | Authentication wall requiring credentials |
| `age_verification` | Age gate requiring human confirmation |
| `payment_form` | Complex payment form needing manual input |
| `custom` | Any other obstacle with free-text description |

---

## BDIT Token Specification

The **Bot Digital Identity Token** (BDIT) is an RS256 JWT that cryptographically proves a bot's identity and transaction authorization. Merchants verify tokens using the public JWKS endpoint — no API call to PayJarvis needed.

### Token Payload

```json
{
  "iss": "payjarvis",
  "sub": "bot_abc123",
  "aud": "merchant:amazon.com",
  "iat": 1709654400,
  "exp": 1709654700,
  "jti": "txn_unique_id",
  "bot_name": "ShopperBot",
  "owner_id": "user_xyz",
  "kyc_level": "VERIFIED",
  "trust_score": 87,
  "transaction": {
    "amount": 49.99,
    "currency": "USD",
    "category": "shopping",
    "merchant": "amazon.com",
    "description": "Wireless headphones"
  },
  "approval": {
    "method": "auto",
    "rule": "under_threshold",
    "approved_at": "2026-03-05T14:00:00Z"
  },
  "policy": {
    "max_transaction": 100,
    "daily_limit": 500,
    "monthly_limit": 5000
  }
}
```

### Verification

Merchants verify BDIT tokens in two ways:

1. **JWKS endpoint** (recommended): Fetch public key from `/.well-known/jwks.json` and verify locally
2. **Verify API**: `GET /v1/verify?token=<BDIT_TOKEN>` — returns decoded payload or error

Full specification: **[docs/bdit-spec/BDIT-SPEC.md](docs/bdit-spec/BDIT-SPEC.md)**

---

## Agent SDK

Install the SDK in your AI agent to gate purchases through PayJarvis:

```bash
npm install @payjarvis/agent-sdk
```

### Environment Setup

Add these variables to your `.env` file:

```env
PAYJARVIS_API_KEY=your_api_key_here
PAYJARVIS_BOT_ID=your_bot_id_here
PAYJARVIS_URL=http://localhost:3001
```

### Initialization

```typescript
import { PayJarvis, checkHealth } from '@payjarvis/agent-sdk';

// Recommended — uses environment variables
const pj = PayJarvis.fromEnv();

// Also valid — explicit config (reads from env if not provided)
const pj2 = new PayJarvis({
  baseUrl: 'https://your-api.com',
});

// NEVER hardcode credentials:
// const pj = new PayJarvis({ apiKey: "pj_bot_xxx" })  // throws error
```

### Verifying the Connection

```typescript
import { checkHealth } from '@payjarvis/agent-sdk';

const health = await checkHealth();
if (health.ok) {
  console.log(`PayJarvis online (${health.latencyMs}ms)`);
} else {
  console.error(`PayJarvis unreachable: ${health.status}`);
}
```

### Requesting Approval

```typescript
const decision = await pj.requestApproval({
  merchant: 'Amazon',
  amount: 49.99,
  currency: 'USD',
  category: 'shopping',
  description: 'Wireless headphones',
});

if (decision.approved) {
  completePurchase(decision.bditToken);
} else if (decision.pending) {
  // Owner notified on Telegram — wait via SSE (real-time)
  const final = await pj.waitForApprovalSSE(decision.approvalId!);
  if (final.approved) completePurchase(final.bditToken);
} else {
  console.log('Blocked:', decision.reason);
}
```

### Security

- **Never hardcode** API keys or bot IDs in source code. The SDK will reject known test credentials.
- **Restrict payment commands** to authorized users. For Telegram bots, check `ADMIN_TELEGRAM_ID` before executing `/pagar` or similar commands.
- **Use `.env` files** and add them to `.gitignore`. See `packages/agent-sdk/.env.example` for the template.
- **Rotate API keys** periodically via the PayJarvis dashboard.

### SDK Methods

| Method | Description |
|--------|-------------|
| `requestApproval(req)` | Request approval for a purchase |
| `waitForApproval(id)` | Poll until resolved (2s interval, 5min timeout) |
| `waitForApprovalSSE(id)` | Wait via Server-Sent Events (real-time, recommended) |
| `requestHandoff(req)` | Request human help for an obstacle |
| `handoffStream(id)` | SSE stream for handoff resolution updates |
| `waitForHandoff(id)` | Poll until handoff is resolved |
| `cancelHandoff(id)` | Cancel a pending handoff request |
| `checkLimits()` | Check spending limits and remaining budget |
| `getTrustScore()` | Get current trust score and KYC level |
| `getTransactionHistory(opts)` | Retrieve past transactions (paginated) |

### Handoff Example

```typescript
// Bot encounters a CAPTCHA
const handoff = await pj.requestHandoff({
  type: 'captcha',
  url: 'https://store.example.com/checkout',
  screenshot: base64Screenshot,
  context: 'CAPTCHA appeared during checkout',
});

// Wait for owner resolution via SSE
const resolution = await pj.handoffStream(handoff.handoffId);
// resolution = { action: 'captcha_solved', cookies: [...], localStorage: {...} }
```

---

## Claude / ChatGPT / OpenClaw Integration

PayJarvis works with any AI agent framework. Here are integration examples for popular platforms:

### Claude (Anthropic) — Tool Use

```typescript
const tools = [{
  name: 'purchase_item',
  description: 'Purchase an item after PayJarvis approval',
  input_schema: {
    type: 'object',
    properties: {
      merchant: { type: 'string' },
      amount: { type: 'number' },
      item: { type: 'string' },
    },
    required: ['merchant', 'amount', 'item'],
  },
}];

// In your tool handler:
async function handlePurchase(input) {
  const decision = await pj.requestApproval({
    merchant: input.merchant,
    amount: input.amount,
    category: 'shopping',
    description: input.item,
  });
  return decision;
}
```

### ChatGPT (OpenAI) — Function Calling

```typescript
const functions = [{
  name: 'payjarvis_approve',
  description: 'Request spending approval from PayJarvis before purchasing',
  parameters: {
    type: 'object',
    properties: {
      merchant: { type: 'string', description: 'Merchant name or domain' },
      amount: { type: 'number', description: 'Amount in USD' },
      category: { type: 'string', enum: ['shopping', 'subscription', 'food', 'travel', 'services'] },
    },
    required: ['merchant', 'amount'],
  },
}];
```

### OpenClaw — Native Tools

PayJarvis provides a pre-built tool set for OpenClaw agents:

```typescript
import { PAYJARVIS_OPENCLAW_TOOLS } from '@payjarvis/agent-sdk/openclaw';

const agent = new OpenClawAgent({
  tools: [
    ...PAYJARVIS_OPENCLAW_TOOLS,
    // your other tools...
  ],
});
```

`PAYJARVIS_OPENCLAW_TOOLS` includes:
- `payjarvis_request_approval` — Gate a purchase
- `payjarvis_check_limits` — Query remaining budget
- `payjarvis_request_handoff` — Escalate to human
- `payjarvis_get_trust_score` — Check bot reputation

---

## Browser Extension

The PayJarvis browser extension lets bot owners resolve handoff requests directly in their browser and monitor bot activity in real-time.

### Chrome

```
chrome://extensions → Load unpacked → packages/browser-extension/dist/chrome
```

Or install from the [Chrome Web Store](https://payjarvis.com/chrome) (coming soon).

### Firefox

```
about:debugging → This Firefox → Load Temporary Add-on → packages/browser-extension/dist/firefox/manifest.json
```

### Features

- Real-time handoff notifications with one-click resolve
- CAPTCHA solving relay (bot ↔ owner browser)
- Session/cookie forwarding to bot after auth
- Trust score and spending dashboard popup
- Quick approve/reject pending transactions

---

## Merchant Integrations

### Verify SDK (Multi-Language)

Merchants can verify BDIT tokens server-side in any language:

**JavaScript / TypeScript:**
```bash
npm install @payjarvis/verify-sdk
```
```typescript
import { verifyBDIT } from '@payjarvis/verify-sdk';

const result = await verifyBDIT(token, {
  jwksUrl: 'https://api.payjarvis.com/.well-known/jwks.json',
  minTrustScore: 60,
  minKycLevel: 'VERIFIED',
});

if (result.valid) {
  console.log('Bot:', result.payload.bot_name);
  console.log('Amount:', result.payload.transaction.amount);
}
```

**Python:**
```python
from payjarvis import verify_bdit

result = verify_bdit(token, jwks_url="https://api.payjarvis.com/.well-known/jwks.json")
if result["valid"]:
    print(f"Approved: {result['payload']['transaction']['amount']}")
```

**Go:**
```go
import "github.com/payjarvis/verify-sdk-go"

result, err := payjarvis.VerifyBDIT(token, payjarvis.Options{
    JWKSUrl:      "https://api.payjarvis.com/.well-known/jwks.json",
    MinTrustScore: 60,
})
```

**Ruby:**
```ruby
require 'payjarvis'

result = PayJarvis.verify_bdit(token, jwks_url: 'https://api.payjarvis.com/.well-known/jwks.json')
puts result[:payload][:bot_name] if result[:valid]
```

**PHP:**
```php
use PayJarvis\VerifySDK;

$result = VerifySDK::verifyBDIT($token, [
    'jwks_url' => 'https://api.payjarvis.com/.well-known/jwks.json',
    'min_trust_score' => 60,
]);
```

### Shopify Integration

Add PayJarvis bot verification to your Shopify store:

```liquid
<!-- In your Shopify theme checkout.liquid or via Shopify Functions -->
{% if checkout.attributes.bdit_token %}
  <input type="hidden" name="checkout[attributes][bdit_verified]"
         value="{{ checkout.attributes.bdit_token | payjarvis_verify }}" />
{% endif %}
```

Or use the [Shopify App](https://payjarvis.com/shopify) (coming soon) for zero-code integration:
- Automatic BDIT token verification at checkout
- Configurable minimum trust score and KYC level
- Bot transaction dashboard in Shopify admin
- Webhook notifications for bot purchases

### WooCommerce Integration

```php
// In your theme's functions.php or a custom plugin
add_action('woocommerce_checkout_process', function() {
    $token = $_POST['bdit_token'] ?? null;
    if ($token) {
        $result = PayJarvis\VerifySDK::verifyBDIT($token);
        if (!$result['valid']) {
            wc_add_notice('Invalid bot authorization token.', 'error');
        }
    }
});
```

Or install the [WooCommerce Plugin](https://payjarvis.com/woocommerce) (coming soon).

---

## API Reference

### Bot Authentication (`X-Bot-Api-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bots/:id/request-payment` | Request payment approval |
| GET | `/approvals/:id/status` | Poll approval status |
| GET | `/approvals/stream/bot` | SSE stream for real-time approval updates |
| GET | `/bots/:id/limits/sdk` | Check spending limits and remaining budget |
| POST | `/bots/:id/request-handoff` | Request human handoff |
| GET | `/handoffs/:id/status` | Poll handoff status |
| GET | `/handoffs/:id/stream` | SSE stream for handoff resolution |
| GET | `/bots/:id/trust-score` | Get current trust score and KYC level |

### User Authentication (Clerk Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bots` | Create bot (returns API key once) |
| GET | `/bots` | List all bots |
| GET | `/bots/:id` | Get bot details with policy |
| PATCH | `/bots/:id` | Update bot settings |
| PATCH | `/bots/:id/status` | Change status (active / paused / revoked) |
| POST | `/bots/:id/policy` | Create or update spending policy |
| POST | `/bots/:id/kyc` | Submit KYC verification documents |
| GET | `/approvals` | List pending approvals |
| POST | `/approvals/:id/respond` | Approve or reject a pending transaction |
| GET | `/handoffs` | List pending handoff requests |
| POST | `/handoffs/:id/resolve` | Resolve a handoff with result data |
| GET | `/transactions` | List transactions (paginated, filterable) |
| GET | `/transactions/export/pdf` | Export transactions as PDF report |
| GET | `/analytics/spending-trends` | 30-day spending trend chart data |
| GET | `/analytics/by-category` | Spending breakdown by category |
| GET | `/analytics/by-bot` | Spending breakdown by bot |
| POST | `/notifications/telegram/link` | Generate Telegram account link code |

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/.well-known/jwks.json` | BDIT public key (JWKS format) |
| GET | `/v1/verify` | Verify a BDIT token |
| GET | `/v1/bot/:id/seal` | Get bot's Certified Seal (public profile) |

---

## Architecture

```
payjarvis/
├── apps/
│   ├── api/                # Fastify REST API (port 3001)
│   ├── rules-engine/       # Policy decision engine (port 3002)
│   ├── web/                # Next.js dashboard (port 3000)
│   └── browser-agent/      # CDP proxy for closed platforms
├── packages/
│   ├── agent-sdk/          # SDK for bot owners (TypeScript)
│   ├── merchant-sdk/       # SDK for merchants
│   ├── bdit/               # BDIT token issuance & verification
│   ├── browser-extension/  # Chrome + Firefox extension
│   ├── database/           # Prisma schema + client
│   ├── plugins/            # Plugin system for custom rules
│   ├── types/              # Shared TypeScript types
│   └── verify-sdk/         # Multi-language token verification
├── infra/                  # Nginx configs, Docker setup
└── docs/                   # BDIT specification, assets
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Fastify 5, TypeScript, Node.js 18+ |
| Frontend | Next.js 14, React 18, Tailwind CSS, shadcn/ui |
| Database | PostgreSQL 16 via Prisma ORM |
| Cache | Redis 7 (with in-memory fallback) |
| Auth | Clerk (users), API keys (bots), KYC (identity) |
| Crypto | RS256 JWT via jose library |
| Notifications | Telegram Bot API |
| Streaming | Server-Sent Events (SSE) |
| Monorepo | npm workspaces + Turborepo |
| Deployment | Docker Compose, PM2, Nginx |

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ (or [Supabase](https://supabase.com) free tier)
- Redis 7+ (or [Upstash](https://upstash.com) free tier)
- [Clerk](https://clerk.com) account (free tier works)

### Option A: Docker Compose (recommended)

```bash
git clone https://github.com/Josepassinato/Payjarvis.git
cd Payjarvis
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

Services:
- Dashboard: `http://localhost:3000`
- API: `http://localhost:3001`
- Rules Engine: `http://localhost:3002`

### Option B: Local Development

```bash
git clone https://github.com/Josepassinato/Payjarvis.git
cd Payjarvis
npm install
cp .env.example .env

# Generate BDIT RS256 keys
openssl genrsa 2048 > /tmp/private.pem
openssl rsa -in /tmp/private.pem -pubout > /tmp/public.pem
# Copy key contents into .env (use \n for newlines)

# Database setup
npm run db:generate
npx --workspace=packages/database prisma db push

# Build and run
npm run build
npm run dev
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DIRECT_URL` | Yes | Direct PostgreSQL connection (for migrations) |
| `REDIS_URL` | No | Redis connection. Falls back to in-memory |
| `CLERK_SECRET_KEY` | Yes* | Clerk secret key (*empty = dev mode with auth bypass) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `PAYJARVIS_PRIVATE_KEY` | Yes | RS256 private key (PEM, `\n` for newlines) |
| `PAYJARVIS_PUBLIC_KEY` | Yes | RS256 public key (PEM) |
| `PAYJARVIS_KEY_ID` | No | Key ID for JWKS rotation. Default: `payjarvis-key-2026-03` |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for notifications |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret for validating Telegram webhooks |
| `STRIPE_SECRET_KEY` | No | Stripe secret key (future) |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `RESEND_API_KEY` | No | Resend API key for email notifications |
| `API_PORT` | No | API port. Default: `3001` |
| `RULES_ENGINE_PORT` | No | Rules engine port. Default: `3002` |
| `RULES_ENGINE_URL` | No | Rules engine URL. Default: `http://localhost:3002` |
| `NEXT_PUBLIC_API_URL` | No | Public API URL. Default: `http://localhost:3001` |
| `WEB_URL` | No | Dashboard URL. Default: `http://localhost:3000` |
| `NODE_ENV` | No | `development` or `production` |

---

## Production Deployment

### With PM2

```bash
npm run build
cd packages/database && npx prisma db push && cd ../..
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
pm2 start ecosystem.config.cjs
```

### With Docker Compose

```bash
cp .env.example .env.production
docker compose --env-file .env.production up -d
./ssl-setup.sh your-domain.com admin@your-domain.com
```

### Nginx

Example config in `infra/nginx/`:
- `/api/*` → API (port 3001)
- `/v1/*` → Public identity endpoints
- `/.well-known/jwks.json` → BDIT public key
- `/` → Next.js dashboard (port 3000)
- SSE support for `/api/approvals/stream` and `/api/handoffs/*/stream`
- Rate limiting (30 req/s API, 60 req/s general)

---

## Free Early Access

PayJarvis is free and open-source. For the hosted version at **payjarvis.com**, use coupon code:

```
JARVIS2026
```

This gives you **free early access** to the managed platform, including:
- Hosted API and dashboard (no infra to manage)
- 10 bots, 1,000 transactions/month
- Telegram notifications
- BDIT token issuance and JWKS hosting
- KYC verification up to VERIFIED level

[Get Started Free →](https://payjarvis.com/signup?coupon=JARVIS2026)

---

## Partner Program

Integrate PayJarvis into your platform and earn revenue share on bot transactions.

[![Become a Partner](https://img.shields.io/badge/PayJarvis-Become%20a%20Partner-blueviolet?style=for-the-badge)](https://payjarvis.com/partners)

Partner benefits:
- Co-branded Certified Bot Seal
- Revenue share on transaction fees
- Priority support and custom SLAs
- Early access to new features
- Listed on PayJarvis partner directory

---

## Roadmap

- [ ] Stripe payment processing integration
- [ ] Email notifications via Resend
- [ ] WHOOP/wearable integration for owner verification
- [ ] Multi-currency support
- [ ] Webhook delivery for merchant events
- [ ] Plugin system for custom rules
- [ ] Mobile app for approvals (iOS + Android)
- [ ] OpenTelemetry observability
- [ ] GraphQL API
- [ ] End-to-end test suite

See [open issues](https://github.com/Josepassinato/Payjarvis/issues) for community-requested features.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For reporting vulnerabilities, see [SECURITY.md](SECURITY.md). Do not open public issues for security concerns.

## License

Licensed under the [Apache License 2.0](LICENSE).

---

<p align="center">
  <sub>Built by <a href="https://12brain.org"><strong>12BRAIN</strong></a> — Miami / Lisbon / Sao Paulo</sub>
</p>
<p align="center">
  <sub>Copyright 2026 PayJarvis Contributors.</sub>
</p>
