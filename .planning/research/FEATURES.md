# Features Research

> Context: PayJarvis is an AI spending firewall and agentic commerce platform. Users interact via Telegram/WhatsApp. Existing stack: Fastify API, Next.js, PostgreSQL, Redis, BrowserBase (Stagehand), Dual LLM (Grok + Gemini), AES-256 vault already in use for Amazon cookies.

---

## Butler Protocol

Credential storage + autonomous site actions. Think 1Password combined with a browser automation layer that can actually use those credentials on behalf of the user — logging in, buying, canceling subscriptions, managing account settings.

### Table Stakes (must have)

- **Encrypted credential storage** — AES-256 at rest, never plaintext. Key derived from user PIN via PBKDF2. This is non-negotiable; any breach destroys trust permanently. PayJarvis already does this for Amazon cookies (`UserAccountVault` + `SecureItem`) — Butler extends the same pattern to arbitrary sites.
- **PIN-gated retrieval** — credentials only decrypted after user presents PIN. Zero-knowledge pattern: server never sees plaintext PIN, only a hash. Already built in `UserZkVault`.
- **Per-site credential scoping** — each stored entry is isolated: `{site, username, encrypted_password, encrypted_cookies, last_verified}`. User must explicitly grant which bots can use which credential.
- **Session reuse before credential replay** — try existing cookies first; only replay username/password if cookies are expired or invalid. Reduces credential exposure frequency.
- **Action audit trail** — every autonomous action logged: what was done, on which site, at what time, outcome. User can see "Jarvis logged into Netflix and canceled your subscription at 3:42 PM."
- **Explicit action approval for high-stakes operations** — canceling a subscription, deleting an account, making a purchase above a threshold must get user confirmation before executing. Buying a $5 item = auto-approve. Canceling a $200/year subscription = confirm first.
- **Graceful failure + handoff** — when the browser agent hits a CAPTCHA, 2FA, or unexpected UI change, it must stop and hand off to the user rather than get stuck in a loop. PayJarvis already has `HandoffRequest` for this.

### Differentiators (competitive edge)

- **Intent-to-action pipeline** — user says "cancel my Netflix" in Telegram; Jarvis maps that to: (1) retrieve Netflix credentials from vault, (2) log in via BrowserBase, (3) navigate to cancellation flow, (4) confirm with user, (5) execute, (6) report back with screenshot evidence. 1Password can't do this — it just stores passwords.
- **Subscription intelligence** — proactively scan account email for recurring charges the user hasn't explicitly registered. "I noticed a $14.99 charge from Adobe — want me to cancel it?" This combines Gmail integration (Composio) + Butler.
- **Action templates per site** — pre-built Playwright scripts for common operations on popular sites (Netflix cancel, Amazon return, Uber complaint). The browser agent already has site-specific extractors for 15+ sites; extend these into action templates.
- **Credential health monitoring** — periodically verify stored credentials are still valid (lightweight headless check), alert user before they're needed and found broken.
- **Delegated bot permissions** — user can grant a specific bot (e.g., their "shopping bot") access to specific vault entries. Bot can act without user PIN for pre-approved operations. This ties into the existing `StoreBotPermission` model pattern.

### Anti-Features (avoid)

- **Storing master passwords / password manager imports** — scope is single-purpose site credentials for actions Jarvis takes. Becoming a general password manager adds surface area without adding value to the commerce use case.
- **Auto-login without user awareness** — always notify "I logged into X to complete your request." Silent logins erode trust.
- **Browser fingerprint rotation without consent** — some sites detect automation. Don't silently bypass this; it risks account bans. Warn user that the site may flag automated access.
- **Credential sharing across users** — obvious, but must be architecturally enforced, not just policy.
- **Storing 2FA backup codes** — opens a massive attack vector. If 2FA is required, hand off to user.

### Complexity: High

Reason: credential lifecycle management (create, verify, rotate, revoke), per-bot permission model, action execution pipeline with graceful failure, and audit logging all need to work together. BrowserBase + existing vault infrastructure reduces this from "very high" to "high" — the primitives exist, the orchestration layer is the hard part.

---

## Shopping Planner

Complex purchase plans for multi-item, multi-store, geographically-aware shopping tasks. "I need baby essentials for a newborn in Orlando" → Jarvis produces a structured plan: which items, from which stores, at what prices, grouped for optimal pickup/delivery.

### Table Stakes (must have)

