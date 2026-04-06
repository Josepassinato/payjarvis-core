# Project: PayJarvis (B2B) / SnifferShop (B2C)
AI spending firewall and agentic commerce platform. Autonomous AI agents search, compare, and purchase for users with governance layers.

## Session Continuity
- **SEMPRE LER PRIMEIRO**: `/root/Payjarvis/.planning/SESSION-NOTES.md`
- Contém: última sessão, estado atual, pendências, contexto
- **SEMPRE ATUALIZAR** ao final de cada sessão significativa

## Rebranding (2026-04-02)
- B2C user-facing: "Jarvis" → "Sniffer", "PayJarvis" → "SnifferShop"
- B2B backend/code: mantém "PayJarvis" (variáveis, rotas, imports, URLs)
- Emoji: 🦀 → 🐕 em mensagens user-facing
- Cores Sniffer: laranja #ff6b2b + warm tones
- System prompts Gemini/Grok: ainda usam "Jarvis" internamente (migração futura)

## Tech Stack
- Turborepo monorepo at /root/Payjarvis/
- Fastify API (3001), Rules Engine (3002), Next.js Dashboard (3000), Browser Agent (3003)
- OpenClaw Telegram bot at /root/openclaw/ — grammY + Gemini 2.5 Flash
- PostgreSQL, Redis, Clerk auth, Stripe payments, PM2, Nginx
- VPS: Hostinger 76.13.109.151 Ubuntu 24.04
- BrowserBase (Stagehand) for browser automation, AES-256 cookie encryption

## Two Paths
- Caminho A (B2B): Governance API middleware for developers
- Caminho B (B2C): Managed agent via Telegram/WhatsApp

## Conventions
- Sandbox-first: never edit production directly
- Diagnostic-first: research before code changes
- Playwright E2E suite (29/29) for regression
- Never use prisma db push --accept-data-loss (drops raw SQL tables)
- Keep openclaw_conversations, openclaw_user_facts, openclaw_reminders in Prisma schema
- Bash heredoc for claude mcp add (em-dashes cause silent failures)
- Ground truth for MCPs is /root/.claude.json (claude mcp list returns nothing)
- BrowserBase live view: use client.sessions.debug() debuggerFullscreenUrl only

## Security
- No secrets in code or logs. Rotate exposed keys immediately
- AES-256 for stored credentials. Clerk for auth, never custom
- Service role keys only in edge functions, never client-side

## Key Commerce Integrations
- Stripe: user's shopping card (not service fees). Issuing/Shared Tokens pending
- Amazon: checkout via cards already saved in user's Amazon account
- Amadeus (hotels/flights), Yelp, Ticketmaster, Mercado Libre, eBay, Google Places
- Visa Click to Pay/X-Pay Token + Mastercard Buyer Payment Agent (Increase Trainer Inc EIN 87-1490358)
- PayPal 95% done (missing credentials)
- A2A Protocol (Google): future agent-to-agent commerce

## Audio Pipeline
Gemini TTS → ElevenLabs → edge-tts fallback. Voice-in/voice-out rule on all bots.

## Bot Config
- Public: @Jarvis12Brain_bot | Admin: @JPvisionIA_bot (13 admin commands)
- Multi-tenant: system prompts, chat history, bot tokens isolated per botId
- LLM credit system: free tier + recharge packs, $20/month Stripe subscription

## Architecture Flow
User (Telegram/WhatsApp) → OpenClaw → Fastify API → Rules Engine (limits/approvals) → Commerce APIs + Browser Agent → PostgreSQL/Redis → Response

## Testing
- Playwright E2E: 29/29 passing
- Always test before deploy, never skip regression

## Legal Risks (Active)
Privacy policy gaps, browser automation ToS concerns, potential money transmitter status — compliance dossier covers 6 critical risks

---

# PayJarvis — Mapa Semantico do Codebase

> Referencia completa de rotas, servicos, modelos, configuracao e debug. Reconstruido em 2026-03-22 via varredura automatica do codebase.

## Arquitetura do Monorepo

```
/root/Payjarvis/
├── apps/
│   ├── api/                 # Fastify API (port 3001)
│   ├── web/                 # Next.js Dashboard (port 3000)
│   ├── admin/               # Admin Dashboard (port 3005)
│   ├── rules-engine/        # Rules Engine (port 3002)
│   └── browser-agent/       # Browser Automation (port 3003)
├── packages/
│   ├── database/            # Prisma ORM + schema
│   ├── types/               # TypeScript enums & interfaces
│   ├── bdit/                # BDIT token signing (RS256/jose)
│   ├── agent-sdk/           # SDK para devs externos
│   ├── verify-sdk/          # Token verification
│   ├── merchant-sdk/        # SDK para merchants
│   ├── browser-extension/   # Chrome extension (checkout overlay)
│   └── plugins/             # Commerce plugins (shopify, woocommerce)
├── infra/nginx/             # Nginx reverse proxy configs
├── scripts/                 # Deploy & smoke-test scripts
├── certs/                   # SSL certificates
└── docs/                    # Documentation
```

### Turbo Pipeline (turbo.json)
| Task | Dependencies | Outputs | Cache |
|------|-------------|---------|-------|
| `build` | `^build` | `dist/**, .next/**` | Yes |
| `dev` | None | N/A | No (persistent) |
| `test` | `build` | N/A | No |
| `db:generate` | None | N/A | No |
| `db:push` | None | N/A | No |

---

## Rotas da API (apps/api/src/routes/)

### Health & Public

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/health` | None | Health check |
| GET | `/.well-known/jwks.json` | None | JWKS public keys (BDIT verification) |
| GET | `/api/users/:telegramId` | None | Resolve user by Telegram ID |
| PUT | `/api/users/:telegramId/location` | Internal Secret | Update user GPS |

### Auth & Identity

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/v1/agents/:agentId/verify` | None | Public agent verification |
| GET | `/api/agents/:agentId` | Clerk JWT | Get agent details |
| POST | `/api/agents/:agentId/token` | Clerk JWT | Issue Agent Identity Token (AIT) |
| POST | `/api/bots/:botId/agent-token` | Bot API Key | Issue AIT via bot key |
| GET | `/api/agents` | Clerk JWT | List user's agents |
| POST | `/users/kyc` | Clerk JWT | Update KYC info |

