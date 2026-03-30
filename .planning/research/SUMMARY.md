# Research Summary: Shopping Agent V2

> Synthesized: 2026-03-30
> Sources: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## Key Finding

**Most of the Shopping Agent V2 work is already built — the gaps are wiring, not construction.**

Butler Protocol CRUD is production-ready. Shopping Planner generates plans. Audio/text routing works in Telegram. Ray-Ban Meta detection works in Telegram. The single theme across all 4 features: **WhatsApp has none of it, and the existing implementations need 1-3 targeted gaps closed each to be complete.**

The only truly new infrastructure is 2 Prisma migrations and 2 new API routes. Everything else is wiring existing services together or porting logic from Telegram to WhatsApp.

---

## Stack Additions

| Package | Why | Where |
|---------|-----|-------|
| `zod ^3.22` | Runtime validation for Butler action payloads | `apps/api/package.json` (already in browser-agent, not in api) |

No new frameworks, runtimes, databases, or external APIs required. All 3 existing env vars (`VAULT_ENCRYPTION_KEY`, `BROWSERBASE_API_KEY`, `GEMINI_API_KEY`) cover all 4 features.

---

## Feature Readiness

| Feature | Already Built | Remaining Work | Complexity |
|---------|--------------|----------------|------------|
| Butler Protocol — Credential Vault | Full CRUD: `ButlerProfile`, `ButlerCredential`, `ButlerAuditLog`, service + 10 routes + OpenClaw tool | `butler_autofill` tool + `/api/butler/autofill` route that chains credential retrieval + browser fill server-side; add `ButlerAction` Prisma model + migration | High |
| Shopping Planner — Plan Generation | `ShoppingList` model, `generateShoppingPlan()` service, routes, OpenClaw tool, multi-source search, coupon lookup | Nothing — plan generation is complete | — |
| Shopping Planner — Approval Workflow | Conversational action menu only | `shopping_plan_action` tool + `/api/shopping/lists/:id/approve` route + extend `ShoppingList` with `approvedAt/approvedItems/rejectedItems/purchaseResult` fields + Telegram inline keyboard callbacks | High |
| Audio vs Text Routing | Fully working in Telegram (`[FORMAT:TEXT/AUDIO]` tags + `shouldForceText()` heuristic) | Port `shouldForceText()` to `jarvis-whatsapp.service.ts`; verify system prompt includes the format rule | Low |
| Ray-Ban Meta Detection | Fully working in Telegram (regex detection + `has_meta_glasses` fact + system prompt constraint + usage guide) | Add detection regex + `upsertFact` + system prompt injection to `jarvis-whatsapp.service.ts` | Low |
| Ray-Ban Meta — Response Adaptation | System prompt constraint ("max 2 lines") exists in Telegram | Add post-generation word count guard (truncate at 50 words if `has_meta_glasses`); force AUDIO routing for glasses users | Low |

---

## Recommended Build Order

1. **Disk Cleanup** (blocker — VPS at 83-88% disk)
   Reason: Every Turborepo build generates dist/ + .next/ files. An `ENOSPC` mid-build leaves broken half-compiled processes. Clean before touching code.
   Actions: `pm2 flush` → `apt clean` → `docker container prune` → `/root/sandbox/*` → audit largest `node_modules`.

2. **Audio/Text Routing for WhatsApp** (zero risk, 1 file, no migrations)
   Reason: Pure code addition to `jarvis-whatsapp.service.ts`. No Prisma changes. Closes the WhatsApp/Telegram parity gap for the feature that's already fully built. Estimated: 30-line addition.

3. **Ray-Ban Meta for WhatsApp** (builds on Phase 2, same file, same session)
   Reason: After Phase 2's WhatsApp work, adding the detection regex + fact upsert + system prompt injection to the same file is minimal. No migrations. Add the post-generation word count guard at the same time.

4. **Butler Protocol: Autofill Gap** (independent of Phases 2-3, no new migrations)
   Reason: Butler data is already encrypted and stored. This phase only adds the `/api/butler/autofill` orchestration route and `butler_autofill` tool in OpenClaw. Eliminates the LLM-must-chain-two-tools fragility. No Prisma models needed.

5. **Shopping Planner: Approval Workflow** (requires migration window, most moving parts)
   Reason: Needs a `ShoppingList` migration (add 4 fields), a new tool in `gemini.js`, a new route, and Telegram inline keyboard callback handling in OpenClaw. Most complex phase — do after simpler phases are stable.

6. **Supabase Migration for other 9 projects** (highest operational risk, PayJarvis already done)
   Reason: PayJarvis is already on local PostgreSQL. The remaining migration affects 9 other projects and requires per-project validation. Needs clean disk (Phase 1) and a maintenance window.

---

## Critical Pitfalls

1. **Credential logging via Fastify default logger**
   A `POST /api/butler/autofill` or `/api/vault/zk/store` request with a body containing `{password: "..."}` will appear in PM2 logs in plaintext unless Fastify's `redact` config covers it. PM2 logs are read by the smoke test and visible to anyone with server access.
   Prevention: Add `redact: ['body.password', 'body.credentials', 'body.cookiesEnc', 'body.login']` to the Fastify logger config before deploying Butler autofill.

