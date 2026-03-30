# Architecture Research
*Generated: 2026-03-30 — PayJarvis v1.0 Shopping Agent V2*

---

## Summary

Most new features are **already partially or fully implemented** in the codebase. The main work is closing gaps in data flows, adding missing Prisma models (via migrations), and wiring existing services together. No new apps or framework changes are needed.

---

## 1. Butler Protocol — Profile Vault

### Current State
**Already implemented and production-ready.** The full stack exists:

- **Prisma models** (in `schema.prisma`): `ButlerProfile`, `ButlerCredential`, `ButlerAuditLog`, `ButlerConnectedAccount`
- **Service** (`apps/api/src/services/butler/butler-protocol.service.ts`): `setupButlerProfile`, `getButlerProfile`, `saveCredential`, `getCredential`, `listCredentials`, `logButlerAction`
- **Routes** (`apps/api/src/routes/butler.ts`): 10 endpoints under `/api/butler/*`, authenticated with `x-internal-secret`
- **OpenClaw tool** (`/root/openclaw/gemini.js`): `butler_protocol` tool declared with `setup | get_profile | update_profile | save_credential | list_credentials | get_credential | get_audit` actions
- **OpenClaw handler** (`/root/openclaw/index.js`, line 1152): Calls `/api/butler/{endpoint}` with internal secret

### Data Flow: User Saves Credentials
```
User → OpenClaw → butler_protocol(action=save_credential, data={serviceName, login, password})
  → POST /api/butler/credential/save (x-internal-secret)
  → butler-protocol.service.ts: encryptPII(login), encryptPII(password)
  → prisma.butlerCredential.upsert()
  → AES-256-CBC encrypted at rest via VAULT_ENCRYPTION_KEY
```

### Data Flow: Browser Agent Uses Credentials
**This gap exists.** The `fill_form` tool in OpenClaw calls `/fill-form` on Browser Agent directly with raw field values. The Butler credential retrieval is a separate step that the LLM must perform explicitly before calling `fill_form`.

Current flow for autonomous form fill:
```
1. LLM calls butler_protocol(action=get_credential, data={serviceName})
   → /api/butler/credential/get → returns {login, password} (decrypted)
2. LLM calls fill_form(url=serviceUrl, fields={email: login, password: password})
   → /fill-form on Browser Agent (port 3003)
   → Stagehand fills form fields, waits for user confirmation before submit
```

The gap: **the LLM is responsible for chaining these two tool calls.** There is no automatic "butler-aware fill_form" that fetches credentials automatically. This works but relies on LLM reasoning. For reliability, a dedicated `butler_autofill` tool that internally retrieves credentials and triggers fill_form would be more robust.

### What Needs to Be Created
- A `butler_autofill` tool in `gemini.js` that takes only `{serviceName}` and internally chains credential retrieval + browser fill — removes LLM ambiguity.
- A `/api/butler/autofill` route in the API that retrieves credentials and calls Browser Agent's `/fill-form` endpoint server-side.

### Encryption Pattern
Same as existing `UserAccountVault` (Amazon cookies): AES-256-CBC with `VAULT_ENCRYPTION_KEY` (64-char hex = 32 bytes), stored as `"iv_hex:ciphertext_hex"`. The `encryptPII`/`decryptPII` helpers in `apps/api/src/services/vault/crypto.ts` are already used.

---

## 2. Shopping Planner

### Current State
**Already implemented.** The full stack exists:

- **Prisma model** (`schema.prisma`): `ShoppingList` (stores userId, title, theme, location, items as JSON, totalEstimated, currency, status, sharedWith)
- **Service** (`apps/api/src/services/shopping/shopping-planner.service.ts`): `generateShoppingPlan`, `formatShoppingPlan`, `getUserLists`, `getList`, `updateListStatus`
- **Routes** (`apps/api/src/routes/shopping-planner.routes.ts`): `POST /api/shopping/plan`, `GET /api/shopping/lists/:userId`, `GET /api/shopping/lists/detail/:id`, `PATCH /api/shopping/lists/:id/status`
- **OpenClaw tool** (`gemini.js`): `shopping_planner` tool declared and handled

