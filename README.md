<p align="center">
  <h1 align="center">PayJarvis</h1>
  <p align="center">Spending Firewall for AI Agents</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node"></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.3-blue.svg" alt="TypeScript"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
</p>

---

Control what your AI agents can spend. Set limits, approve purchases in real-time, get Telegram alerts.

PayJarvis is an open-source spending control layer for AI agents. Bot owners install the SDK, configure spending policies, and receive real-time notifications when their agent wants to make a purchase above the auto-approve threshold. Every approved transaction is sealed with a cryptographic **BDIT token** that merchants can independently verify.

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
│  (one-time use)  │  Merchant verifies independently
└──────────────────┘
```

## Features

- **Spending Policies** — Per-transaction, daily, weekly, and monthly limits
- **Smart Approval** — Auto-approve small purchases, require human approval for large ones
- **Telegram Notifications** — Instant alerts with inline approve/reject buttons
- **Human Handoff** — Bots can request human help for obstacles (CAPTCHA, auth walls)
- **BDIT Tokens** — Cryptographic proof of authorized transactions ([spec](docs/bdit-spec/BDIT-SPEC.md))
- **Trust Scoring** — Dynamic score (0-100) that adjusts based on bot behavior
- **Analytics Dashboard** — Spending trends, category breakdown, approval rates
- **Audit Trail** — Append-only log of every action for compliance
- **Merchant SDK** — Let merchants verify bot identity and transaction authorization

## Architecture

```
payjarvis/
├── apps/
│   ├── api/              # Fastify REST API (port 3001)
│   ├── rules-engine/     # Policy decision engine (port 3002)
│   ├── web/              # Next.js dashboard (port 3000)
│   └── browser-agent/    # CDP proxy for closed platforms
├── packages/
│   ├── agent-sdk/        # SDK for bot owners
│   ├── merchant-sdk/     # SDK for merchants
│   ├── bdit/             # BDIT token issuance & verification
│   ├── database/         # Prisma schema + client
│   ├── types/            # Shared TypeScript types
│   └── verify-sdk/       # Client-side token verification
├── infra/                # Nginx configs, Docker setup
└── docs/                 # BDIT specification
```

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

# Configure environment
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)

# Start everything
docker compose up -d
```

Services will be available at:
- Dashboard: http://localhost:3000
- API: http://localhost:3001
- Rules Engine: http://localhost:3002

### Option B: Local Development

```bash
git clone https://github.com/Josepassinato/Payjarvis.git
cd Payjarvis

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Generate BDIT RS256 keys
openssl genrsa 2048 > /tmp/private.pem
openssl rsa -in /tmp/private.pem -pubout > /tmp/public.pem
# Copy the key contents into PAYJARVIS_PRIVATE_KEY and PAYJARVIS_PUBLIC_KEY in .env
# Use \n to represent newlines in the .env file

# Generate Prisma client and push schema
npm run db:generate
npx --workspace=packages/database prisma db push

# Build all packages
npm run build

# Start development (all services)
npm run dev
```

### Clerk Setup