### Bots

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/bots` | Clerk JWT | Create bot + auto-create policy |
| GET | `/api/bots` | Clerk JWT | List user's bots |
| GET | `/api/bots/:botId` | Clerk JWT | Bot details |
| PATCH | `/api/bots/:botId` | Clerk JWT | Update bot config |
| PATCH | `/api/bots/:botId/status` | Clerk JWT | Change status (ACTIVE/PAUSED/REVOKED) |
| DELETE | `/api/bots/:botId` | Clerk JWT | Delete bot |
| GET | `/api/bots/:botId/limits` | Clerk JWT | Policy limits (dashboard) |
| GET | `/api/bots/:botId/limits/sdk` | Bot API Key | Policy limits (SDK) |
| GET | `/api/bots/:botId/reputation` | Clerk JWT | Bot reputation (dashboard) |
| GET | `/api/bots/:botId/reputation/sdk` | Bot API Key | Bot reputation (SDK) |

### Telegram

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/bots/:botId/telegram/connect` | Clerk JWT | Link Telegram bot |
| POST | `/api/bots/:botId/telegram/disconnect` | Clerk JWT | Unlink Telegram bot |
| GET | `/api/bots/:botId/telegram/status` | Clerk JWT | Connection status |
| POST | `/api/bots/:botId/telegram/webhook` | Bot Auth | Receive Telegram updates |

### Payments & Transactions

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/bots/:botId/request-payment` | Bot API Key | Core payment decision flow |
| GET | `/api/transactions` | Clerk JWT | List transactions (pagination, filters) |
| POST | `/api/transactions/export/pdf` | Clerk JWT | Export as PDF |

### Approvals

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/approvals` | Clerk JWT | List approval requests |
| GET | `/api/approvals/stream` | Clerk JWT | SSE stream (dashboard) |
| GET | `/api/approvals/stream/bot` | Bot API Key | SSE stream (bot) |
| POST | `/api/approvals/:id/respond` | Clerk JWT | Approve/reject |
| GET | `/api/approvals/:id/status` | Bot API Key | Check status |

### Handoffs

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/bots/:botId/request-handoff` | Bot API Key | Request human escalation |
| GET | `/api/handoffs/:id/status` | Bot API Key | Check handoff status |
| POST | `/api/handoffs/:id/resolve` | Clerk JWT | Resolve handoff |
| POST | `/api/handoffs/:id/cancel` | Bot API Key | Cancel handoff |
| POST | `/api/handoffs/:id/in-progress` | Clerk JWT | Mark in-progress |
| GET | `/api/handoffs/stream/bot` | Bot API Key | SSE stream |
| GET | `/api/handoffs` | Clerk JWT | List handoffs |

### BDIT Tokens & Merchant

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/bdit/status/:jti` | None | Check BDIT token status |
| POST | `/merchant/confirm` | None (Redis gate) | Merchant confirms token use |
| GET | `/adapter.js` | None | PayJarvis merchant adapter script |

### Core Governance

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/core/policy/:botId` | Clerk JWT | Get policy + trust level |
| PUT | `/api/core/policy/:botId` | Clerk JWT | Update policy |
| GET | `/api/core/approvals/:botId` | Clerk JWT | List bot approvals |
| POST | `/api/core/approvals/:id/approve` | Clerk JWT | Approve via core API |
| POST | `/api/core/approvals/:id/reject` | Clerk JWT | Reject via core API |
| GET | `/api/core/audit/:botId` | Clerk JWT | Audit log |
| GET | `/api/core/audit/:botId/export` | Clerk JWT | Export audit JSON |
| POST | `/api/core/execute` | Clerk JWT | Execute action (SEARCH/BOOK/PURCHASE) |
| GET | `/api/core/sessions/:sessionId` | Clerk JWT | Session context |

### Analytics

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/analytics/spending-trends` | Clerk JWT | Spending over time |
| GET | `/api/analytics/by-category` | Clerk JWT | Spending by category |
| GET | `/api/analytics/decisions` | Clerk JWT | APPROVED/BLOCKED/PENDING breakdown |
| GET | `/api/analytics/by-bot` | Clerk JWT | Per-bot metrics |

### Commerce — Travel

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/commerce/flights/search` | Any | Amadeus flights |
| POST | `/api/commerce/hotels/search` | Any | Amadeus hotels |
| POST | `/api/commerce/restaurants/search` | Any | Yelp restaurants |
| POST | `/api/commerce/events/search` | Any | Ticketmaster events |
| POST | `/api/commerce/products/search` | Any | Mercado Libre + eBay |
| GET | `/flights/search` | Any | Flight search (direct) |
| GET | `/hotels/search` | Any | Hotel search (direct) |
| GET | `/hotels/:id` | Any | Hotel details |
| POST | `/hotels/:id/book` | Any | Hotel booking stub |
| GET | `/restaurants/search` | Any | Restaurant search (direct) |
| GET | `/events/search` | Any | Event search (direct) |
| GET | `/products/search` | Any | Product search (direct) |

### Commerce — Retail

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/retail/search` | Any | Multi-platform product search |
| POST | `/api/retail/compare` | Any | Cross-retailer price comparison |
| GET | `/api/retail/stores/:zip` | Any | Nearby retail stores |
| POST | `/api/retail/rx/status` | Any | Prescription status (CVS/Walgreens) |
| POST | `/api/retail/clinic/book` | Any | MinuteClinic appointment |
| GET | `/api/retail/deals/:zip` | Any | Weekly deals |
| POST | `/api/retail/target/search` | Any | Target search |
| GET | `/api/retail/target/stores/:zip` | Any | Target stores |
| POST | `/api/retail/publix/search` | Any | Publix search |
| GET | `/api/retail/publix/bogo/:zip` | Any | Publix BOGO deals |
| POST | `/api/retail/macys/search` | Any | Macy's search |
| GET | `/api/retail/macys/sales` | Any | Macy's sales |