- **Intent decomposition** — parse a vague request into a structured list of items. "Baby essentials" → diapers (size NB), wipes, onesies (0-3mo), formula/nursing supplies, swaddle blankets, etc. This requires an LLM pass with domain knowledge, not just keyword expansion.
- **Multi-source price aggregation** — for each item, query multiple sources (Amazon, Target, Walmart, local stores) in parallel. PayJarvis already does unified product search across 5 sources; Shopping Planner builds a plan on top of multiple such queries.
- **Store grouping** — cluster items by optimal source: "Buy diapers + wipes at Costco (save $40), onesies at Target (in-store pickup today), formula at CVS (insurance covers)." Minimize number of stops/orders.
- **Total cost summary** — before approval: subtotal per store, estimated tax, delivery fees, grand total. User must see the full picture before committing.
- **User approval checkpoint** — present the full plan as a structured message. User can accept all, reject all, or modify per-item. Instacart does this well: show the cart, let user swap items.
- **Execution after approval** — after user approves, Jarvis places the orders (via vault/browser agent for applicable stores) or generates direct purchase links for manual completion.
- **Location awareness** — "in Orlando" means filter by stores that serve the Orlando area, check in-store availability vs. delivery availability. PayJarvis already has `latitude/longitude` on User and `find_stores` tool.

### Differentiators (competitive edge)

- **Context-aware category expansion** — "baby essentials for first week home from hospital" is a different list than "baby essentials for 6-month-old." LLM should ask clarifying questions only when the gap is large; otherwise infer and annotate assumptions ("I assumed newborn, let me know if different").
- **Budget-aware optimization** — user can set a budget ceiling. Planner optimizes: premium items where safety matters (car seat, formula) vs. generic where it doesn't (wipes, burp cloths).
- **Pre-order and future scheduling** — "I'm moving to Orlando in 3 weeks, order these to arrive on move-in day." Plan includes scheduling information, not just store selection.
- **Substitute suggestions with rationale** — if a preferred item is out of stock, suggest substitute with explicit reason: "Huggies Newborn is out — Pampers Swaddlers is the #1 pediatrician-recommended alternative at $2 less."
- **Plan versioning and editing** — user can say "remove the formula, we're breastfeeding" and the plan updates without regenerating from scratch.
- **Reusable plan templates** — "monthly Costco run," "weekly groceries," saved plans that can be re-executed with one command.

### Anti-Features (avoid)

