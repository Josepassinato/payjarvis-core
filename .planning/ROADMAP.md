# Roadmap: PayJarvis v1.0

**Milestone:** v1.0 Shopping Agent V2
**Created:** 2026-03-30
**Phases:** 6
**Requirements:** 25

---

## Phase 1: VPS Disk Cleanup

**Goal:** Reduce disk usage from 83%+ to below 60% so Turborepo builds cannot trigger ENOSPC mid-compile.
**Requirements:** INFRA-01, INFRA-02

### Success Criteria
1. `df -h` shows the root partition at or below 60% used
2. `pm2 flush` runs without error and log directory is cleared
3. Sandbox directories under `/root/sandbox/` are removed or archived
4. `bash /root/Payjarvis/scripts/smoke-test.sh` still passes 17/17 after cleanup
5. A full `turbo build` completes without any ENOSPC error

### Notes
- Targets: `pm2 flush`, `apt clean`, Docker images/containers, `/root/sandbox/*`, duplicate `node_modules` in archived projects
- Do NOT delete active PM2 process dist/ directories — only archived/stale build artifacts
- Verify `df -h` before AND after; target is <60%, hard stop at 70%
- This phase is a hard blocker — no other phase may start until disk is below 60%

---

## Phase 2: Audio vs Text Routing + Ray-Ban Meta (WhatsApp)

**Goal:** Port Telegram's audio/text routing rule and Ray-Ban Meta detection to WhatsApp so both channels behave identically.
**Requirements:** AUDIO-01, AUDIO-02, AUDIO-03, AUDIO-04, META-01, META-02, META-03, META-04, META-05

### Success Criteria
1. A WhatsApp message asking for prices returns text, not an audio file
2. A WhatsApp casual greeting from a user with voice preference receives an audio response
3. A WhatsApp message longer than 40 words in response is delivered as text regardless of preference
4. A user who mentions "Ray-Ban Meta" or "smart glasses" on WhatsApp gets `has_meta_glasses` saved as a `user_fact`
5. That same user's next WhatsApp response is capped at 30 words with rich content sent separately

### Notes
- Telegram implementations already work — this phase is a port, not a rebuild
- `shouldForceText()` logic lives in the Telegram path; decision: inline duplication in `jarvis-whatsapp.service.ts` for v1.0 speed, document as tech debt for post-v1.0 shared module extraction
- Ray-Ban Meta detection uses same regex and `upsertFact` pattern already in OpenClaw; add `has_meta_glasses` check + post-generation word count guard (truncate at 30 words) to WhatsApp handler
- No Prisma migrations needed — `openclaw_user_facts` table already exists
- No new env vars needed — all existing keys cover this
- AUDIO-04 and META-05 are the acceptance gates: both channels must behave identically

---

## Phase 3: Butler Protocol — Autofill Execution Layer

**Goal:** Close the single gap in the Butler Protocol by adding the autofill orchestration route that chains credential retrieval + browser form fill in one server-side call.
**Requirements:** BUTL-01, BUTL-02, BUTL-03, BUTL-04, BUTL-05, BUTL-06, BUTL-07

### Success Criteria
1. A user can tell Jarvis "buy X on Amazon" and Jarvis retrieves saved credentials, fills the form, and completes the action without the user re-entering credentials
2. When a CAPTCHA is encountered during an action, Jarvis stops, sends a screenshot to the user, and waits — it does NOT retry automatically
3. When a 2FA prompt appears, the session enters AWAITING_2FA state and the user has 90 seconds to forward the code before the session times out
4. Every credential access and autonomous action appears in the audit log with timestamp, actor, and target site
5. Action templates for Amazon buy, Netflix cancel, and Publix order execute without manual tool chaining

### Notes
- Butler CRUD is production-ready: `ButlerProfile`, `ButlerCredential`, `ButlerAuditLog`, service + 10 routes + OpenClaw tool all exist
- Remaining work: `butler_autofill` tool in `gemini.js` + `/api/butler/autofill` route that orchestrates credential retrieval + browser fill in one call
- Architecture decision (pre-build): commit to `ButlerCredential` as canonical store; `SecureItem` is for user-managed vault items — do NOT merge models
- Execution model: synchronous for v1.0 (fire and wait); `ButlerAction` model deferred — `ButlerAuditLog` covers completed action tracking
- CRITICAL PITFALL: Add `redact: ['body.password', 'body.credentials', 'body.cookiesEnc', 'body.login']` to Fastify logger config BEFORE deploying this route — plaintext credentials in PM2 logs is a security incident
- Amazon-specific: implement `butler:active:amazon` Redis counter (max 3 concurrent sessions); hand off on FIRST CAPTCHA encounter, never retry — retries trigger account locks
- No new Prisma migration needed for this phase (no `ButlerAction` model)

---

## Phase 4: Shopping Planner — Approval Workflow

**Goal:** Add the user approval layer to Shopping Planner so users can review, modify, and confirm purchase plans before Jarvis executes them.
**Requirements:** SHOP-01, SHOP-02, SHOP-03, SHOP-04, SHOP-05, SHOP-06, SHOP-07, SHOP-08

### Success Criteria
1. A user asking "plan my weekly groceries for $150" receives a structured plan grouped by store with subtotals and grand total
2. The plan is presented with approve/remove/swap-store options — Telegram shows inline keyboard buttons, WhatsApp shows numbered text options
3. After approval, Jarvis re-validates all prices within 1 hour; if any price changed, the user is notified before execution proceeds
4. Budget-aware optimization applies: safety/health items get premium options, remaining items get economy options
5. A plan approved and executed leaves a `purchaseResult` on the `ShoppingList` record with order IDs and final totals

