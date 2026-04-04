# PayJarvis

## What This Is

AI spending firewall and agentic commerce platform. Autonomous AI agents search, compare, and purchase for users with governance layers. Serves both B2B (Governance API middleware) and B2C (managed agent via Telegram/WhatsApp). Currently in production with 4+ beta users.

## Core Value

The user tells Jarvis what they want, and Jarvis finds, compares, and buys it — safely, autonomously, with full spending control.

## Current Milestone: v1.1 Premium Travel

**Goal:** Combine RateHawk hotel scraping (B2B prices via Playwright) with enhanced Amadeus flight search into a unified premium travel feature for SnifferShop.

**Target features:**
- RateHawk hotel scraper in browser-agent (login, search, B2B price extraction via Playwright)
- Amadeus flight search improvements (flexible dates +-3 days, price analysis)
- Combined premium travel route /api/travel/search-premium (hotels + flights, gated by planType=premium)

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- Unified Product Search (5 parallel sources + Redis cache)
- Price Alerts (6h cron + WhatsApp/Telegram notifications)
- Stripe + Skyfire purchase orchestrator (charge-on-purchase)
- Voice calls (Twilio dual-channel recording + post-call analysis)
- Audio pipeline (Gemini TTS → ElevenLabs → edge-tts fallback)
- WhatsApp + Telegram multi-tenant bots with Grok/Gemini dual LLM
- Wallet setup page with Stripe Elements
- Browser Agent (BrowserBase/Stagehand) for web automation
- Playwright E2E suite (29/29 passing)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Butler Protocol — Profile Vault (AES-256) + autonomous site actions
- [ ] Shopping Planner — Complex purchase plans with approval workflow
- [ ] Audio vs Text routing rule
- [ ] Ray-Ban Meta smart glasses detection and adaptation
- [ ] Supabase → VPS PostgreSQL migration (9 projects)
- [ ] VPS disk optimization (83% → <60%)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- React Native app — Deferred, web-first approach sufficient for beta
- Amadeus/Yelp/Ticketmaster integrations — Deferred to post-v1.0
- Visa Click to Pay / Mastercard Buyer Payment Agent — Pending partner credentials
- A2A Protocol (Google agent-to-agent) — Future, spec not finalized

## Context

- Monorepo Turborepo: API (Fastify 3001), Web (Next.js 3000), Rules Engine (3002), Browser Agent (3003)
- PostgreSQL + Redis + Clerk auth + Stripe payments
- PM2 process manager, Nginx reverse proxy
- VPS: Hostinger srv1306722 (76.13.109.151), Ubuntu 24.04, 4 vCPU/16GB
- Dual LLM: Grok (chat/voice personality) + Gemini 2.5 Flash (tools/actions)
- BrowserBase (Stagehand) for browser automation with AES-256 cookie encryption
- OpenClaw Telegram bot at /root/openclaw/ (grammY + Gemini)
- 14 dead Supabase projects costing $150/month

## Constraints

- **Disk**: VPS at 83% — must optimize before adding new features
- **Security**: AES-256 mandatory for all stored credentials, never plaintext
- **Privacy**: Browser automation must respect user consent and ToS awareness
- **Budget**: Supabase $150/month waste — migration is cost-driven
- **UX**: Ray-Ban Meta users need short responses (<30 words for voice readout)
- **Stack**: TypeScript, Fastify, Next.js, PostgreSQL, Redis — no new frameworks

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dual LLM (Grok + Gemini) | Grok for personality, Gemini for tool execution | ✓ Good |
| Charge-on-purchase (Stripe + Skyfire) | Skyfire lacks sub-wallets, Stripe handles per-user billing | ✓ Good |
| BrowserBase for automation | Cloud browser avoids VPS resource drain | ✓ Good |
| Profile Vault with AES-256 | User credentials must be encrypted at rest, same pattern as cookie vault | — Pending |
| Supabase → local PostgreSQL | $150/month savings, all projects on same VPS anyway | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-30 after milestone v1.0 initialization*