### Commerce — Transit

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/transit/search` | Any | All transit options |
| POST | `/api/transit/compare` | Any | Transit vs flight comparison |
| GET | `/api/transit/stations` | Any | Amtrak + bus stations |
| GET | `/api/transit/status/:train` | Any | Amtrak train status |
| POST | `/api/transit/book` | Any | Book train/bus |

### Payment Methods & Subscriptions

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/payment-methods` | Clerk JWT | Add payment method |
| GET | `/api/payment-methods` | Clerk JWT | List payment methods |
| GET | `/api/payment-methods/:provider` | Clerk JWT | Provider status |
| POST | `/api/payment-methods/stripe/connect` | Clerk JWT | Connect Stripe |
| POST | `/api/payment-methods/paypal/connect` | Clerk JWT | Connect PayPal |
| POST | `/api/payment-methods/setup-intent` | Clerk JWT | Create SetupIntent |
| POST | `/api/payment-methods/setup-intent/confirm` | Clerk JWT | Confirm SetupIntent |
| POST | `/api/subscription/create` | Clerk JWT | Create $20/month sub |
| GET | `/api/subscription/status` | Clerk JWT | Subscription status |
| POST | `/api/subscription/cancel` | Clerk JWT | Cancel subscription |
| POST | `/api/subscription/portal` | Clerk JWT | Stripe portal URL |

### Visa & Mastercard

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/visa/status` | None | Visa integration health |
| GET | `/api/visa/sdk-config` | Clerk JWT | SDK init config |
| POST | `/api/visa/checkout` | Clerk JWT | Decrypt JWE payload |
| GET | `/api/mastercard/status` | None | Mastercard status |
| POST | `/api/mastercard/tokenize` | Clerk JWT | FPAN to DPAN |
| POST | `/api/mastercard/payment` | Clerk JWT | Execute payment |
| GET | `/api/mastercard/token/:ref` | Clerk JWT | Token status |
| DELETE | `/api/mastercard/token/:ref` | Clerk JWT | Revoke token |
| POST | `/api/webhooks/mastercard` | None | Mastercard webhook |

### Vault — Amazon & Zero-Knowledge

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/vault/amazon/connect` | Any | Start Amazon login (BrowserBase) |
| POST | `/api/vault/amazon/connect-link` | Clerk JWT | Generate JWT link for Telegram |
| GET | `/api/vault/amazon/status/:userId` | Any | Session status |
| POST | `/api/vault/amazon/verify/:userId` | Any | Verify session |
| DELETE | `/api/vault/amazon/disconnect/:userId` | Clerk JWT | Remove session |
| GET | `/api/vault/sessions/:userId` | Clerk JWT | List connected providers |
| POST | `/api/vault/zk/setup` | Clerk JWT | Setup zero-knowledge PIN |
| POST | `/api/vault/zk/store` | Clerk JWT | Store AES-256 encrypted creds |
| POST | `/api/vault/zk/retrieve` | Clerk JWT | Retrieve encrypted creds |
| POST | `/api/vault/zk/verify` | Clerk JWT | Verify PIN |
| POST | `/api/vault/zk/change-pin` | Clerk JWT | Change PIN |
| GET | `/api/vault/zk/items/:userId` | Clerk JWT | List stored items |
| POST | `/api/vault/amazon/login` | Any | Initiate Amazon browser login |
| POST | `/api/vault/amazon/login-input/:sessionId` | Any | Input data during login |
| GET | `/api/vault/amazon/login-screenshot/:sessionId` | Any | Screenshot during login |
| GET | `/api/vault/amazon/login-status/:sessionId` | Any | Login progress |
| POST | `/api/vault/amazon/start-live-login` | Any | Start live-view session |
| GET | `/api/vault/amazon/check-live-login/:bbContextId` | Any | Check live session |
| POST | `/api/vault/amazon/capture` | Any | Capture creds from live session |
| POST | `/api/vault/amazon/verify-token` | Any | Verify Amazon session token |

### Amazon Checkout

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/amazon/checkout/start` | Any | Initiate checkout via vault |
| POST | `/api/amazon/checkout/check-session` | Any | Check vault session |
| POST | `/api/amazon/checkout/confirm` | Any | Confirm purchase |
| GET | `/api/amazon/checkout/pending-product` | Any | Product pending checkout |
| GET | `/api/amazon/checkout/:orderId` | Any | Order details |
| POST | `/api/amazon/search` | Any | Search Amazon products |

### Package Tracking

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/tracking/:code` | Any | Track package (USPS/FedEx/DHL/UPS) |
| POST | `/api/tracking/watch` | Clerk JWT | Start watching package |
| GET | `/api/tracking/watch/:code` | Clerk JWT | Watch status |
| GET | `/api/tracking/watched` | Clerk JWT | List watched packages |

### Instance Management (OpenClaw Load Balancing)

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/instances` | Clerk JWT | List all instances |
| GET | `/api/instances/my` | Clerk JWT | User's assigned instance |
| POST | `/api/instances/assign` | Clerk JWT | Assign/rebalance |
| DELETE | `/api/instances/my` | Clerk JWT | Release instance |
| POST | `/api/instances/spawn` | Clerk JWT | Spawn new process |
| DELETE | `/api/instances/:id` | Clerk JWT | Delete instance |
| POST | `/api/instances/:id/deactivate` | Clerk JWT | Deactivate |
| GET | `/api/instances/:id/full` | Clerk JWT | Full instance status |
| GET | `/api/instances/route` | Clerk JWT | Route to instance |
| GET | `/api/instances/route/bot/:botId` | Bot API Key | Route bot |
| GET | `/api/instances/capacity` | Clerk JWT | Global capacity stats |

### Bot Sharing & Cloning

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/bots/:botId/share` | Clerk JWT | Generate share link + QR |
| GET | `/api/share/:code` | None | Shared bot preview |
| POST | `/api/share/:code/clone` | Clerk JWT | Clone bot |
| GET | `/api/share/:code/qr` | None | QR code image |
| DELETE | `/api/share/:code` | Clerk JWT | Revoke share link |