### Data Flow: Plan Generation
```
User: "make me a baby registry for Orlando FL"
  → Gemini routes to shopping_planner(theme, location, budget)
  → /api/shopping/plan (OpenClaw toolHandler)
  → generateShoppingPlan():
      1. Gemini generates item list by category (Redis cached 1h)
      2. Parallel unifiedProductSearch per category (max 10, 25s timeout)
      3. Gemini estimates missing prices
      4. Groups by store
      5. findCoupons() for top stores
      6. prisma.shoppingList.create() with status="draft"
  → Returns formatted pre-order text with action menu (options 1-6)
```

### Approval Workflow Gap
The service generates and saves a `draft` plan, and `formatShoppingPlan` outputs an action menu (approve/remove items/change store/add/save/share). However, **the approval workflow is purely conversational** — the user replies "1" or "approve", and the LLM handles it as text.

There is no structured approval flow with:
- A `ShoppingListApproval` model tracking what was approved/rejected
- A direct "approve and buy all" execution path that calls the purchase orchestrator per item
- WhatsApp/Telegram button callbacks (inline keyboards) — the current menu is just text

### What Needs to Be Created
- `ShoppingListApproval` Prisma model (or extend `ShoppingList` with `approvedAt`, `approvedItems`, `rejectedItems` fields)
- A `shopping_plan_action` tool in `gemini.js` for structured responses to the action menu (approve, remove item, change store, add item, save)
- A `/api/shopping/lists/:id/approve` route that marks items approved and triggers purchase orchestration per item
- Inline keyboard buttons in OpenClaw's Telegram handler for plan actions (Telegram Bot API `InlineKeyboardButton`) — requires `bot.on('callback_query:data')` handler in `/root/openclaw/index.js`

### Existing Integration Points
- `unifiedProductSearch` from `apps/api/src/services/search/unified-search.service.ts` — already used
- `findCoupons` from `apps/api/src/services/shopping/coupons.service.ts` — already used
- `purchase-orchestrator.service.ts` — would be the downstream consumer for approved items

---

## 3. Audio vs Text Routing

### Current State
**Already fully implemented in OpenClaw.** The routing logic is complete:

- **Rule defined** in `gemini.js` (line ~456-461): LLM system prompt instructs Gemini to prefix all responses to voice messages with `[FORMAT:TEXT]` or `[FORMAT:AUDIO]`
  - `[FORMAT:TEXT]`: prices, links, lists (3+ items), comparisons, data, anything consultable
  - `[FORMAT:AUDIO]`: casual greetings, short confirmations, 1-2 sentence no-data responses
- **Heuristic fallback** in `index.js` (`shouldForceText()`, line ~3786): Content analysis for cases where the LLM omits the tag — checks for prices, URLs, long lists, tables, many numbers
- **Dispatch** in `sendVoiceOrTextReply()` (line ~3731): Parses `[FORMAT:...]` tag, routes to `ctx.replyWithVoice()` or `ctx.reply()`
- **Scope**: The tag is only required for voice-input messages (`[voice]` prefix in system prompt). Text-input messages use the heuristic only.

### What Needs to Be Created
The current implementation has one gap: **the FORMAT rule only applies to OpenClaw (Telegram).** The WhatsApp handler (`jarvis-whatsapp.service.ts`) does not use the same routing. If audio vs text routing should be consistent across channels, the `shouldForceText` heuristic should be applied to WhatsApp responses too.

No new Prisma models needed. No new services needed. The rule is already working.

---

## 4. Ray-Ban Meta Detection

### Current State
**Already implemented in OpenClaw (Telegram).** Detection and storage work:

- **Detection** (`/root/openclaw/index.js`, line ~3908): Regex pattern matches `ray-ban`, `meta glass`, `smart glass`, `óculos meta`, and variants in user text
- **Storage** (`memory.js`): `upsertFact(userId, 'has_meta_glasses', 'true', 'device', 'auto')` — stored in `openclaw_user_facts`
- **System prompt injection** (`gemini.js`, line ~175): When `has_meta_glasses` fact exists, system prompt adds: "Shopping responses MUST be ULTRA-SHORT (max 2 lines) so the glasses can read them aloud comfortably."
- **Guide message**: First detection triggers a trilingual guide (pt/en/es) explaining how to use Jarvis via Ray-Ban Meta

### Gaps
1. **WhatsApp not covered** — `jarvis-whatsapp.service.ts` does not check for `has_meta_glasses` fact or apply the short-response constraint. Most Ray-Ban Meta users likely use WhatsApp (voice via "Hey Meta, send message to...").
2. **PayJarvis API user_facts not synced** — The `has_meta_glasses` fact lives in `openclaw_user_facts` (raw SQL table in PayJarvis PostgreSQL). The `User` model in Prisma does not have a `deviceType` or `uiPreferences` field. This is fine architecturally — the fact system is the right place — but the WhatsApp handler needs access to OpenClaw's fact lookup.
3. **No explicit WhatsApp detection trigger** — WhatsApp handler doesn't run the meta-glasses regex.

### What Needs to Be Created
- In `jarvis-whatsapp.service.ts`: Add meta-glasses detection regex + `upsertFact` call on first detection
- In `jarvis-whatsapp.service.ts`: Load `has_meta_glasses` fact before building system prompt, inject short-response constraint

No new Prisma models needed. The `openclaw_user_facts` table is already shared between Telegram and WhatsApp bots (same PostgreSQL, same userId).

---

## 5. Supabase Migration

### Current State
**PayJarvis is already migrated.** The `.env.production` file shows:
```
DATABASE_URL="postgresql://payjarvis@localhost:5432/payjarvis"  # (password redacted)
```
The Supabase URL is commented out. PayJarvis runs on local PostgreSQL already.

The migration task refers to **9 other projects** (OpenClaw, MorgatIA, DesckPRO, VibeClass, etc.) that still use Supabase.

### Approach Per Project Type
**TypeScript/Prisma projects** (most common):
1. `pg_dump` from Supabase cloud → `pg_restore` into local PostgreSQL
2. Create dedicated DB user: `CREATE USER project_name WITH PASSWORD '...'`
3. Update `.env.production`: change `DATABASE_URL` to `localhost:5432/project_name`
4. Run `prisma migrate deploy` to verify schema integrity
5. Restart via PM2

**Raw SQL projects** (OpenClaw, projects without Prisma):
1. `pg_dump --schema-only` to get DDL
2. `pg_dump --data-only` for data
3. Create new local DB, restore
4. Update connection string in code/env

**Shared tables note**: `openclaw_conversations`, `openclaw_user_facts`, `openclaw_reminders`, and premium pipeline tables (`agent_episodic_events`, etc.) already live in the `payjarvis` local PostgreSQL. OpenClaw uses `DATABASE_URL` from its own env which already points to localhost.

### What Needs to Be Created (per migrated project)
- Local PostgreSQL database + user (CLI only, no code changes)
- Updated `.env.production` per project
- Supabase project deletion after verification

---

## 6. Disk Optimization

### Current State
VPS at **88% disk usage** (169G/193G). Observed in live check.

