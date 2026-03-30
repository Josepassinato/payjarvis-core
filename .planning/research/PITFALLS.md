# Pitfalls Research
> PayJarvis v1.0 — Shopping Agent V2
> Researched: 2026-03-30
> Context: Agentic commerce platform, 4+ beta users, production VPS at 83% disk

---

## Butler Protocol Pitfalls

### Security Risks

**Credential storage architecture mistakes**

1. **Deriving the encryption key from the user's PIN directly** — PBKDF2 with a weak PIN (4-6 digits) gives an attacker only 10,000 guesses. PayJarvis already uses AES-256 for cookie vault (`VAULT_ENCRYPTION_KEY`), but the Profile Vault adds *user-supplied* passwords as a second layer. If the server-side key ever leaks AND the user had a weak PIN, both layers collapse simultaneously. Mitigation: enforce minimum PIN entropy at input time, not just at storage time.

2. **Storing the encryption key next to the ciphertext** — The `UserAccountVault` model stores `cookiesEnc` and the key is `VAULT_ENCRYPTION_KEY` in `.env`. If the key and ciphertext are both in PostgreSQL (e.g., key stored in a column for "user-specific" encryption), one database dump exposes everything. Keep the master key only in env/secrets manager, never in the database row.

3. **IV/nonce reuse** — The existing pattern `"iv_hex:ciphertext_hex"` generates a random IV per encryption (good). The pitfall: if any code path re-encrypts with a predictable IV (e.g., hashing the userId), an attacker can detect when the same plaintext is re-stored. Always use `crypto.randomBytes(16)` per encryption call.

4. **Logging credential fields** — Fastify's default request logger may log request bodies. A route like `POST /api/vault/zk/store` with a body containing `{password: "..."}` will appear in PM2 logs in plaintext if redactPaths is not configured. This is a concrete risk given the existing 100+ line PM2 log checks in the smoke test.

5. **Memory exposure in Node.js** — Decrypted credentials sitting in a JavaScript string are not securely wiped after use. Node.js does not provide `SecureString`. Mitigation: minimize the time decrypted values live in scope; do not cache decrypted credentials in Redis or in-memory session state.

6. **Credential rotation tracking** — When a user changes their password on a third-party site (Amazon, Target, etc.), the stored credential becomes stale. There is no webhook or polling mechanism that can detect this; the only signal is a failed login attempt. The vault must handle `CREDENTIAL_STALE` as a first-class state, not just a generic error, so the bot can prompt re-entry rather than silently failing a purchase.

### Legal/Compliance Risks

1. **Computer Fraud and Abuse Act (CFAA) / ToS violations** — Storing credentials to automate login on Amazon, Target, CVS, Macy's, etc. violates nearly all major retailer Terms of Service. This creates civil liability (injunctions, damages). The existing compliance dossier notes this risk but the Butler Protocol makes it concrete — it is no longer theoretical browser automation, it is credential-based account takeover from the retailer's perspective.

2. **PCI DSS scope expansion** — If the vault stores payment card credentials (not just site passwords), PayJarvis enters PCI DSS scope for credential storage, which is vastly more complex than the current Stripe-delegated model. The `SecureItem` model has `itemType: card` — if that item type gets populated by Butler, compliance scope expands immediately.