### Notifications

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/notifications/telegram/link` | Clerk JWT | Generate 6-digit linking code |
| POST | `/api/notifications/telegram/webhook` | Telegram | Receive bot updates |
| POST | `/api/notifications/telegram/admin-webhook` | Internal | Admin events |
| POST | `/api/notifications/telegram` | Internal | Send Telegram message |
| POST | `/api/notifications/email` | Clerk JWT | Send email |
| GET | `/api/notifications/email/status` | Clerk JWT | Email delivery status |

### Onboarding

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/v1/onboarding/guides` | None | Platform-specific guides |
| POST | `/v1/onboarding/detect-platform` | None | Detect merchant platform |
| POST | `/api/onboarding/start` | Clerk JWT | Start onboarding session |
| POST | `/api/onboarding/step` | Internal Secret | Process step |
| POST | `/api/onboarding/step/1` through `/step/5` | Internal Secret | Steps 1-5 |
| GET | `/api/onboarding/status/:chatId` | Internal Secret | Onboarding status |
| POST | `/api/onboarding/complete-activation` | Clerk JWT | Complete activation |
| GET | `/api/onboarding/activation-status` | Clerk JWT | Activation status |
| POST | `/api/onboarding/generate-link` | Clerk JWT | Telegram onboarding link |
| POST | `/api/onboarding/ocr` | Clerk JWT | OCR document |

### Credits & Billing

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/credits/consume` | Internal | Consume LLM credits |
| GET | `/api/credits/balance/:userId` | Internal | Credit balance |
| POST | `/api/credits/purchase` | Clerk JWT | Buy credit packages |
| GET | `/api/credits/packages` | None | Available packages |

### Referrals

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/referrals/card` | Clerk JWT | Referral card PNG |
| POST | `/api/referrals/send-invite` | Clerk JWT | Send via WhatsApp |

### Composio Integrations

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/integrations/available` | None | List integrations |
| POST | `/api/integrations/authorize` | Clerk JWT | Start OAuth |
| GET | `/api/integrations/callback` | Composio | OAuth callback |
| POST | `/api/integrations/gmail/search` | Clerk JWT | Search Gmail |
| POST | `/api/integrations/gmail/send` | Clerk JWT | Send email |
| POST | `/api/integrations/calendar/list` | Clerk JWT | Calendar events |
| POST | `/api/integrations/calendar/create` | Clerk JWT | Create event |
| POST | `/api/integrations/slack/send` | Clerk JWT | Slack message |

### Stores

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/stores` | Clerk JWT | List connected stores |
| POST | `/api/stores/connect` | Clerk JWT | Connect store |
| GET | `/api/stores/:store` | Clerk JWT | Store status |
| GET | `/api/stores/:store/status` | Clerk JWT | Store auth status |
| DELETE | `/api/stores/:store` | Clerk JWT | Disconnect store |
| GET | `/api/stores/:store/bots/:botId` | Clerk JWT | Bot's store context |

### Shopping Config

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/shopping-config` | Clerk JWT | Shopping preferences |
| POST | `/api/shopping-config` | Clerk JWT | Save preferences |
| POST | `/api/shopping-config/setup-intent` | Clerk JWT | Stripe SetupIntent for card |
| POST | `/api/shopping-config/confirm-card` | Clerk JWT | Confirm card |

### Web Chat

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/web-chat/send` | Clerk JWT | Send chat message |
| GET | `/api/web-chat/history` | Clerk JWT | Chat history |
| POST | `/api/web-chat/typing` | Clerk JWT | Typing indicator |

### Voice Calls (Twilio)

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/voice/call` | Clerk JWT | Initiate outbound call |
| GET | `/api/voice/call/:callId` | Clerk JWT | Call status |
| POST | `/api/voice/respond/:callId` | Twilio | User input (DTMF/speech) |
| POST | `/api/voice/next/:callId` | Twilio | Continue conversation |
| GET | `/api/voice/twiml/:callId` | Twilio | TwiML response |
| POST | `/api/voice/verify-caller-id` | Clerk JWT | Verify caller ID |
| GET | `/api/voice/verified-caller-id` | Clerk JWT | Verified caller IDs |
| GET | `/api/voice/contacts` | Clerk JWT | Voice contacts |
| POST | `/api/voice/contacts` | Clerk JWT | Add contact |
| GET | `/api/voice/audio/:audioId` | Clerk JWT | Stream recording |

### Webhooks

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/webhook/stripe` | HMAC-SHA256 | Stripe events |
| POST | `/webhook/whatsapp` | Twilio validation | WhatsApp messages |
| POST | `/api/webhooks/mastercard` | None | Mastercard events |

### Admin Dashboard

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/admin/auth/login` | None | Admin login |
| POST | `/admin/auth/logout` | Admin JWT | Admin logout |
| GET | `/admin/auth/me` | Admin JWT | Current admin |
| GET | `/admin/overview` | Admin JWT | Dashboard KPIs |
| GET | `/admin/users` | Admin JWT | List users |
| GET | `/admin/users/:userId` | Admin JWT | User details |
| POST | `/admin/users/:userId/suspend` | Admin JWT | Suspend user |
| POST | `/admin/broadcast` | Admin JWT | Mass message |
| GET | `/admin/revenue` | Admin JWT | Revenue metrics |
| GET | `/admin/sentinel` | Admin JWT | Security alerts |
| GET | `/admin/cfo` | Admin JWT | Finance reporting |

### Next.js Web Endpoints

| Method | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/verify-passport` | HMAC-SHA256 | Visa/Mastercard agent auth |
| GET | `/api/agent/public-key` | None | PayJarvis ECDSA-P256 public key |

**Total: 230+ routes across 48 route modules**

### Authentication Layers
1. **Clerk JWT** — `requireAuth` middleware (user identity)
2. **Bot API Key** (pj_bot_*) — `requireBotAuth` middleware
3. **Internal Secret** — `x-internal-secret` header
4. **HMAC-SHA256** — webhook signatures (Stripe, Twilio)
5. **Redis atomic gates** — merchant confirmation
6. **Admin JWT** — separate admin auth system

---

## Services (apps/api/src/services/)

### Auth & Admin
| Arquivo | Descricao | Exports |
|---------|-----------|---------|
| admin-auth.service.ts | Admin login (separado do Clerk) | `login()`, `verifyToken()`, `logout()`, `requireAdmin()` |
| agent-identity.ts | Bot identity registration + verification | `registerAgent()`, `verifyAgent()` |
| bot-provisioning.ts | Onboard new bots | `provisionBot()` |

### Payments
| Arquivo | Descricao | API Externa |
|---------|-----------|-------------|
| visa.service.ts | Visa Click to Pay (SRC) | Visa SRC API + mTLS certs |
| mastercard.service.ts | Mastercard Buyer Payment Agent + MDES | Mastercard MDES (OAuth 1.0a + RSA-SHA256) |
| payments/stripe.provider.ts | Stripe subscriptions + charges | Stripe API |
| payments/vault.ts | Payment method storage | — |