### Cleanup Targets (estimated impact)
| Target | Command | Estimated Recovery |
|--------|---------|-------------------|
| Sandboxes (`/root/sandbox/`) | `rm -rf /root/sandbox/*` | 2-10 GB |
| Duplicate node_modules (non-monorepo projects) | `find /root -name "node_modules" -maxdepth 4 -not -path "*/Payjarvis/*" -exec du -sh {} \;` then prune | 3-8 GB |
| PM2 logs | `pm2 flush` | 0.5-2 GB |
| Docker layer cache | `docker system prune -f` | 1-5 GB |
| Next.js build cache (`.next/`) in old projects | Manual | 1-3 GB |
| OS package cache | `apt clean && apt autoremove` | 0.5 GB |

### What Needs to Be Created
No code changes. This is purely a disk cleanup operation run as bash commands. Suggested order: PM2 flush → apt clean → docker prune → sandbox cleanup → node_modules audit.

---

## New Components

| Component | Location | Status |
|-----------|----------|--------|
| `butler_autofill` tool | `gemini.js` tool declarations | Missing — LLM must manually chain 2 tools |
| `/api/butler/autofill` route | `apps/api/src/routes/butler.ts` | Missing — server-side credential+fill orchestration |
| Shopping plan approval model | `packages/database/prisma/schema.prisma` | Missing — extend `ShoppingList` or add `ShoppingListApproval` |
| `shopping_plan_action` tool | `gemini.js` | Missing — structured handler for plan action menu |
| `/api/shopping/lists/:id/approve` | `apps/api/src/routes/shopping-planner.routes.ts` | Missing |
| Telegram inline keyboard callbacks | `/root/openclaw/index.js` | Missing for shopping plan actions |
| Ray-Ban Meta detection for WhatsApp | `apps/api/src/services/jarvis-whatsapp.service.ts` | Missing |
| Audio/text routing for WhatsApp | `apps/api/src/services/jarvis-whatsapp.service.ts` | Missing |

---

## Modified Components

| Component | Change Needed |
|-----------|---------------|
| `gemini.js` | Add `butler_autofill` tool declaration; add `shopping_plan_action` tool |
| `/root/openclaw/index.js` | Add `butler_autofill` tool handler; add `shopping_plan_action` handler; add `bot.on('callback_query:data')` for inline keyboards |
| `jarvis-whatsapp.service.ts` | Add Ray-Ban Meta detection; add `shouldForceText` heuristic; load `has_meta_glasses` fact |
| `schema.prisma` | Add `ShoppingListApproval` model (or extend `ShoppingList` with approval fields) |
| `shopping-planner.routes.ts` | Add `/api/shopping/lists/:id/approve` endpoint |

---

## Data Flow Changes

### Butler: Autonomous Form Fill (new unified flow)
```
User: "cria conta pra mim no Best Buy"
  → LLM calls butler_autofill(serviceName="Best Buy", serviceUrl="bestbuy.com")
  → POST /api/butler/autofill (x-internal-secret)
    → getCredential(userId, "Best Buy") — decrypt from DB
    → GET profile (fullName, email, address, phone)
    → POST /fill-form on Browser Agent (port 3003)
      → Stagehand navigates to serviceUrl, fills form fields
      → Returns screenshot + status
  → LLM: "🎩 Butler Protocol: Form filled at Best Buy. Confirm to submit?"
  → User confirms → browser submits
```

### Shopping Planner: Approval to Purchase (new flow)
```
User: "approve and buy everything"
  → LLM calls shopping_plan_action(listId, action="approve_all")
  → POST /api/shopping/lists/:id/approve
    → Mark ShoppingList.status = "approved"
    → For each item: call purchase-orchestrator if store is automatable
    → Returns {approved: N, manualRequired: [{store, items}]}
  → LLM: "Ordered X items automatically. Y items from [store] need manual checkout."
```

### Ray-Ban Meta: WhatsApp Response Adaptation (new flow)
```
Incoming WhatsApp message
  → jarvis-whatsapp.service.ts
  → Run meta-glasses regex on message text
  → If match: upsertFact(userId, 'has_meta_glasses', 'true')
  → Load facts: getFacts(userId)
  → If has_meta_glasses: inject short-response constraint in system prompt
  → Run shouldForceText(response) heuristic before sending
  → Send text or voice based on result
```