2. **`prisma db push --accept-data-loss` drops the OpenClaw raw SQL tables**
   The `openclaw_conversations`, `openclaw_user_facts`, and `openclaw_reminders` tables exist as raw SQL, not in Prisma-managed migrations. A `db push` command silently drops them. If this happens during Shopping Planner or Butler migrations, all user conversation history and facts (including `has_meta_glasses`) are destroyed with no automatic recovery.
   Prevention: Always use `prisma migrate dev` (sandbox) or `prisma migrate deploy` (production). Never `db push` in any environment with live data.

3. **Amazon bot detection causes full account locks, not just CAPTCHAs**
   Amazon's detection stack (TLS fingerprinting, residential vs datacenter IP, behavioral heuristics) frequently blocks BrowserBase IP ranges used by other automation tools on the same infrastructure. Expect full account locks during Butler development. The handoff must trigger on the FIRST CAPTCHA encounter, not after retries — after 2-3 failed attempts, Amazon escalates to unsolvable challenges and may lock the account.
   Prevention: Implement per-store concurrency limits (`butler:active:<store>` Redis counter, max 3 concurrent Amazon sessions). Never retry CAPTCHA automatically — hand off to user immediately.

4. **Shopping Plan price staleness: plan price ≠ execution price**
   Redis caches commerce search results with variable TTL. A plan approved at T+0 and executed at T+24h may have prices that changed (Amazon dynamic pricing, out-of-stock items, expired flash sales). If the plan executes at the stale price and charges the user more, it's a trust-destroying experience.
   Prevention: Store `planPrice` and `validatedAt` per line item. Re-validate all prices within 1 hour of execution. Flag pre-orders from non-Amazon retailers as "price not guaranteed."

5. **VPS disk at 83-88% causes `ENOSPC` mid-build, leaving broken PM2 processes**
   A Turborepo build that generates `dist/` and `.next/` for 4 apps simultaneously can push disk from 83% to 90%+. An `ENOSPC` error mid-build leaves half-compiled `dist/` directories. PM2 then starts the broken process, which crashes immediately but PM2 marks as "online" until the next log check.
   Prevention: Run disk cleanup (Phase 1) before any build. Verify `df -h` shows below 70% before starting a Turborepo build. Run `bash /root/Payjarvis/scripts/smoke-test.sh` after every deploy to catch broken processes before reporting "done."

---

## Architecture Decisions Needed

1. **Butler credential storage: extend `SecureItem` or use `ButlerCredential` model?**
   The `ButlerCredential` model already exists in Prisma and is used by `butler-protocol.service.ts`. The `SecureItem` model (`itemType: password`) exists in the ZK Vault. Both store AES-256 encrypted credentials. Using two parallel storage mechanisms for the same data type creates confusion about which one to query.
   Decide before building: commit to `ButlerCredential` as the canonical store for Butler-managed credentials, and document that `SecureItem` is for user-managed vault items. Do not merge the two models.

2. **Shopping Plan approval: extend `ShoppingList` model or create `ShoppingListApproval`?**
   ARCHITECTURE.md recommends extending `ShoppingList` with `approvedAt`, `approvedItems`, `rejectedItems`, `purchasedAt`, `purchaseResult` (4 nullable JSON fields). This avoids a second migration and keeps the schema flat. The alternative — a separate `ShoppingListApproval` model — adds join complexity for no clear benefit at this scale.
   Recommended: extend `ShoppingList`. Decide before writing the migration.

3. **Telegram inline keyboard for Shopping Planner: grammY callback query or text parsing?**
   The current Shopping Planner action menu is text-based ("reply 1-6"). Adding Telegram `InlineKeyboardButton` requires a `bot.on('callback_query:data')` handler in `/root/openclaw/index.js`. This is a cleaner UX but touches the main bot entry point — a high-traffic, high-risk file.
   Decide before building: if inline keyboards are in scope for v1.0, plan the callback handler architecture before writing it. If text parsing is acceptable for now, defer inline keyboards to a post-v1.0 enhancement.

4. **WhatsApp audio routing: port `shouldForceText()` inline or extract to shared module?**
   PITFALLS.md explicitly flags that embedding routing logic per-channel causes inconsistency. ARCHITECTURE.md says the rule should be a shared service or middleware. This means creating a new shared utility (e.g., `packages/types` or a new `packages/utils`) or accepting short-term duplication and refactoring later.
   Decide before writing: extracting to a shared module is the right long-term call but requires a workspace package change. Inline duplication is faster for v1.0. Pick one and document the decision.

5. **`ButlerAction` Prisma model: necessary for v1.0 or defer?**
   STACK.md calls for a `ButlerAction` model to track action request status (pending/running/done/failed). The existing `ButlerAuditLog` already logs completed actions. The gap is tracking in-flight actions for status polling and retry logic. If Butler autofill in v1.0 is synchronous (fire and wait for result), the `ButlerAction` model adds complexity without benefit. If it's async (fire and notify via Telegram), the model is necessary.
   Decide the execution model (sync vs async) before writing the migration.