### Credits & Billing
| Arquivo | Descricao |
|---------|-----------|
| credit.service.ts | LLM credit system (5,000 free + $10-$25 packs) |
| subscription.service.ts | $20/month Jarvis Premium |

### E-Commerce
| Arquivo | Descricao | API Externa |
|---------|-----------|-------------|
| amazon/checkout.service.ts | Real purchases via BrowserBase sessions | Amazon (via BrowserBase) |
| amazon/search.service.ts | Product search (browser-agent CDP) | Browser Agent |
| apify-ecommerce.service.ts | Multi-domain search (Apify actors) | Apify PAY_PER_EVENT |
| retail/retail-service.ts | Walmart, CVS, Walgreens, Target comparison | Browser Agent |
| retail/publix-service.ts | Publix supermarket | Publix API |
| commerce/mercadolibre.ts | Mercado Libre (Latin America) | Mercado Libre API |
| vault/vault.service.ts | AES-256 encrypted credential storage | — |

### Travel & Logistics
| Arquivo | Descricao | API Externa |
|---------|-----------|-------------|
| tracking/tracking-service.ts | Order tracking (USPS, FedEx, DHL, UPS) | Carrier APIs |
| transit/transit-service.ts | Amtrak, FlixBus, Greyhound | Transit APIs |
| voice/twilio-voice.service.ts | Voice calls | Twilio Voice API |

### Communication
| Arquivo | Descricao | API Externa |
|---------|-----------|-------------|
| audio/tts.service.ts | TTS: Gemini → ElevenLabs → edge-tts | Gemini, ElevenLabs, edge-tts |
| audio/stt.service.ts | STT via Gemini | Gemini 2.5 Flash |
| audio/converter.service.ts | WAV/OGG Opus conversion | FFmpeg |
| email.ts | Zoho SMTP transactional email | Zoho Mail |
| jarvis-whatsapp.service.ts | WhatsApp message processing | Twilio + Gemini |
| notifications.ts | Multi-channel (Telegram, email, WhatsApp) | Telegram API, Twilio |
| broadcast.service.ts | Mass messaging (30 msg/sec rate limit) | Telegram API, Twilio |

### Bot & Conversation
| Arquivo | Descricao |
|---------|-----------|
| onboarding-bot.service.ts | 10-step conversational onboarding (EN/PT/ES) |
| sequence.service.ts | 8-step drip banners (day 0→21) |
| gemini.ts | Gemini 2.5 Flash LLM + function calling + vision |
| instance-manager.ts | OpenClaw instance scaling |
| bot-share.service.ts | Bot sharing/referrals |

### Governance
| Arquivo | Descricao |
|---------|-----------|
| trust-score.ts | Trust score (0-1000) |
| reputation.ts | Merchant reputation tracking |
| audit.ts | Event logging |
| webhook-dispatcher.ts | HMAC-SHA256 signed webhook delivery |

### Utilities
| Arquivo | Descricao |
|---------|-----------|
| redis.ts | Redis client singleton (fallback: in-memory) |
| composio/composio-client.ts | Composio SDK (Gmail, Calendar, Slack) |

---

## Prisma Schema (packages/database/prisma/schema.prisma)

### Enums
```
UserStatus: ACTIVE | SUSPENDED | PENDING_KYC
KycLevel: NONE | BASIC | VERIFIED | ENHANCED
BotStatus: ACTIVE | PAUSED | REVOKED
AgentStatus: ACTIVE | SUSPENDED | REVOKED
BotPlatform: TELEGRAM | DISCORD | WHATSAPP | SLACK | CUSTOM_API
BditTokenStatus: ISSUED | USED | EXPIRED | REVOKED
TransactionDecision: APPROVED | BLOCKED | PENDING_HUMAN
ApprovalStatus: PENDING | APPROVED | REJECTED | EXPIRED
HandoffObstacle: CAPTCHA | AUTH | NAVIGATION | OTHER
HandoffStatus: PENDING | IN_PROGRESS | RESOLVED | EXPIRED | CANCELLED
MerchantPlan: FREE | STARTER | PRO | ENTERPRISE
PaymentProvider: STRIPE | PAYPAL | APPLE_PAY | GOOGLE_PAY | BNPL
```

### Domain: Users & Auth
| Model | Campos-chave | Relacoes |
|-------|-------------|----------|
| **User** | clerkId, email, phone, kycLevel, status, stripeCustomerId, subscriptionStatus, planType, telegramChatId, latitude/longitude | bots[], agents[], transactions[], paymentMethods[], llmCredits, zkVault |
| **TelegramLinkCode** | userId (unique), code (unique), expiresAt | User |
| **AdminUser** | email, passwordHash, role | adminSessions[] |
| **AdminSession** | adminId, token (unique), expiresAt | AdminUser |
| **PaymentMethod** | userId, provider (enum), status, accountId, credentials (JSON encrypted), isDefault | User |

### Domain: Bots & Agents
| Model | Campos-chave | Relacoes |
|-------|-------------|----------|
| **Bot** | ownerId, name, platform, apiKeyHash, status, systemPrompt, capabilities[] | Agent, Policy, bditTokens[], transactions[] |
| **Agent** | id (ag_xxxxx manual), botId (unique), ownerId, trustScore (0-1000), kycLevel | Bot, AgentReputation |
| **Policy** | botId (unique), maxPerTransaction/Day/Week/Month, autoApproveLimit, allowedCategories[], allowedDays[], timezone | Bot |
| **BotIntegration** | botId, provider, category, enabled, config (JSON) | Bot |
| **AgentReputation** | agentId (unique), successfulTransactions, chargebacks, anomalyEvents, totalSpent | Agent |

### Domain: Transactions & Commerce
| Model | Campos-chave | Relacoes |
|-------|-------------|----------|
| **Transaction** | botId, agentId, ownerId, merchantName, amount, currency, category, decision, bdtJti | Bot, User, ApprovalRequest |
| **ApprovalRequest** | transactionId (unique), amount, status, expiresAt, pushSent | Transaction, Bot, User |
| **HandoffRequest** | botId, ownerId, sessionUrl, obstacleType, status, expiresAt | Bot, User |
| **Merchant** | merchantKey (unique), apiKeyHash, plan, webhookUrl, minTrustScore | bditTokens[] |
| **BditToken** | jti (unique), tokenValue, amount, category, status | Bot, Merchant |
| **CommerceSearchLog** | botId, service, params (JSON), resultCount, durationMs | — |