### Notes
- Plan generation is complete (`ShoppingList` model, `generateShoppingPlan()` service, routes, OpenClaw tool, multi-source search, coupon lookup)
- Remaining work: `shopping_plan_action` tool in `gemini.js` + `/api/shopping/lists/:id/approve` route + extend `ShoppingList` with `approvedAt`, `approvedItems`, `rejectedItems`, `purchaseResult` (4 nullable JSON fields)
- Architecture decision: extend `ShoppingList` (flat, avoids join complexity) — NOT a separate `ShoppingListApproval` model
- Telegram UX: `bot.on('callback_query:data')` handler in `/root/openclaw/index.js` — touches high-traffic entry point, plan callback handler architecture carefully before writing
- WhatsApp UX: text-based numbered options (reply "1" to approve, "2" to remove item X) — simpler, no keyboard API needed
- PITFALL: Store `planPrice` and `validatedAt` per line item; re-validate within 1 hour of execution; flag non-Amazon pre-orders as "price not guaranteed"
- Migration window needed: `prisma migrate dev` in sandbox first, `prisma migrate deploy` to production — NEVER `db push`
- Most complex phase — do after Phases 2 and 3 are stable

---

## Phase 5: Supabase → VPS PostgreSQL Migration

**Goal:** Migrate 9 active projects from Supabase to local PostgreSQL, delete 14 dead projects, and cancel the Supabase account to eliminate $150/month cost.
**Requirements:** INFRA-03, INFRA-04, INFRA-05

### Success Criteria
1. All 9 projects have their schemas and data running on local PostgreSQL with zero data loss verified via row counts
2. Each migrated project passes its own smoke test or health check after cutover
3. All 14 dead Supabase projects are deleted from the Supabase dashboard
4. A 1-week verification period passes with all 9 projects healthy on local PostgreSQL
5. Supabase account is canceled and the $150/month charge stops appearing on billing

### Notes
- PayJarvis is already on local PostgreSQL — this phase affects 9 OTHER projects only
- Requires Phase 1 (disk cleanup) to be complete first — importing 9 databases needs headroom
- Per-project process: pg_dump from Supabase → pg_restore to local → update DATABASE_URL in each project's .env → restart PM2 process → verify health
- Verification period: 1 week minimum before canceling account (data safety)
- Highest operational risk phase — take a VPS snapshot before starting
- Track projects: nucleo-empreende, browser-agent, imigrai, openclaw, soma-id + 4 others (audit before starting)
- Do NOT cancel Supabase account until all 9 projects are verified healthy on local PG

---

## Phase 6: Post-Migration Validation & Milestone Close

**Goal:** Confirm all 25 requirements are met, all systems are healthy, and the milestone is ready to archive.
**Requirements:** (validation gate — references all 25 requirements across Phases 1-5)

### Success Criteria
1. `bash /root/Payjarvis/scripts/smoke-test.sh` passes 17/17 checks
2. Playwright E2E suite passes 29/29 tests
3. All 5 functional features (disk, audio routing, Ray-Ban Meta, Butler autofill, Shopping approval) produce expected outputs in manual spot-check
4. Supabase account shows $0 recurring charges and all 14 dead projects are deleted
5. VPS disk remains below 60% with all projects running

### Notes
- This phase has no new code — it is a validation and documentation gate
- Run smoke test AND Playwright suite before declaring milestone complete
- Update PROJECT.md: move all 25 active requirements to Validated section
- Update MILESTONES.md with shipped date and key deliverables
- Trigger `/gsd:complete-milestone` after this phase passes

---

## Requirement Coverage

| Requirement | Phase |
|-------------|-------|
| INFRA-01 | Phase 1 |
| INFRA-02 | Phase 1 |
| INFRA-03 | Phase 5 |
| INFRA-04 | Phase 5 |
| INFRA-05 | Phase 5 |
| BUTL-01 | Phase 3 |
| BUTL-02 | Phase 3 |
| BUTL-03 | Phase 3 |
| BUTL-04 | Phase 3 |
| BUTL-05 | Phase 3 |
| BUTL-06 | Phase 3 |
| BUTL-07 | Phase 3 |
| SHOP-01 | Phase 4 |
| SHOP-02 | Phase 4 |
| SHOP-03 | Phase 4 |
| SHOP-04 | Phase 4 |
| SHOP-05 | Phase 4 |
| SHOP-06 | Phase 4 |
| SHOP-07 | Phase 4 |
| SHOP-08 | Phase 4 |
| AUDIO-01 | Phase 2 |
| AUDIO-02 | Phase 2 |
| AUDIO-03 | Phase 2 |
| AUDIO-04 | Phase 2 |
| META-01 | Phase 2 |
| META-02 | Phase 2 |
| META-03 | Phase 2 |
| META-04 | Phase 2 |
| META-05 | Phase 2 |

**Coverage: 25/25 (100%)**

---
*Roadmap created: 2026-03-30*
*Build order rationale: Disk cleanup (deploy blocker) → Audio/Meta ports (zero risk, same file) → Butler autofill (independent, no migration) → Shopping approval (most complex, migration needed) → Supabase migration (highest operational risk, needs disk headroom) → Validation close*
