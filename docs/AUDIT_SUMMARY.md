# PayJarvis Audit Summary — 2026-03-18

## Overview

| Metric | Count |
|---|---|
| Source files (active) | 233 |
| Total lines of code | 56,160 |
| HTTP endpoints | 178 |
| Gemini tools (OpenClaw) | 31 |
| Gemini tools (API/custom bots) | 4 |
| Database tables | 55 |
| PM2 services | 12 |
| Environment variables | 84 |
| Cron jobs | 12 |
| External integrations | 10 |
| Dead code files | 13 |
| Prisma models | 44 |

---

## CRITICAL Issues (3)

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | **TELEGRAM_WEBHOOK_SECRET is empty** | .env.production | Webhook endpoint unsecured — anyone can send fake Telegram updates |
| 2 | **Both Telegram bot tokens are identical** | .env.production (TELEGRAM_BOT_TOKEN = ADMIN_TELEGRAM_BOT_TOKEN) | No isolation between user bot and admin bot |
| 3 | **OpenClaw 286 restarts** | PM2 openclaw process | Crash loop instability — syntax errors from recent edits |

---

## WARNING Issues (8)

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | ZOHO_PASSWORD empty for jarvis@payjarvis.com | .env.production | Secondary email not functional |
| 2 | ElevenLabs TTS completely unconfigured | No API key in env | TTS falls back to edge-tts only |
| 3 | 29 of 84 env vars (34.5%) have zero code references | .env.production | Unused config clutter (Supabase, AfterShip, iFood, VISA P12) |
| 4 | behavioral-signals.js has 0 imports from index.js | /root/openclaw/ | Module exists but may not be wired into main flow |
| 5 | DB password "payjarvis123" still in use | PostgreSQL | Weak password flagged in hardening audit |
| 6 | Nickname validation inconsistent | onboarding-bot.service.ts:186 | Rejects >20 chars for sentences but .slice(0,50) allows 21-50 char names |
| 7 | Language inconsistency in prompts | OpenClaw=Portuguese, WhatsApp=English | Same Jarvis persona, different languages |
| 8 | Amazon checkout endpoints still active but broken | routes/checkout.ts | Old BrowserBase checkout routes respond but always fail (cookies don't transfer) |

---

## INFO Issues (5)

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | Apple Pay provider is a stub (26 lines) | payments/providers/apple-pay.provider.ts | Placeholder, not functional |
| 2 | Google Pay provider is a stub (26 lines) | payments/providers/google-pay.provider.ts | Placeholder, not functional |
| 3 | user_reflections table newly created (empty) | PostgreSQL | Created today, not yet populated |
| 4 | user_task_stages table newly created (empty) | PostgreSQL | Created today, not yet populated |
| 5 | Resend email API deprecated (commented out) | .env.production | Replaced by Zoho SMTP, cleanup needed |

---

## Dead Code (13 files, 1,710 lines) — Recommendation: DELETE

### OpenClaw Skills (10 files, 1,581 lines)
| File | Lines | Reason |
|---|---|---|
| skills/rentcar.js | 238 | Not imported by index.js |
| skills/supermarket.js | 231 | Not imported by index.js |
| skills/amadeus.js | 200 | Not imported by index.js |
| skills/homeservices.js | 187 | Not imported by index.js |
| skills/fashion.js | 160 | Not imported by index.js |
| skills/pricecompare.js | 136 | Not imported by index.js |
| skills/opentable.js | 130 | Not imported by index.js |
| skills/google-places.js | 127 | Not imported by index.js |
| skills/yelp.js | 95 | Not imported by index.js |
| skills/ticketmaster.js | 77 | Not imported by index.js |

### API Services (3 files, 129 lines)
| File | Lines | Reason |
|---|---|---|
| services/referral.service.ts | 77 | Not imported by any route |
| services/payments/providers/apple-pay.provider.ts | 26 | Stub — not functional |
| services/payments/providers/google-pay.provider.ts | 26 | Stub — not functional |

### Unused Exported Functions (14)
| Function | File |
|---|---|
| ensureAgentForBot | agent-identity.ts |
| getUserShareLinks | bot-share.service.ts |
| templateDailySummary | email.ts |
| templateOnboardingConfirm | email.ts |
| findAvailableInstance | instance-manager.ts |
| updateInstanceStatus | instance-manager.ts |
| generateStripeSetupLink | onboarding-bot.service.ts |
| getReferralStats | referral.service.ts |
| recordChargeback | reputation.ts |
| resumeSequence | sequence.service.ts |
| getAgentScoreDelta | trust-score.ts |
| getScoreDelta | trust-score.ts |
| sendWelcomeTemplate | twilio-whatsapp.service.ts |
| helloWorld | visa.service.ts |

---

## External Integrations Status

| Service | Status | Credentials | Notes |
|---|---|---|---|
| Twilio WhatsApp | OPERATIONAL | Set | 10 files reference it |
| Telegram Bot API | OPERATIONAL | Set | Empty webhook secret, shared token |
| Stripe | OPERATIONAL | Live keys | Full payment lifecycle |
| Google Gemini | OPERATIONAL | Set | gemini-2.5-flash |
| Clerk Auth | OPERATIONAL | Live keys | Nginx proxy configured |
| BrowserBase | CONFIGURED | Set | Low usage — Amazon checkout broken |
| Zoho SMTP | OPERATIONAL | Set | Primary: admin@payjarvis.com |
| Amazon | OPERATIONAL | Via vault | Search works, checkout broken |
| ElevenLabs TTS | NOT CONFIGURED | Missing | No API key set |
| Resend Email | DEPRECATED | Commented | Replaced by Zoho |

---

## Database Summary (55 tables)

| Category | Tables | Notes |
|---|---|---|
| Core (users, bots, policies) | 6 | 1 user, 1 bot after cleanup |
| Payments (transactions, methods) | 5 | Stripe live |
| Amazon (orders, vault, contexts) | 4 | Checkout broken, search works |
| OpenClaw (conversations, facts, reminders) | 3 | Active |
| Agent system (episodic, signals, tasks, profiles) | 6 | Premium pipeline |
| Monitoring (sentinel, CFO, audit) | 5 | 5,591 sentinel logs |
| Onboarding (sessions, sequences) | 2 | Active |
| Sharing (share_links, clones, referrals) | 3 | Active |
| Admin (users, sessions, broadcasts) | 4 | Active |
| Other (commerce, instances, integrations) | 17 | Mixed usage |

---

## PM2 Services (12)

| Service | Port | Memory | Restarts | Status |
|---|---|---|---|---|
| openclaw | 4000 | 63MB | 286 | UNSTABLE |
| payjarvis-api | 3001 | 140MB | 17 | OK |
| payjarvis-web | 3000 | 102MB | 4 | OK |
| browser-agent | 3003 | 190MB | 10 | OK |
| admin-bot | — | 78MB | 5 | OK |
| sentinel | — | 90MB | 0 | STABLE |
| cfo-agent | — | 80MB | 0 | STABLE |
| payjarvis-rules | — | 73MB | 0 | STABLE |
| payjarvis-kyc | — | 49MB | 0 | STABLE |
| payjarvis-admin | — | 4MB | 0 | STABLE |
| botfriendly-mcp | — | 82MB | 0 | STABLE |
| pm2-logrotate | — | 67MB | 0 | STABLE |

**Total memory: ~1,014 MB**

---

## Spec Divergences

### Onboarding Spec
| Item | Status |
|---|---|
| 10-step flow | Implemented |
| English-only during onboarding | Implemented |
| Referrer-aware greeting | Implemented |
| Email 6-digit code via Zoho | Implemented |
| Beta choice skip | Implemented |
| Stripe SetupIntent | Implemented |
| Nickname max 20 chars | PARTIAL (allows 21-50 for non-sentences) |

### Adaptive Learning Spec
| Item | Status |
|---|---|
| All 9 module files exist | YES |
| Functions match spec (with aliases) | YES |
| Premium pipeline 10-step | YES |
| 8 engagement banners | YES |
| Hourly cron for sequences | YES |
| Database tables for agent system | YES (with agent_ prefix) |

---

## Cron Jobs (12)

| Schedule | Job | Source |
|---|---|---|
| */5 * * * * | Health check (ck.sh) | crontab |
| 0 2 * * * | PostgreSQL backup | crontab |
| 0 3 * * * | MongoDB backup | crontab |
| 0 4 * * * | Daily cleanup | crontab |
| 0 8 * * * | Nucleo-empreende run | crontab |
| 0 23 * * * | Expense report | crontab |
| 0 * * * * | Process onboarding sequences | sequence-cron.ts |
| 0 9 * * * | Trial expiration alerts | trial-cron.ts |
| 0 9 * * * | Sequence morning run | sequence-cron.ts |
| every 60s | Check reminders | openclaw/index.js |
| every 60s | Approval timeout check | approval-manager.ts |
| daily | Reorder reminders | smart-reorder.js |