### Domain: Stores (BrowserBase Contexts)
| Model | Campos-chave | Relacoes |
|-------|-------------|----------|
| **StoreContext** | userId, store, bbContextId, status, pendingProduct (JSON) | User, sessions[], botPermissions[] |
| **StoreSession** | storeContextId, bbSessionId, status, purpose | StoreContext |
| **StoreBotPermission** | botId, storeContextId, maxPerTransaction/Day/Month, allowedCategories[] | Bot, StoreContext |
| **UserAccountVault** | userId, provider, cookiesEnc (AES-256), userAgent, isValid | User |
| **AmazonOrder** | botId, userId, asin, title, price, status, amazonOrderId | — |

### Domain: OpenClaw (Protegidas — NUNCA prisma db push --accept-data-loss)
| Model | Campos-chave | Tabela |
|-------|-------------|--------|
| **OpenclawConversation** | userId, role, content | `openclaw_conversations` |
| **OpenclawUserFact** | userId, factKey, factValue, category, source | `openclaw_user_facts` |
| **OpenclawReminder** | userId, reminderText, remindAt, recurring, channel, channelId | `openclaw_reminders` |

### Domain: Instance Management
| Model | Campos-chave | Relacoes |
|-------|-------------|----------|
| **OpenClawInstance** | name, processName, port, capacity, currentLoad, status | users[] |
| **InstanceUser** | userId (unique), instanceId, assignedAt | OpenClawInstance, User |

### Domain: Onboarding
| Model | Campos-chave |
|-------|-------------|
| **OnboardingSession** | telegramChatId, whatsappPhone, step (start→complete), fullName, botNickname, email, language |
| **OnboardingSequence** | userId (unique), currentStep, nextSendAt, stepsCompleted[], active |

### Domain: Billing & Credits
| Model | Campos-chave |
|-------|-------------|
| **LlmCredit** | userId (unique), messagesTotal, messagesUsed, messagesRemaining, freeTrialActive, alert flags |
| **LlmUsageLog** | userId, platform, model, inputTokens, outputTokens, costReal, costCharged |
| **CreditPurchase** | userId, packageId, messagesAdded, amountUsd, stripePaymentId, status |

### Domain: Viral Growth
| Model | Campos-chave |
|-------|-------------|
| **BotShareLink** | code (unique), botId, templateConfig (JSON), maxUses, useCount |
| **BotClone** | shareCode, newBotId, newUserId, referredByUserId |

### Domain: Admin & Broadcasts
| Model | Campos-chave |
|-------|-------------|
| **Broadcast** | title, message, audience, status, totalRecipients, delivered, failed |
| **BroadcastLog** | broadcastId, userId, platform, status |

### Domain: CFO Agent
| Model | Campos-chave |
|-------|-------------|
| **CfoSnapshot** | date (unique), revenuePacksUsd, costLlmUsd, marginPercent, mrr, arr, activeUsers, churnedUsers |
| **CfoAlert** | type, severity, title, value, threshold, status |
| **CostEntry** | category, amountUsd, userId, date |

### Domain: Sentinel (DevOps)
| Model | Campos-chave |
|-------|-------------|
| **SentinelLog** | type, service, status, message, details (JSON) |
| **SentinelIncident** | title, severity, status, autoFixed, fixDetails |

### Domain: Governance & Audit
| Model | Campos-chave |
|-------|-------------|
| **PolicyDecisionLog** | botId, action (JSON), allowed, reason, trustLevel, layer (1-4) |
| **AuditLog** | entityType, entityId, action, actorType, actorId, payload (JSON) — append-only |
| **FraudAlert** | userId, type, severity, description, deviation, status, autoBlocked |
| **PlatformRegistration** | platformType, webhookUrl, events[], secret |

### Domain: Voice & Contacts
| Model | Campos-chave |
|-------|-------------|
| **VoiceCall** | id (Twilio SID), userId, to, from, status, transcript (JSON), result, duration, briefing (JSON) |
| **UserContact** | userId, name, phone, relationship, notes |

### Domain: Zero-Knowledge Vault
| Model | Campos-chave |
|-------|-------------|
| **UserZkVault** | userId (unique), salt (PBKDF2 hex), pinHash |
| **SecureItem** | userId, itemType (card/amazon_credentials/document/password), label, encryptedData, iv, authTag |

### Migrations (15 total, last: 2026-03-21)
```
0001_init_payjarvis                          — Initial schema
0002_add_stripe_customer_id                  — Stripe integration
20260315125847_add_bot_share                 — BotShareLink, BotClone
20260315180000_add_onboarding_session        — OnboardingSession
20260315200000_baseline_credits_and_sequences — LlmCredit, CfoSnapshot, Broadcast
20260315223000_add_subscription_fields       — subscriptionStatus, planType
20260316100000_add_onboarding_fullname       — fullName
20260317_onboarding_redesign                 — Step updates
20260317_phone_unique_constraint             — Phone uniqueness
20260317_shipping_address                    — shippingAddress
20260318_add_pending_product                 — pendingProduct on StoreContext
20260319_add_geolocation_fields              — latitude, longitude
20260320_add_channel_to_reminders            — channel, channelId
20260320_add_zero_knowledge_vault            — UserZkVault, SecureItem
20260321_add_apify_usage_logs                — ApifyUsageLog
```

### Redis Key Patterns
```
session:<botId>:<userId>         → Chat session state (TTL: 7d)
bdit:used:<jti>                  → Token replay protection (TTL: 600s)
approval:token:<id>              → Approval tokens (TTL: 300s)
revoked:bot:<botId>              → Revoked bot cache (no TTL)
voice:tts:<hash>                 → TTS audio cache (TTL: 24h)
commerce:<service>:<params_hash> → Commerce API results (variable TTL)
```

---

## OpenClaw Bot (/root/openclaw/)