1. Create a free account at [clerk.com](https://clerk.com)
2. Create an application
3. Copy the **Publishable Key** (`pk_test_...`) and **Secret Key** (`sk_test_...`)
4. Set them in your `.env`:
   ```
   CLERK_SECRET_KEY="sk_test_..."
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
   ```

> **Dev mode**: If `CLERK_SECRET_KEY` is empty or set to `sk_test_placeholder`, the API runs in dev mode with auth bypass. The web dashboard still requires valid Clerk keys.

## Agent SDK

Install the SDK in your AI agent to gate purchases through PayJarvis:

```typescript
import { PayJarvis } from '@payjarvis/agent-sdk';

const pj = new PayJarvis({
  apiKey: 'pj_bot_...',   // From dashboard
  botId: 'your-bot-id',
  baseUrl: 'https://your-api.com',
});

// Before any purchase
const decision = await pj.requestApproval({
  merchant: 'Amazon',
  amount: 49.99,
  category: 'shopping',
});

if (decision.approved) {
  completePurchase(decision.bditToken);
} else if (decision.pending) {
  // Owner notified on Telegram — wait for approval
  const final = await pj.waitForApproval(decision.approvalId!);
} else {
  console.log('Blocked:', decision.reason);
}
```

### SDK Methods

| Method | Description |
|--------|-------------|
| `requestApproval(req)` | Request approval for a purchase |
| `waitForApproval(id)` | Poll until resolved (2s interval, 5min timeout) |
| `waitForApprovalSSE(id)` | Wait via Server-Sent Events (real-time) |
| `requestHandoff(req)` | Request human help for an obstacle |
| `waitForHandoff(id)` | Poll until handoff is resolved |
| `cancelHandoff(id)` | Cancel a pending handoff |
| `checkLimits()` | Check spending limits and remaining budget |

## Telegram Notifications

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN` in your `.env`
3. Configure the webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/notifications/telegram/webhook"
   ```
4. Link your account in the dashboard (Bot Settings > Notifications)

## API Endpoints

### Bot Authentication (`X-Bot-Api-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bots/:id/request-payment` | Request payment approval |
| GET | `/approvals/:id/status` | Poll approval status |
| GET | `/approvals/stream/bot` | SSE stream for real-time updates |
| GET | `/bots/:id/limits/sdk` | Check spending limits |
| POST | `/bots/:id/request-handoff` | Request human help |
| GET | `/handoffs/:id/status` | Check handoff status |

### User Authentication (Clerk Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bots` | Create bot (returns API key once) |
| GET | `/bots` | List bots |
| GET | `/bots/:id` | Get bot with policy |
| PATCH | `/bots/:id` | Update bot |
| PATCH | `/bots/:id/status` | Change status (active/paused/revoked) |
| POST | `/bots/:id/policy` | Upsert spending policy |
| GET | `/approvals` | List pending approvals |
| POST | `/approvals/:id/respond` | Approve or reject |
| GET | `/transactions` | List transactions (paginated, filterable) |
| GET | `/transactions/export/pdf` | Export as PDF |
| GET | `/analytics/spending-trends` | 30-day spending chart data |
| GET | `/analytics/by-category` | Spending by category |
| GET | `/analytics/by-bot` | Spending by bot |
| POST | `/notifications/telegram/link` | Generate Telegram link code |

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/.well-known/jwks.json` | BDIT public key (JWKS) |
| GET | `/v1/verify` | Verify a BDIT token |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (with pgbouncer for Supabase) |
| `DIRECT_URL` | Yes | Direct PostgreSQL connection (for migrations) |
| `REDIS_URL` | No | Redis connection string. Falls back to in-memory if not set |
| `CLERK_SECRET_KEY` | Yes* | Clerk secret key. *Empty = dev mode with auth bypass on API |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (required for web dashboard) |
| `PAYJARVIS_PRIVATE_KEY` | Yes | RS256 private key (PEM format, `\n` for newlines) |
| `PAYJARVIS_PUBLIC_KEY` | Yes | RS256 public key (PEM format) |
| `PAYJARVIS_KEY_ID` | No | Key ID for JWKS rotation. Default: `payjarvis-key-2026-03` |
| `STRIPE_SECRET_KEY` | No | Stripe secret key (future payment processing) |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for notifications |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret for validating Telegram webhooks |
| `RESEND_API_KEY` | No | Resend API key for email notifications |
| `API_PORT` | No | API server port. Default: `3001` |
| `RULES_ENGINE_PORT` | No | Rules engine port. Default: `3002` |
| `RULES_ENGINE_URL` | No | Rules engine URL. Default: `http://localhost:3002` |
| `NEXT_PUBLIC_API_URL` | No | Public API URL for frontend. Default: `http://localhost:3001` |
| `WEB_URL` | No | Web dashboard URL. Default: `http://localhost:3000` |
| `NODE_ENV` | No | `development` or `production` |

## Production Deployment

### With PM2

```bash
# Build everything
npm run build

# Push database schema
cd packages/database && npx prisma db push && cd ../..

# Copy Next.js static files
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public

# Start with PM2
pm2 start ecosystem.config.cjs
```

### With Docker Compose

```bash
# Set up environment
cp .env.example .env.production
# Edit .env.production with production values

# Start services
docker compose --env-file .env.production up -d

# Set up SSL (optional)
./ssl-setup.sh your-domain.com admin@your-domain.com
```

### Nginx Reverse Proxy

An example Nginx configuration is provided in `infra/nginx/`. It includes:
- `/api/*` → API backend (port 3001)
- `/v1/*` → Public identity endpoints
- `/.well-known/jwks.json` → BDIT public key
- `/` → Next.js dashboard (port 3000)
- SSE support for `/api/approvals/stream`
- Rate limiting (30 req/s API, 60 req/s general)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Fastify 5, TypeScript |
| Frontend | Next.js 14, React 18, Tailwind CSS |
| Database | PostgreSQL 16 via Prisma ORM |
| Cache | Redis 7 (with in-memory fallback) |
| Auth | Clerk (users), API keys (bots) |
| Crypto | RS256 JWT via jose library |
| Notifications | Telegram Bot API |
| Monorepo | npm workspaces + Turborepo |
| Deployment | Docker Compose, PM2, Nginx |

## BDIT Token Specification

The Bot Digital Identity Token (BDIT) is an RS256 JWT that cryptographically proves a bot's identity and transaction authorization. Merchants verify tokens using the public JWKS endpoint — no API call to PayJarvis needed.

Read the full specification: **[docs/bdit-spec/BDIT-SPEC.md](docs/bdit-spec/BDIT-SPEC.md)**

## Roadmap

- [ ] Stripe payment processing integration
- [ ] Email notifications via Resend
- [ ] WHOOP/wearable integration for owner verification
- [ ] Multi-currency support
- [ ] Webhook delivery for merchant events
- [ ] Rate limiting per bot
- [ ] Plugin system for custom rules
- [ ] Mobile app for approvals
- [ ] OpenTelemetry observability
- [ ] End-to-end test suite

See [open issues](https://github.com/Josepassinato/Payjarvis/issues) for community-requested features.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For reporting vulnerabilities, see [SECURITY.md](SECURITY.md). Do not open public issues for security concerns.

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 PayJarvis Contributors.