---

## Data Model Additions

### Extend ShoppingList (preferred — avoids new migration complexity)
Add columns to existing `shopping_lists` table via migration:

```prisma
model ShoppingList {
  // ... existing fields ...
  approvedAt      DateTime?  @map("approved_at")
  approvedItems   Json?      @default("[]") @map("approved_items")    // item names approved
  rejectedItems   Json?      @default("[]") @map("rejected_items")    // item names rejected
  purchasedAt     DateTime?  @map("purchased_at")
  purchaseResult  Json?      @map("purchase_result")  // {ordered, failed, manualRequired}
}
```

This avoids a separate `ShoppingListApproval` model and keeps the schema flat. The `status` field already handles the lifecycle: `draft → approved → purchasing → complete | partial`.

### No other new models needed
- Butler: already has `ButlerProfile`, `ButlerCredential`, `ButlerAuditLog`
- Audio routing: no persistence needed (runtime decision)
- Ray-Ban Meta: already uses `openclaw_user_facts` table

---

## Suggested Build Order

Based on dependencies and risk:

### Phase 1 — Disk Optimization (blocker, no code)
**Why first**: VPS is at 88%. Every build step adds disk usage. Clean before building.
- Run cleanup commands: PM2 flush, apt, docker prune, sandbox removal, node_modules audit

### Phase 2 — Audio vs Text Routing for WhatsApp
**Why second**: Zero risk, no new models, no migrations. Adds `shouldForceText()` heuristic to `jarvis-whatsapp.service.ts`. Pure code change in one file, 30-line addition.

### Phase 3 — Ray-Ban Meta for WhatsApp
**Why third**: Builds on Phase 2's WhatsApp work. Same file, same session. Adds detection regex + fact upsert + system prompt injection. No migrations.

### Phase 4 — Butler Protocol: Autofill Gap
**Why fourth**: Butler data is already stored and encrypted. This phase only adds the `/api/butler/autofill` orchestration route and a `butler_autofill` tool in OpenClaw. No new Prisma models needed.

### Phase 5 — Shopping Planner: Approval Workflow
**Why fifth**: Requires a migration to extend `ShoppingList`. New tool in `gemini.js`, new route, and Telegram inline keyboard callbacks in OpenClaw. More moving parts — do after simpler phases.

### Phase 6 — Supabase Migration
**Why last**: Highest operational risk (data migration, potential downtime for other projects). PayJarvis itself is already migrated. This phase affects 9 other projects and requires individual validation per project. Do when VPS disk is clean (Phase 1) and the team has headspace.

### Dependency Graph
```
Phase 1 (Disk)
  └─ Phase 2 (Audio/Text WhatsApp)
      └─ Phase 3 (Ray-Ban WhatsApp)
Phase 4 (Butler Autofill)  ← independent of 2,3
Phase 5 (Shopping Approval) ← independent, but needs migration window
Phase 6 (Supabase)          ← independent, highest risk
```

---

## Key Findings

1. **Butler Protocol is complete** for CRUD. The only missing piece is the autofill orchestration (chaining credential retrieval + browser fill in one server-side call).

2. **Shopping Planner is complete** for plan generation. The approval workflow is conversational only — no structured approval model or inline buttons exist yet.

3. **Audio vs Text routing is already working** in Telegram via `[FORMAT:TEXT/AUDIO]` LLM tags + `shouldForceText` heuristic. WhatsApp has none of this.

4. **Ray-Ban Meta detection works in Telegram**. The WhatsApp handler has no equivalent detection or short-response adaptation.

5. **PayJarvis is already on local PostgreSQL** — the Supabase migration for this project is done. The remaining migration work is for 9 other projects that are not PayJarvis.

6. **No new apps, services, or frameworks needed.** All features extend existing files.