### Estrutura
```
/root/openclaw/
├── index.js              # Entry point + Telegram webhook
├── gemini.js             # Gemini 2.5 Flash + 40+ tools
├── memory.js             # Conversations, facts, reminders
├── tts.js                # TTS pipeline (Gemini → ElevenLabs → edge-tts)
├── payjarvis.js          # API bridge (payments, handoff, reputation)
├── admin-bot.js          # @JPvisionIA_bot (13 admin commands)
├── premium-pipeline.js   # 8-layer orchestration
├── adaptive-memory.js    # Episodic memory + confidence scoring
├── behavioral-signals.js # User satisfaction tracking
├── anticipation.js       # Predict next steps
├── initiative.js         # Proactivity calibration (4 thresholds)
├── user-model.js         # Adaptive profile (goals, constraints)
├── task-manager.js       # Open commitments tracking
├── reflection.js         # Post-interaction learning
└── smart-reorder.js      # Recurring purchase detection
```

### Bot Commands (User)
| Comando | Funcao |
|---------|--------|
| `/start` | Onboarding welcome |
| `/perfil` | Display user facts |
| `/lembrar <text>` | Save fact |
| `/esquecer <term>` | Delete fact |
| `/limpar` | Clear history |
| `/transactions` | Export PDF |
| `/lembretes` | List reminders |
| `/briefing` | Daily executive briefing |
| `/rastrear <code>` | Track package |
| `/walmart <query>` | Walmart search |
| `/comparar <product>` | Price comparison |
| `/farmacia <rx>` | Prescription status |
| `/trem`, `/onibus`, `/passagem` | Transit search |
| `/alugar_carro <city>` | Rental cars |
| `/mecanico`, `/pintor`, `/eletricista`, `/reformar` | Home services |
| `/status` | System health |

### Admin Commands (@JPvisionIA_bot)
| Comando | Funcao |
|---------|--------|
| `/logs [service]` | PM2 logs |
| `/test <tool>` | Test tool with mock data |
| `/debug <userId>` | Full user state dump |
| `/restart` | Restart all services |
| `/stats` | Bot statistics |

### LLM Tools (40+)
**Travel:** search_flights, search_hotels, search_restaurants, search_events, search_transit, compare_transit, train_status, search_rental_cars
**Commerce:** search_products, amazon_search, compare_prices, search_products_latam, search_products_global, find_stores, check_prescription
**Payments:** request_payment, get_transactions, stripe_charge_on_file, stripe_create_payment_link, paypal_create_order, paypal_capture_order
**Services:** find_home_service, find_mechanic, make_phone_call, call_user
**Location:** get_directions, geocode_address, track_package
**Documents:** generate_document, export_transactions, fill_form
**Search:** web_search, browse
**Memory:** save_user_fact, set_reminder, get_reminders, complete_reminder
**Social:** share_jarvis, request_handoff

### Premium Pipeline (8 Layers)
```
User Message
  → 1. adaptive-memory.js — logEvent()
  → 2. behavioral-signals.js — classifyUserResponse()
  → 3. memory.js — getHistory() + getUserContext()
  → 4. user-model.js — buildProfileBlock()
  → 5. task-manager.js — formatTasksForPrompt()
  → 6. anticipation.js — anticipate()
  → 7. initiative.js — shouldIntervene()
  → 8. gemini.js — chat() with all context + tools
  → Response
  → ASYNC: extractFacts(), reflect(), applyForgettingPolicy()
```

### Premium Database Tables (raw SQL)
| Tabela | Funcao |
|--------|--------|
| `agent_episodic_events` | Event log |
| `agent_behavioral_signals` | Feedback tracking |
| `agent_tasks` | Open commitments |
| `agent_user_profiles` | Adaptive profile |
| `user_reflections` | Learning patterns |
| `purchase_history` | Reorder detection |

---

## Browser Agent (apps/browser-agent/)

### Checkout Detection Flow
```
OpenClaw → POST /connect → CDP connection
  → cdp-monitor.ts monitors page navigation
  → checkout-detector.ts regex match → site + stage
  → interceptor.ts pauses browser (overlay)
  → sites/*.ts extracts amount/items
  → POST /api/payment/authorize → Rules Engine
  → Decision: APPROVED → resume | BLOCKED → decline | PENDING → handoff
```

### Supported Sites
| Site | Extractor | Category |
|------|-----------|----------|
| Amazon (.com, .com.br, .co.uk, .de, .fr, .es, .it, .co.jp, .ca, .in) | amazon.ts | shopping |
| Expedia | expedia.ts | travel |
| Hotels.com | hotels.ts | travel |
| Booking.com | booking.ts | travel |
| Macy's | macys.ts | shopping |
| Target | target.ts | shopping |
| CVS | cvs.ts | pharmacy |
| Walgreens | walgreens.ts | pharmacy |
| Publix | publix.ts | grocery |
| Amtrak | amtrak.ts | transit |
| iFood | ifood.ts | food |
| Turo | turo.ts | travel |
| Wrench | wrench.ts | services |
| Angi | angi.ts | services |
| Generic fallback | generic.ts | any |

### Vault Encryption (AES-256-CBC)
```typescript
// Encrypt: random IV + AES-256-CBC + hex output
encryptCookies(cookies) → "iv_hex:ciphertext_hex"
decryptCookies(encrypted) → object

// Key: VAULT_ENCRYPTION_KEY (64-char hex = 32 bytes)
```

### Browser Agent API (port 3003)
| Method | Path | Descricao |
|--------|------|-----------|
| GET | `/health` | Health check |
| POST | `/connect` | CDP connection |
| POST | `/disconnect` | Disconnect |
| POST | `/navigate` | Navigate + scrape |
| POST | `/bb/create-context` | BrowserBase context |
| POST | `/bb/open-session` | Open session |
| POST | `/bb/action` | Stagehand action |
| POST | `/bb/close-session` | Close session |

### Handoff Types
```
CAPTCHA — reCAPTCHA, hCaptcha
AUTH — 2FA, email verification
NAVIGATION — Can't find checkout button
BLOCKED — IP blocked, rate limited
PAYMENT_METHOD — Card declined
OTHER
```

---

## PM2 Processos

| Process | Script | Port | Memory |
|---------|--------|------|--------|
| payjarvis-api | apps/api/dist/server.js | 3001 | 512M |
| payjarvis-rules | apps/rules-engine/dist/server.js | 3002 | 256M |
| payjarvis-web | scripts/start-web.sh | 3000 | 512M |
| browser-agent | apps/browser-agent/dist/server.js | 3003 | 256M |
| payjarvis-kyc | /root/payjarvis-kyc/venv/bin/uvicorn | 3004 | 1G |
| payjarvis-admin | apps/admin/start.sh | 3005 | 512M |
| cfo-agent | /root/sentinel/cfo.js | — | 128M |
| sentinel | /root/sentinel/index.js | — | 128M |