3. **GDPR/CCPA data minimization** — Storing third-party site credentials is not "minimally necessary" data. Under CCPA, users have the right to deletion; under GDPR, the legal basis for processing is unclear (legitimate interest won't cover this). The privacy policy must explicitly cover credential storage or the product is non-compliant on day one.

4. **Liability for account compromise** — If a user's Amazon account is compromised and PayJarvis held their credentials (even encrypted), PayJarvis may be named in the resulting dispute. Insurance and legal exposure should be documented before launch.

5. **State money transmitter laws** — Automating purchases using stored credentials with a stored payment card may qualify as acting as a money transmitter in some US states. The compliance dossier already flags this risk; Butler Protocol increases the surface area.

### Technical Gotchas

1. **2FA / MFA handling** — TOTP codes (Google Authenticator), SMS OTP, and email OTP all expire in 30-60 seconds. A browser automation session that hits a 2FA prompt must pause, request the code from the user in real time, and resume — this is a multi-second async handoff. The existing `HandoffRequest` model has `obstacleType: AUTH`, but the flow needs a dedicated "awaiting 2FA" state with a short timeout (~90s) before aborting and notifying the user. Storing TOTP seeds in the vault (so the bot can generate codes autonomously) raises its own security and ToS issues and should be an explicit opt-in.

2. **Amazon-specific: bot detection stack** — Amazon uses a layered detection system: TLS fingerprinting (JA3/JA4), mouse movement entropy, headless browser flags, residential vs datacenter IP detection, and behavioral heuristics. BrowserBase provides residential proxy rotation, but Amazon specifically blocks many BrowserBase IP ranges because other automation tools use the same infrastructure. Expect periodic full account locks (not just CAPTCHAs) during development.

3. **CAPTCHA escalation** — After 2-3 failed CAPTCHA attempts from the same BrowserBase project ID, Amazon and Google services fingerprint the project and escalate to "prove you're human" image challenges that defeat automated solvers. The handoff to the human user (live view via `debuggerFullscreenUrl`) must happen on the FIRST CAPTCHA, not after retries.

4. **Session cookie expiry vs. credential validity** — The `UserAccountVault` has `isValid: boolean`. This flag must distinguish between "credential wrong" and "session expired." An expired session can be re-established with the stored credential; an invalid credential requires user intervention. These need separate error codes or the bot will loop re-authenticating with bad credentials.

5. **Concurrent session conflicts** — If a user is logged into Amazon on their own browser AND the Butler bot opens a new BrowserBase session with the same account, Amazon may invalidate one session or flag suspicious concurrent access. The vault flow should check for an active session before creating a new one.

6. **BrowserBase context vs. session lifecycle** — A BrowserBase *context* persists cookies; a *session* is ephemeral. The existing code creates a context per user per store (`bbContextId` on `StoreContext`). The pitfall: if a context ID is lost from the database but still exists in BrowserBase, orphaned contexts accumulate and inflate the BrowserBase bill. Add a periodic reconciliation job.

7. **Rate limiting across users** — If 10 users all trigger Butler actions against Amazon simultaneously, BrowserBase sessions all originate from the same PayJarvis project. Amazon sees a burst of automated traffic from the same fingerprint cluster and blocks the entire project, not just individual users. Implement a per-store concurrency cap (e.g., max 3 simultaneous Amazon sessions).

### Prevention Strategy

- Gate Butler Protocol behind an explicit user consent flow that explains ToS risks in plain language. Record consent timestamp in the database.
- Use the existing `HandoffRequest.obstacleType: AUTH` for 2FA; add a `AWAITING_2FA` sub-state with 90s TTL.
- Never log decrypted credentials; add Fastify `redact: ['body.password', 'body.credentials', 'body.cookiesEnc']` to the logger config.
- Add `CREDENTIAL_STALE` as a `UserAccountVault.status` enum value alongside `isValid`.
- Implement BrowserBase context reconciliation as a weekly cron, not ad-hoc.
- Set per-store concurrency limits in Redis: `butler:active:<store>` counter with TTL.
- Legal: add a "Automation Risk Acknowledgment" to ToS before Butler goes to any beta user beyond the current 4.

---

## Shopping Planner Pitfalls

### Data Freshness

1. **Price staleness between plan creation and execution** — The Unified Product Search caches results in Redis with variable TTL (`commerce:<service>:<params_hash>`). A Shopping Planner that builds a multi-store plan at T+0 and executes at T+24h may present prices that have changed. Common scenarios: flash sales that end, dynamic pricing (Amazon changes prices every few minutes), out-of-stock items that were in-stock when the plan was built. The plan must store both the "plan price" and re-validate at execution time.

2. **Inventory changes between plan and cart** — An item can be in-stock at search time and out-of-stock by the time the bot adds it to the cart. The "add to cart" step must check availability, not assume the search result is current. This is especially sharp for pre-orders (which the planner explicitly supports) where release dates and availability change frequently.

3. **Cart expiration** — Most retailers expire shopping carts after 7-30 days of inactivity. A plan created for a future date (e.g., "buy these back-to-school supplies in August") will have an empty cart by execution time. The planner must NOT pre-add items to carts; it must add them at execution time.

4. **Cross-store grouping stale data** — If the planner groups by store to minimize shipping costs and one item's store assignment changes (e.g., third-party seller on Amazon goes out of stock, item now only available from another seller with different shipping), the grouping optimization is invalid. The grouping must be re-computed at execution, not at plan creation.

5. **Currency/regional price differences** — The existing code has Amazon extractors for `.com`, `.com.br`, `.co.uk`, etc. A multi-store plan that mixes regional pricing (e.g., comparing US Amazon with a Brazilian retailer) will show incorrect comparisons unless currency conversion is applied consistently. The plan must tag each price with its source currency and conversion rate timestamp.

### UX Traps

1. **Approval fatigue for multi-item plans** — If the planner creates a 15-item plan and requests approval for each item individually, users will stop responding. The plan needs a single "approve the whole plan" flow with an optional "modify" path, not per-item approval requests.

2. **Ambiguous partial execution** — If a 10-item plan executes and 3 items fail (out of stock, CAPTCHA, etc.), the user needs a clear summary of what succeeded, what failed, and what action is needed for the failures. The existing `ApprovalRequest` model is designed for single transactions; a plan needs a parent-level status model.

3. **Over-engineering the optimization** — Users asking Jarvis to "buy everything for my kitchen renovation" do not want to see a complex multi-store optimization algorithm. They want a simple answer: "I'll buy these 8 items from Amazon ($234) and these 2 from Target ($45). Total: $279. Approve?" Expose the optimization as a summary, not the algorithm.

4. **Pre-order commitment without price guarantees** — Amazon pre-orders often use "price at time of release" guarantees. Other retailers do not. If the plan includes pre-orders from non-Amazon retailers, the committed price may not hold. The plan must flag pre-orders with "price not guaranteed" warnings.

5. **Shipping address and cart conflicts** — If a user has multiple saved addresses, the planner must confirm which address to use before executing. Discovering the wrong address after checkout is a painful recovery experience.

### Prevention Strategy

- Add a `planPrice` and `validatedAt` field to each plan line item; re-validate prices within 1 hour of execution.
- Store plan status as a first-class model (not just a conversation thread): `plan_id`, `status: draft|approved|executing|partial|complete|failed`, `lineItems[]`.
- Never add items to carts at plan creation time; add at execution time only.
- Use a single approval message with an inline summary, not per-item approvals.
- Add `priceGuaranteed: boolean` to plan line items for pre-orders.
- Implement a plan expiry: plans older than 30 days require re-validation before execution.

---

## Audio vs Text Routing Pitfalls

### Pitfalls

1. **Detection false positives** — Detecting "smart glasses user" from user agent or conversation context is unreliable. The Ray-Ban Meta sends Telegram messages via voice transcription, but the resulting text looks identical to keyboard input. If the detection relies solely on message content patterns (short sentences, no punctuation), many non-glasses users will get the degraded short-response mode.

2. **Routing rule inconsistency across channels** — The audio pipeline currently runs on the OpenClaw Telegram bot (`tts.js`: Gemini → ElevenLabs → edge-tts). The routing rule "text for data, audio for casual conversation" must be applied identically across Telegram, WhatsApp, and Web Chat. If the rule lives only in the OpenClaw bot, WhatsApp users get a different experience. The rule should be a shared service or middleware, not embedded in each channel handler.

3. **TTS for long data responses** — If the routing logic has a bug and sends a price comparison table (20 rows, 4 columns) to the TTS pipeline, the result is an unlistenable audio file. The text-to-speech pipeline must have a content-type gate: structured data (tables, lists, URLs, prices) must never be routed to audio regardless of user preferences.

4. **ElevenLabs cost spike** — ElevenLabs charges per character. If the routing rule is too permissive (routes most responses to audio), a power user with 100+ messages/day can generate significant TTS costs. The existing credit system tracks LLM usage but not TTS usage. Add TTS cost tracking before enabling audio routing broadly.

5. **Edge-tts fallback quality** — The edge-tts fallback produces noticeably lower quality audio. If ElevenLabs fails (rate limit, key issue) and edge-tts activates without the user knowing, the sudden quality drop is jarring. Consider informing the user on fallback: "Voice quality reduced temporarily."

6. **Voice response length enforcement** — The Ray-Ban Meta constraint is <30 words. The LLM must be instructed with a hard limit, not a soft suggestion. GPT/Gemini models frequently exceed soft word-count suggestions. Use a post-generation truncation check with a re-generation request if the response exceeds the limit.

### Prevention Strategy

- Store the `is_smart_glasses` flag as an explicit `user_fact` (keyed: `device_type: ray_ban_meta`) set by explicit user confirmation, not inferred from message patterns.
- Extract the audio/text routing decision into a single shared function in the API, not per-channel logic.
- Add a content-type classifier before TTS: if response contains prices, URLs, lists, or tables → force text.
- Add TTS character count to `LlmUsageLog` model alongside token counts.
- Implement a hard post-generation word count check for voice responses; re-prompt if over limit.

---

## Supabase Migration Pitfalls

### Data Loss Risks

1. **`prisma db push --accept-data-loss` on production** — The CLAUDE.md explicitly forbids this, and for good reason: `db push` drops tables that are not in the schema (including the raw SQL OpenClaw tables), drops columns that were removed, and does not preserve data. The migration to local PostgreSQL must use `pg_dump`/`pg_restore` for data, not schema re-push.

2. **Supabase auth.users vs. application users** — If any of the 9 live projects use Supabase Auth (not just Supabase as a Postgres host), their `auth.users` table is managed by Supabase's auth service and is NOT included in a standard `pg_dump`. Migrating these users requires exporting from Supabase's auth export API separately, then re-importing into the new auth system. PayJarvis uses Clerk, so this may not apply directly — but the other 8 projects must be checked.

3. **RLS policies are NOT migrated by `pg_dump --schema-only`** — Row Level Security policies are schema objects and ARE included in `pg_dump`, BUT they reference `auth.uid()` — a Supabase-specific function that does not exist in vanilla PostgreSQL. Any RLS policy using `auth.uid()` will fail silently (or break all queries) after migration. All RLS policies must be audited and rewritten or dropped before migration.

4. **Supabase-specific extensions** — Supabase auto-enables `uuid-ossp`, `pgcrypto`, `pg_stat_statements`, `pgjwt`, and others. A vanilla PostgreSQL install does not have these by default. Run `SELECT * FROM pg_extension` on each Supabase project before migrating and install matching extensions on the local instance.

5. **Supabase realtime subscriptions** — If any project uses Supabase Realtime (websocket subscriptions), those will break immediately on migration. Supabase Realtime is a proprietary layer on top of PostgreSQL logical replication. Any project using `supabase.channel()` or `supabase.from().on()` needs a replacement (e.g., custom websocket, polling, or pg_notify) before migration.

6. **Storage bucket data** — Supabase Storage is not PostgreSQL; it stores files in S3-compatible buckets. `pg_dump` does not migrate storage objects. If any project stores user-uploaded files in Supabase Storage, those files need to be migrated separately to local disk or an S3-compatible service before the Supabase account is cancelled.

7. **Connection string format difference** — Supabase provides two URLs: a pooled connection (`DATABASE_URL` via PgBouncer) and a direct connection (`DIRECT_URL`). Prisma uses both. The local PostgreSQL instance only has a direct connection. After migration, both `DATABASE_URL` and `DIRECT_URL` in every project's `.env` must point to the local instance, or Prisma migrations will fail (Prisma requires a direct connection for migrations, even if the app uses the pooled URL).

8. **Migration timing and downtime** — A `pg_dump` of a live database takes time. For a busy project, the dump may be inconsistent if writes happen during the dump. Use `pg_dump --serializable-deferrable` or take a Supabase snapshot/backup before migrating.

9. **Sequence resets after restore** — PostgreSQL sequences (used for auto-increment primary keys) are included in `pg_dump` but may not be at the correct value after restore if the dump was taken while the application was writing. Run `SELECT setval(pg_get_serial_sequence('table', 'id'), MAX(id)) FROM table` for each table after restore.

10. **Dead project data contamination** — The 14 dead projects are being deleted. If any dead project shares a database with a live project (e.g., multiple schemas in one Supabase project), deleting the Supabase project deletes all schemas. Verify that each dead project is fully isolated before cancellation.

### Prevention Strategy

- Before starting: run `SELECT * FROM pg_extension` and `SELECT * FROM pg_policies` on each live Supabase project. Document the results.
- Use `pg_dump --format=custom --no-owner --no-privileges` for each live project and test restore in a local staging database before touching production.
- Audit all `.env` files across all 9 projects for `SUPABASE_URL`, `DATABASE_URL`, `DIRECT_URL` — update all three.
- For any project using Supabase Auth: export users via Supabase Management API before cancelling.
- For any project using Supabase Storage: inventory buckets via Supabase CLI (`supabase storage ls`) before migration.
- Migrate one project at a time. Verify the project works on local PostgreSQL before migrating the next.
- Do NOT cancel the Supabase account until all 9 projects have been running on local PostgreSQL for at least 1 week without issues.
- Keep the Supabase projects in a paused state (not deleted) during the transition period as rollback insurance.

---

## VPS Disk Cleanup Pitfalls

### Pitfalls

1. **Deleting `node_modules` that PM2 depends on at runtime** — PM2 processes may load modules from `node_modules` at runtime, not just at startup. If a process is running and its `node_modules` is deleted, the next dynamic `require()` call will throw `MODULE_NOT_FOUND`. Worst case: a lazy-loaded module (e.g., a PDF generator, an OCR library) is only loaded on first use and the deletion is not caught by smoke tests.

2. **Breaking symlinks in Turborepo** — Turborepo uses symlinks in `node_modules/.cache` and in the workspace `node_modules` for cross-package references (e.g., `@payjarvis/database` is symlinked into `apps/api/node_modules`). Deleting `node_modules` from a sub-package without running `npm install` from the repo root will leave dangling symlinks that cause silent import failures.

3. **Deleting active Docker volumes** — `docker system prune -a` deletes ALL stopped containers, unused images, and unused volumes. If a stopped container holds a PostgreSQL data volume, `prune -a` will delete the database. Always run `docker volume ls` before any Docker cleanup and explicitly protect named volumes.

4. **Deleting sandbox directories that are still referenced** — The global CLAUDE.md uses sandboxes at `/root/sandbox/<project>_<date>`. If a sandbox was used for a mid-migration state (e.g., a Supabase migration in progress) and is deleted before the migration is confirmed complete, the rollback path is gone.

5. **Log rotation vs. manual log deletion** — Manually deleting PM2 log files while PM2 is running (`~/.pm2/logs/*.log`) does not release the file descriptor; PM2 still holds the file open and continues writing to the deleted inode. The disk space is not recovered until PM2 is restarted. Use `pm2 flush` to truncate logs properly, not `rm`.

6. **`npm cache clean` on shared cache** — If multiple projects share the same npm cache directory (`~/.npm`), cleaning it will force re-download for all projects on the next `npm install`. This is not data loss, but it can cause the next deploy to take 10-15 minutes longer and fail if the VPS has intermittent network issues.

7. **Accidentally deleting SSL certificates** — Let's Encrypt certificates live at `/etc/letsencrypt/`. A broad `/etc/` cleanup or a certbot auto-renew misconfiguration that deletes the live symlink will take down HTTPS for all domains on the VPS. The Nginx config references `/etc/letsencrypt/live/payjarvis.com/` — if this path breaks, every project behind Nginx goes dark.

8. **`.next` build cache** — Next.js stores incremental build cache in `apps/web/.next/cache`. This directory can be large (500MB-1GB for active projects) but deleting it forces a full rebuild on next deploy. On a VPS without CI, this means the next deploy takes 5-10x longer. Delete only if the disk situation is critical.

9. **Docker layer cache** — If Docker is used for any project (the CLAUDE.md mentions checking `docker ps -a`), `docker system prune` will delete build layer cache. Subsequent builds will re-pull all base images. On a 83%-full disk with limited bandwidth, this can cause builds to fail mid-pull if another process writes to disk simultaneously.

10. **Recursive glob patterns hitting production code** — Cleanup scripts using patterns like `find /root -name "*.log" -delete` or `find /root -name "node_modules" -prune -exec rm -rf {} +` can match files in unexpected locations. A `node_modules` directory inside a Git repo's test fixtures or a `*.log` file that is actually a named pipe will be deleted, potentially breaking test suites or inter-process communication.

### Prevention Strategy

- Stop all PM2 processes before deleting their `node_modules`: `pm2 stop all`, clean, `npm install`, `pm2 start all`.
- Use `du -sh /root/*/node_modules` and `du -sh /root/projetos/*/node_modules` to identify the largest targets before deleting anything.
- Run `df -h` before and after each cleanup step to verify actual disk recovery.
- Never use `docker system prune -a`; use `docker container prune` and `docker image prune` separately, with explicit volume exclusions.
- Use `pm2 flush` for log cleanup, not `rm ~/.pm2/logs/`.
- Create a pre-cleanup checklist: `pm2 list` (what's running), `docker volume ls` (what has data), `ls /etc/letsencrypt/live/` (what certs exist).
- Target highest-impact directories first: `/root/sandbox/` (likely gigabytes of stale copies), Docker images, duplicate `node_modules` in non-production packages.
- After cleanup, run `bash /root/Payjarvis/scripts/smoke-test.sh` before declaring the disk optimization complete.

---

## Integration Pitfalls

*(Specific to adding these features to the existing PayJarvis production system)*

1. **Profile Vault collides with existing ZK Vault** — PayJarvis already has `UserZkVault` (PIN-based zero-knowledge vault) and `UserAccountVault` (cookie storage). The Butler Protocol's "Profile Vault" is a third credential storage concept. Without a clear data model decision upfront, development will create a fourth ad-hoc storage mechanism (e.g., a new `profile_vault` table that partially overlaps with `SecureItem`). The integration work must explicitly map Butler credentials to the existing `SecureItem` model (`itemType: password`) rather than creating parallel infrastructure.

2. **Shopping Planner creates a new approval flow that bypasses the existing Rules Engine** — The current approval flow is: Bot → Rules Engine (3002) → `ApprovalRequest` → SSE to dashboard → user response. A Shopping Planner that creates multi-item plans needs a parent approval concept. If implemented naively (one `ApprovalRequest` per item), it generates N approval SSE events that flood the dashboard and overwhelm the user. If implemented as a new approval type, it must register with the Rules Engine's decision logic to avoid bypassing spending limits.

3. **Audio routing rule must not break the existing `voice:tts:<hash>` Redis cache** — The TTS cache is keyed by content hash. If the routing rule adds metadata to the TTS request (e.g., "smart glasses mode: true"), the hash changes and the cache never hits. The routing rule must not modify the content before hashing; the mode flag should gate the routing decision, not the content itself.

4. **Supabase migration timing vs. feature development** — If the Supabase migration runs concurrently with Butler and Shopping Planner development, schema changes during migration can conflict with new feature migrations. The `prisma migrate deploy` step needs to be the single source of truth. Risk: a developer runs `prisma migrate dev` during the migration window and creates a migration that assumes the old `DATABASE_URL`, which then conflicts with the new local URL.

5. **Disk cleanup before feature deployment** — At 83% disk usage, a Turborepo build that generates `.next` static files and `dist/` directories for 4 apps simultaneously can push the disk to 90%+, causing the build to fail mid-way with `ENOSPC` errors. This leaves half-built `dist/` directories that cause PM2 to start broken processes. The disk optimization MUST happen before any new feature code is deployed, not concurrently.

6. **BrowserBase concurrency limits during development** — BrowserBase free/starter plans have a limit on concurrent sessions. During development of Butler Protocol (which requires active BrowserBase sessions for testing), simultaneous testing by multiple developers can exhaust the session pool and make test results non-deterministic. Use a development BrowserBase project separate from the production one.

7. **Existing `HandoffRequest` model is not designed for Shopping Planner partial failures** — When a 10-item Shopping Planner execution hits a CAPTCHA on item 6, it should create a handoff for item 6 while completing items 1-5 and 7-10 autonomously. The current `HandoffRequest` model is 1:1 with a single obstacle. A plan execution needs to create handoffs without blocking the rest of the plan's execution.

8. **Ray-Ban Meta `user_fact` conflicts with existing adaptive profile** — The OpenClaw `adaptive-memory.js` and `user-model.js` already maintain an adaptive user profile. A `device_type: ray_ban_meta` user_fact stored in `openclaw_user_facts` must be consistently read by all response generators (Gemini tool calls, TTS routing, response formatting). If the fact is only checked in one place and not propagated to the system prompt block, some responses will be formatted for Ray-Ban and others will not.

9. **Smoke test does not cover Butler or Shopping Planner endpoints** — The existing `smoke-test.sh` checks 17 things, none of which will cover the new vault routes (`/api/vault/profile/*`) or plan routes. After deploying these features, the smoke test will pass even if the new endpoints are completely broken. New smoke test entries must be added before these features go to beta users.

10. **$150/month Supabase cancellation is irreversible** — Once the Supabase account is cancelled and the 14 dead projects are deleted, there is no recovery path. The 30-day data retention window after deletion is the only safety net. Do not cancel until: (a) all 9 live projects are confirmed running on local PostgreSQL, (b) no dead project has data that might be needed (even for compliance/legal records), and (c) the local PostgreSQL instance has a backup strategy in place.