- **Overwhelming message length** — a 20-item plan sent as a wall of text in Telegram is unusable. Use structured formatting: item groupings, store totals, one approval prompt. If >10 items, paginate or send as a document/link to the web dashboard.
- **Asking too many clarifying questions** — one optional clarifying question is fine. Three questions before showing a plan is abandonment. Make assumptions, show them, let user correct.
- **Silent substitutions** — if Jarvis swaps an item, the user must see it. "I substituted X with Y because Z" — never silently replace without disclosure.
- **Mixing auto-execute and manual steps without clear labeling** — user must know which items Jarvis will order autonomously vs. which require their action (e.g., items that need Butler credentials they haven't set up yet).
- **Price comparison theater** — showing 10 price options per item creates decision fatigue. Pick the best option per item, show 1-2 alternatives at most, explain the recommendation.

### Complexity: High

Reason: intent decomposition (LLM), parallel search across sources (already built), plan construction algorithm (store grouping, budget optimization), multi-step approval workflow, and conditional execution (some items go through Butler, some generate links). The search layer exists; the plan construction and approval workflow are new.

---

## Audio vs Text Routing

Deciding when an AI assistant should respond with audio (TTS voice message) vs. plain text. This is a UX-critical decision — getting it wrong in either direction degrades the experience.

### Table Stakes (must have)

- **Explicit user command always wins** — if user sends a voice message, respond with voice. If user types, respond with text. This is the baseline rule with no exceptions.
- **On-demand audio toggle** — user can say "respond with voice" or "respond with text" and the bot saves this as a preference (`user_fact: response_format = voice|text`). This preference persists across sessions.
- **Never send audio for data-heavy responses** — prices, product lists, tracking numbers, transaction history, links — always text. Audio for a list of 5 prices is unusable; user can't refer back to it.
- **Audio for short conversational replies** — "Your order was placed successfully," "I couldn't find what you're looking for," "Your budget alert is set" — these are good audio candidates when user has audio preference enabled.
- **Detect platform capability** — Telegram supports voice messages natively. WhatsApp supports voice messages. Web chat does not need TTS (browser has native audio). Detect platform and only send audio where it renders correctly.

### Differentiators (competitive edge)

- **Response classification before rendering** — classify response type before choosing format: `data` (prices, lists, links) → always text; `confirmation` (success/failure of action) → audio if preference set; `question` (clarification request) → text (user needs to respond in writing); `narrative` (explanation, briefing) → audio if short enough (<60 words), text otherwise.
- **Hybrid responses** — send text data + brief audio summary. "Here are the 3 results [text card with prices]. [voice: 'The best deal is Amazon at $24.']" This combines the scannability of text with the warmth of voice.
- **Silence detection heuristic** — if user is in a "conversation flow" (multiple back-and-forth messages in <2 minutes), audio makes more sense than during a single transactional request.
- **Length threshold** — any response over ~40 words should default to text regardless of preference. Voice responses should be short and actionable.

### Anti-Features (avoid)

- **Audio for error messages** — "I couldn't complete your request because the API returned a 429 error" should never be spoken aloud. Errors need to be readable and referential.
- **Audio for anything with a URL, code, or number to copy** — order IDs, tracking numbers, payment links — always text. User cannot copy from audio.
- **Forcing audio on users who haven't opted in** — default should be text-only. Audio is opt-in, not opt-out.
- **Inconsistent behavior** — same type of response sometimes audio, sometimes text. Users build mental models; consistency matters more than occasional optimization.
- **Audio without text fallback** — always send the text version alongside or in the caption of the audio message. User may be in a quiet environment.

### Complexity: Low

Reason: the decision tree is simple and rules-based. The TTS pipeline already exists (Gemini → ElevenLabs → edge-tts). This is primarily about adding a routing function that classifies response type and checks user preference before choosing output format. Estimated: 1-2 days implementation.

**Recommended rule (simple version to ship):**
```
if (userSentVoiceMessage || userPreference === 'voice'):
  if (responseType === 'data' || responseLength > 40 words || hasLinks || hasNumbers):
    send TEXT
  else:
    send AUDIO + text caption
else:
  send TEXT
```

---

## Ray-Ban Meta Guide

Ray-Ban Meta glasses users interact with AI via voice (Meta AI integration). The display is either absent (audio-only mode) or minimal. Responses must be optimized for voice readout: short, no visual formatting, no links, conversational.

### Table Stakes (must have)

- **Device detection and user_fact persistence** — detect that a user is on Ray-Ban Meta (via explicit user statement, or platform signal). Save `user_fact: device = ray_ban_meta`. This fact must persist across sessions so every future interaction is optimized without re-asking.
- **Hard response length cap** — 30 words maximum for primary response. Everything beyond that is either omitted or deferred to a follow-up. "Shortest useful answer" principle.
- **No markdown formatting** — no `**bold**`, no `- bullet lists`, no URLs. Everything rendered as plain spoken language. "Your flight leaves at 3 PM from Orlando International" not "**Departure:** 3:00 PM | **Airport:** MCO".
- **No links in primary response** — URLs are unreadable when spoken. If a link is necessary, say "I'll send the link to your phone" and send it via a separate Telegram/WhatsApp notification.
- **Confirmation-first responses** — action confirmations must come first. "Done, your order is placed." Then any relevant detail. Glasses users are often mobile and need the result immediately.
- **No questions requiring typed input** — if Jarvis needs clarification, ask a yes/no question: "Did you mean the blue one or the white one?" Never ask something that requires a written paragraph to answer.

### Differentiators (competitive edge)

- **Proactive device-optimized onboarding** — when Jarvis detects "I'm using Ray-Ban Meta" or similar, immediately confirm: "Got it, I'll keep my responses short and voice-friendly. Ask me anything." No lengthy setup process.
- **Ambient context commands** — glasses users often give commands while doing other things. Support command patterns like "Jarvis, add milk to my list," "Jarvis, how much did I spend this week," "Jarvis, cancel my Uber." Short, imperative, no need for context.
- **Deferred rich content** — for any response that would normally include a table, image, or list (search results, price comparisons), provide a 1-sentence summary by voice and a push notification to phone with full details: "Found 3 options, cheapest is $24 at Amazon — sent details to your phone."
- **Wake word awareness** — glasses use wake words ("Hey Meta"). Jarvis should assume any message is a continuation of a voice command and respond accordingly, without requiring "please" or full sentences from the user.
- **Battery-aware TTS** — voice responses are default on glasses. Never send text-only response to a Ray-Ban Meta user; they won't see it.

### Anti-Features (avoid)

- **Treating glasses users like mobile web users** — do not send rich cards, inline keyboards (Telegram), or formatted messages. The interface is audio-only.
- **Long confirmations** — "I have successfully processed your request and placed the order for the item you requested. The total amount charged was twenty-four dollars and ninety-nine cents." Instead: "Done. $25 charged."
- **Multi-step flows requiring input** — glasses users cannot type. Any flow that requires more than one yes/no confirmation is too complex for glasses. Simplify or route to phone.
- **Sending audio files (OGG/MP3)** — Ray-Ban Meta uses its own speaker system. Sending a Telegram voice message creates friction. Respond with short text that the Meta AI layer converts to speech, OR confirm the user's preferred path.
- **Asking the user to repeat device registration** — once `device = ray_ban_meta` is saved as a user_fact, never ask again. If the user later says "respond normally," update the fact.

### Complexity: Low

Reason: this is primarily a prompt/response transformation layer, not a new system. The mechanism is: check `user_fact: device`, apply a response template that enforces length limits and strips formatting, route links to a separate notification. No new infrastructure needed — leverages existing user_facts system, existing OpenClaw memory, and existing notification pipeline. Estimated: 1 day implementation.

**Implementation note:** Add a `device_profile` resolver to the premium pipeline between layer 3 (memory) and layer 8 (Gemini). If `device = ray_ban_meta`, inject into the system prompt: "Respond in 30 words or less. No markdown. No links. Spoken language only. If the response requires a link or list, say 'sent to your phone' and flag for push notification."

---

## Dependencies on Existing Features

### Butler Protocol
- **Vault (AES-256)** — directly extends `UserAccountVault` and `SecureItem` models already in schema. Same encryption pattern as Amazon cookie vault.
- **Browser Agent (BrowserBase/Stagehand)** — uses the same BrowserBase infrastructure for session management and page interaction. Action templates extend the existing site-specific extractors.
- **Handoff Protocol** — uses `HandoffRequest` for CAPTCHA/2FA escalations. Already tested for Amazon checkout.
- **Zero-Knowledge Vault** — PIN authentication via `UserZkVault` already built. Butler retrieval gates on same PIN.
- **Approval Workflow** — high-stakes actions (cancel subscription, delete account) route through existing `ApprovalRequest` + SSE stream.

### Shopping Planner
- **Unified Product Search** — each item in the plan triggers the existing multi-source search. No new search infrastructure needed.
- **Store Location** — uses existing `find_stores` tool and User geolocation fields.
- **Approval Workflow** — plan approval is a variant of the existing `ApprovalRequest` flow. May need a new `SHOPPING_PLAN` approval type.
- **Butler Protocol** — for actually executing approved orders on sites where credentials are stored.
- **Audio vs Text Routing** — plan presentation format adapts to device/preference. On Ray-Ban: 1-sentence summary + push notification with full plan.
- **Redis Cache** — product search results cached to avoid re-fetching during plan editing.

### Audio vs Text Routing
- **Audio Pipeline** — uses existing Gemini TTS → ElevenLabs → edge-tts fallback. No changes to pipeline needed.
- **User Facts** — reads `user_fact: response_format` preference. Writes it when user sets preference.
- **Dual LLM** — Gemini classifies response type (data vs. confirmation vs. narrative) as part of the response generation step.
- **All bot channels** — applies to Telegram, WhatsApp, and Web Chat. Platform detection already available from message source.

### Ray-Ban Meta Guide
- **User Facts** — reads/writes `user_fact: device = ray_ban_meta`. Core dependency.
- **Audio vs Text Routing** — Ray-Ban profile is a specialization of the routing rule. Device profile takes highest priority in the routing decision tree.
- **Notification Pipeline** — "sent to your phone" requires pushing rich content via Telegram/WhatsApp notification. Uses existing `notifications.ts` service.
- **Premium Pipeline** — inject device profile check at layer 3.5 (between memory retrieval and Gemini call). Existing 8-layer pipeline accommodates this without restructuring.
- **OpenClaw Memory** — `getUserContext()` already reads user facts. Device flag surfaces automatically in every conversation context.