---

## Nginx Routes (Production)

| Route | Target | Rate Limit |
|-------|--------|-----------|
| `/api/` | localhost:3001 | 30 r/s |
| `/v1/` | localhost:3001 | 30 r/s |
| `/.well-known/jwks.json` | localhost:3001 | cached 1h |
| `/health` | localhost:3001 | — |
| `/adapter.js` | localhost:3001 | cached 1h |
| `/api/approvals/stream` | localhost:3001 | SSE, 3600s timeout |
| `/rules/` | localhost:3002 | 10 r/s |
| `/` (catch-all) | localhost:3000 | 60 r/s |

SSL: Let's Encrypt at `/etc/letsencrypt/live/payjarvis.com/`

---

## Scripts

| Script | Funcao |
|--------|--------|
| `deploy.sh` | Full VPS deploy (build + migrate + PM2 + Nginx) |
| `deploy-cloud.sh` | Cloud deploy (Supabase + PM2 + Nginx) |
| `ssl-setup.sh` | Let's Encrypt SSL setup |
| `scripts/start-web.sh` | PM2 wrapper for Next.js standalone |
| `scripts/smoke-test.sh` | 17 post-deploy health checks |

### Smoke Test Checks (scripts/smoke-test.sh)
1. API /health → "ok"
2. PM2: payjarvis-api running
3. PM2: openclaw running
4. WhatsApp webhook → 200/400/403
5. Web Chat → 401/403
6. Referral card → non-404
7. QR Code library loads
8. Static file serving
9. Voice TwiML endpoint
10. HTTPS www.payjarvis.com → 200
11. /privacy → 200
12. /terms → 200
13. PWA manifest contains "Jarvis"
14. PostgreSQL connectivity
15. Redis PONG
16. No uncaught/unhandled/fatal in PM2 logs

---

## Environment Variables (names only)

### Database
`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`

### Auth (Clerk)
`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`

### BDIT (RS256)
`PAYJARVIS_PRIVATE_KEY`, `PAYJARVIS_PUBLIC_KEY`, `PAYJARVIS_KEY_ID`, `BDIT_ENV`

### Stripe
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### PayPal
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`

### Vault
`PAYMENT_VAULT_KEY`, `VAULT_ENCRYPTION_KEY`

### AI
`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`

### Telegram
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`

### Twilio
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`

### BrowserBase
`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`

### Commerce APIs
`AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `YELP_API_KEY`, `TICKETMASTER_API_KEY`, `APIFY_API_KEY`, `ELEVENLABS_API_KEY`, `COMPOSIO_API_KEY`

### Service Ports
`API_PORT` (3001), `RULES_ENGINE_PORT` (3002), `BROWSER_AGENT_PORT` (3003)

### Admin
`ADMIN_JWT_SECRET`

---

## Guia de Debug

### Checklist de Diagnostico
1. `pm2 list` — verificar processos online
2. `pm2 logs <processo> --lines 100` — erros recentes
3. `curl http://localhost:3001/health` — API respondendo
4. `redis-cli ping` — Redis conectado
5. `psql $DATABASE_URL -c "SELECT 1"` — PostgreSQL conectado
6. `bash /root/Payjarvis/scripts/smoke-test.sh` — smoke test completo

### Erros Comuns
| Sintoma | Causa Provavel | Solucao |
|---------|---------------|---------|
| 502 Bad Gateway | PM2 processo crashed | `pm2 restart payjarvis-api` |
| Clerk 401 em todas as rotas | Token expirado ou CLERK_SECRET_KEY errada | Verificar .env.production |
| OpenClaw tabelas sumiram | `prisma db push --accept-data-loss` foi usado | Restaurar backup, usar `prisma migrate deploy` |
| BDIT token invalido | Chaves rotacionadas sem atualizar env | Verificar PAYJARVIS_PRIVATE_KEY/PUBLIC_KEY |
| Amazon checkout falha | Cookies expirados no vault | Reconectar via /api/vault/amazon/connect |
| TTS silencioso | Todos 3 providers falharam | Verificar GEMINI_API_KEY, ELEVENLABS_API_KEY, edge-tts instalado |
| SSE stream desconecta | Nginx timeout default | Verificar proxy_read_timeout 3600s |
| Redis fallback in-memory | REDIS_URL invalida | Verificar Redis rodando: `redis-cli ping` |

### Regra de Deploy
```bash
# NUNCA em producao:
prisma db push --accept-data-loss

# SEMPRE em producao:
prisma migrate deploy

# SEMPRE em sandbox:
prisma migrate dev
```

### Cron Jobs
| Job | Schedule | Funcao |
|-----|----------|--------|
| trial-cron.ts | Daily 9 AM | Credit alerts (75%, 90%, 100% usage) |
| sequence-cron.ts | Hourly + 9 AM | Onboarding drip banners |
| checkReminders | Every 60s (OpenClaw) | Send due reminders via Telegram/WhatsApp |
| checkReorderReminders | Daily (OpenClaw) | Suggest recurring purchases |

---

## Dependency Graph

```
@payjarvis/api
├── @payjarvis/database (Prisma)
├── @payjarvis/types (enums, interfaces)
├── @payjarvis/bdit (token signing)
├── Fastify 5.0, Stripe, Twilio, Gemini, Composio, BrowserBase, Apify

@payjarvis/web
├── @payjarvis/agent-sdk
├── Next.js 14, React 18, Clerk, TailwindCSS, Recharts, i18next

@payjarvis/browser-agent
├── @payjarvis/types, @payjarvis/bdit
├── BrowserBase SDK, Stagehand, Playwright Core, Fastify, Zod

@payjarvis/rules-engine
├── @payjarvis/types, @payjarvis/database
├── Fastify 5.0, Redis

@payjarvis/admin
├── Next.js 16, React 19

@payjarvis/database → Prisma 5.22
@payjarvis/bdit → jose 5.9 (RS256 JWT)
@payjarvis/agent-sdk → pure client (no external deps)
```
