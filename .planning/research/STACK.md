# Stack Research

> Researched: 2026-03-30
> Scope: 4 new features — Butler Protocol, Shopping Planner, Audio/Text routing, Ray-Ban Meta detection
> Method: Full codebase scan before writing — no speculation without evidence

---

## Summary of Findings

**Short answer: No new frameworks or runtimes needed.**
The 4 features can be built entirely on the existing stack with minor library additions and Prisma schema migrations.

---

## New Dependencies Needed

### 1. `zod` — Input validation for Butler autonomous actions
**Package:** `zod` (already in monorepo via `@browserbasehq/stagehand`'s peer, but not in `apps/api`)
**Version:** `^3.22`
**Why:** Butler Protocol actions (login, buy, cancel) need strict runtime validation of action payloads before passing to Playwright. The browser agent already uses `zod` — add it explicitly to `apps/api/package.json` for the butler routes.
**Alternative considered:** Manual TS assertions — rejected, too fragile for user-supplied credential data.

### 2. No other new packages required

The investigation found:
- AES-256 encryption: already in `apps/api/src/services/vault/crypto.ts` (`encryptPII`, `decryptCookies`, etc.)
- Credential storage: already in `apps/api/src/services/butler/butler-protocol.service.ts` (`saveCredential`, `getCredential`)
- Playwright autonomous actions: already available via `@browserbasehq/stagehand` + `playwright-core` in `apps/browser-agent`
- Audio TTS pipeline: already in `apps/api/src/services/audio/tts.service.ts` and `/root/openclaw/tts.js`
- Audio/text routing: already implemented in `/root/openclaw/index.js` (`sendVoiceOrTextReply`, `parseResponseFormat`, `shouldForceText`)
- Ray-Ban Meta detection: already implemented in `/root/openclaw/index.js` (lines 3908-3937), saves `has_meta_glasses` user fact
- User facts system: already in `openclaw_user_facts` table via `memory.js`

---

## Existing Stack Reuse

### Butler Protocol — Credential Vault + Autonomous Actions

**What already exists (do not rebuild):**
- `apps/api/src/services/butler/butler-protocol.service.ts` — full CRUD: `saveCredential()`, `getCredential()`, `listCredentials()`, `logButlerAction()`
- `apps/api/src/services/butler/gmail.service.ts` — Google OAuth already wired
- `packages/database/prisma/schema.prisma` — `ButlerProfile`, `ButlerCredential`, `ButlerAuditLog`, `ButlerConnectedAccount` models exist
- `apps/api/src/services/vault/crypto.ts` — `encryptPII()` / `decryptPII()` used by butler service already
- `apps/browser-agent/src/services/bb-context.service.ts` — `openSession()`, `checkLoginStatus()` for Amazon, Walmart, Target
- `apps/browser-agent/src/routes/store-actions.ts` — `POST /browser/store/add-to-cart`, search routes

**What is missing (needs to be built):**
- A "butler action executor" service in `apps/api` that: (a) retrieves credentials from `ButlerCredential`, (b) calls browser-agent to open a BrowserBase session with those credentials, (c) performs the autonomous action (login, buy, cancel), (d) writes result to `ButlerAuditLog`
- New routes: `POST /api/butler/action` — receive action intent (login/buy/cancel + store + params), dispatch to browser-agent
- Stagehand AI actions: use `@browserbasehq/stagehand` `page.act()` for sites not in the existing hard-coded selectors (`store-actions.ts` handles Amazon/Walmart/Target/BestBuy/eBay with CSS selectors; Netflix, Publix, etc. need Stagehand AI-driven actions)
- New Prisma migration: add `ButlerAction` model to track action requests (status: pending/running/done/failed, result JSON)

**Pattern to follow:** The Amazon checkout flow in `apps/api/src/services/amazon/checkout.service.ts` — it retrieves vault session, opens BrowserBase session, performs Playwright actions, writes result. Butler Protocol is the same pattern generalized to any site + credential type.

### Shopping Planner — Multi-store Aggregation + Approval Workflow

**What already exists:**
- `POST /api/approvals` approval system — `ApprovalRequest` model, SSE streams, approve/reject endpoints — fully functional
- `POST /api/retail/search` — multi-platform product search
- `POST /api/retail/compare` — cross-retailer price comparison
- Rules Engine at port 3002 — already enforces spending limits per transaction/day/week/month
- `POST /api/bots/:botId/request-payment` — the existing payment decision flow

**What is missing:**
- `ShoppingPlan` Prisma model: a plan has multiple line items (product + store + price + status), a subtotal, a state machine (draft → awaiting_approval → approved → executing → done)
- `ShoppingPlanItem` model: one item per product/store combination
- Service: `shopping-plan.service.ts` in `apps/api/src/services/` — groups items by store, calculates subtotals, triggers one `ApprovalRequest` for the whole plan (not per item)
- Route: `POST /api/shopping-plans` — create plan from a list of products, `GET /api/shopping-plans/:id` — status, `POST /api/shopping-plans/:id/approve` — user confirms, triggers execution
- Execution layer: after approval, iterate plan items grouped by store, call browser-agent for each store to add-to-cart + checkout
- OpenClaw tool: `create_shopping_plan` — takes list of items, calls API, returns plan summary with per-store subtotals and total for approval

**Approval flow reuse:** The existing `ApprovalRequest` + SSE stream is sufficient. Shopping plan approval is just one `ApprovalRequest` with a JSON payload that references the plan. No changes to the approval system needed.

### Audio vs Text Routing

**What already exists — this feature is essentially DONE:**
- `/root/openclaw/index.js` lines 3731-3808: `sendVoiceOrTextReply()` + `parseResponseFormat()` + `shouldForceText()`
- The LLM is instructed to prefix responses with `[FORMAT:TEXT]` or `[FORMAT:AUDIO]`
- `shouldForceText()` heuristic: forces text when response has prices, URLs, 3+ list items, tables, 5+ numbers, or 150+ words
- TTS fallback chain: Gemini TTS → ElevenLabs → edge-tts

**What is missing:**
- The rule is implemented in OpenClaw (Telegram) but needs to be verified/applied in `apps/api/src/services/jarvis-whatsapp.service.ts` (WhatsApp path) — check that WhatsApp also uses the same `[FORMAT:TEXT]`/`[FORMAT:AUDIO]` pattern
- The system prompt in `gemini.js` must explicitly document the rule with examples so the LLM applies it consistently — currently the rule exists in code but may not be in the system prompt clearly enough
- No new libraries needed

### Ray-Ban Meta Detection + Response Adaptation

**What already exists — detection is DONE:**
- `/root/openclaw/index.js` lines 3908-3937: regex detects "ray-ban", "meta glass", "smart glass", "óculos meta", etc.
- Saves `has_meta_glasses = true` to `openclaw_user_facts` on first detection
- Sends a usage guide immediately in the user's language (PT/ES/EN)

**What is missing:**
- Response length adaptation: when `has_meta_glasses` fact is present, the system prompt should instruct the LLM to limit responses to ~30 words for voice readout. Currently the fact is saved but not used to modify prompt behavior
- In `gemini.js` `buildSystemPrompt()`: read user facts, if `has_meta_glasses = true`, append a constraint block: "User uses Ray-Ban Meta glasses. Keep all responses under 30 words. No lists, no tables, no URLs. Single short sentence only."
- `shouldForceText()` in `index.js`: when glasses fact is detected, force AUDIO for most responses (the opposite of the default — glasses users want voice)
- WhatsApp path: same detection regex needs to be added to `jarvis-whatsapp.service.ts` or the WhatsApp system prompt handler

---

## Integration Points

### Butler Protocol → Browser Agent

```
POST /api/butler/action
  → retrieve credential from ButlerCredential (decrypt with encryptPII)
  → POST /browser/context/create (BrowserBase)
  → POST /browser/context/open-session
  → Stagehand page.act("log in with email X and password Y")
     OR playwright CSS selectors for known sites
  → POST /browser/context/close-session
  → write ButlerAction result
  → notify user via Telegram/WhatsApp
```

The `VAULT_ENCRYPTION_KEY` env var is shared — same key used by `encryptPII()` in both vault and butler services. No new env var needed.

### Shopping Planner → Approval System

```
POST /api/shopping-plans  →  creates ShoppingPlan (draft)
  → groups by store, calculates subtotals
  → creates ONE ApprovalRequest with plan_id in payload
  → existing SSE stream notifies dashboard
  → user approves → ApprovalRequest.status = APPROVED
  → executes: for each store → butler action executor → checkout
  → ShoppingPlan.status = done
```

The existing `POST /api/approvals/:id/respond` endpoint handles the user response — no changes needed there.

### Ray-Ban Meta → System Prompt

```
memory.js getFacts(userId)
  → find fact_key = 'has_meta_glasses' with fact_value = 'true'
  → gemini.js buildSystemPrompt() appends glasses constraint block
  → shouldForceText() returns false (force AUDIO for glasses users)
  → TTS sends voice note ≤30 words
```

The fact is already in PostgreSQL via `openclaw_user_facts`. The only missing piece is reading it inside `buildSystemPrompt()`.

---

## What NOT to Add

**LangChain / LangGraph** — Already in `node_modules` (transitive dep), but do not use it directly. Gemini function calling already handles tool orchestration. Adding LangChain layers would add complexity with no benefit for the 4 features in scope.

**Keytar or OS keychain** — Server-side, the existing AES-256-CBC with `VAULT_ENCRYPTION_KEY` env var is correct. Keytar is for desktop apps. Do not add it.

**Selenium or Puppeteer** — `playwright-core` + `@browserbasehq/stagehand` already covers all browser automation needs. Do not add a third browser automation library.

**A dedicated job queue (Bull/BullMQ)** — The Shopping Planner execution could theoretically use a job queue, but the existing `node-cron` + async/await pattern used by the rest of the system (price alerts, reminders) is sufficient for the plan execution phase. Add BullMQ only if plan execution failures need retry queuing — defer to post-v1.0.

**Separate microservice for Butler** — Butler Protocol runs as routes within the existing Fastify API (port 3001). The browser-agent (port 3003) is already a separate process for the heavy Playwright work. Do not add a third process.

**Vector database / embeddings** — Ray-Ban Meta detection uses a simple regex, not semantic search. The existing `openclaw_user_facts` table is the right storage layer. No vector DB needed.

**React Native / mobile SDK** — Explicitly out of scope in PROJECT.md. The Ray-Ban feature works over WhatsApp/Telegram which are the existing channels.

**OpenAI Whisper** — STT is already handled by Gemini STT (`apps/api/src/services/audio/stt.service.ts`). Do not add a competing STT provider.

---

## Prisma Migrations Needed

Two new migrations are required:

### Migration 1: Butler Actions table
```sql
-- butler_actions
id, userId, service, action (login|buy|cancel|navigate), status (pending|running|done|failed),
credentialId (FK to ButlerCredential), inputParams (JSON), result (JSON), errorMessage,
startedAt, completedAt, createdAt
```

### Migration 2: Shopping Plan tables
```sql
-- shopping_plans
id, userId, botId, title, status (draft|awaiting_approval|approved|executing|done|cancelled),
subtotals (JSON), totalAmount, currency, approvalRequestId (FK), notes, createdAt, updatedAt

-- shopping_plan_items
id, planId (FK), productName, store, productUrl, asin/sku, price, quantity, status
(pending|added_to_cart|purchased|failed), errorMessage, createdAt
```

---

## Env Vars Needed

No new external API keys required for any of the 4 features. All APIs are already configured:
- `VAULT_ENCRYPTION_KEY` — already used by butler service
- `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` — already used by browser agent
- `GEMINI_API_KEY` — already used for TTS and LLM

---

## Risk Notes

**Butler Protocol autonomous login** — Stagehand's `page.act()` is AI-driven and non-deterministic. For password-based login flows, use explicit Playwright `page.fill()` + `page.click()` with site-specific selectors rather than relying on Stagehand AI for credential entry. Stagehand is better suited for post-login navigation (finding cancel button, confirming purchase). This avoids credentials appearing in Stagehand's AI prompts.

**Shopping Planner subtotals** — Price data from the search APIs can be stale (cached in Redis). The plan subtotal shown at approval time may differ from actual checkout price. Flag this in the UI and re-verify prices at execution time.

**Ray-Ban response length** — The 30-word limit is a system prompt instruction, not a hard truncation. The LLM may occasionally exceed it. Add a post-processing guard in `sendVoiceOrTextReply()` that truncates at 50 words if the `has_meta_glasses` fact is present, as a fallback.
