# Requirements: PayJarvis

**Defined:** 2026-03-30
**Core Value:** The user tells Jarvis what they want, and Jarvis finds, compares, and buys it — safely, autonomously, with full spending control.

## v1.0 Requirements

Requirements for Shopping Agent V2. Each maps to roadmap phases.

### Infrastructure

- [ ] **INFRA-01**: VPS disk usage reduced from 83% to below 60%
- [ ] **INFRA-02**: Sandboxes, duplicate node_modules, Docker images, and old logs cleaned
- [ ] **INFRA-03**: 9 Supabase projects migrated to local PostgreSQL
- [ ] **INFRA-04**: 14 dead Supabase projects deleted
- [ ] **INFRA-05**: Supabase account canceled after 1-week verification period

### Butler Protocol

- [ ] **BUTL-01**: User can save site credentials (username/password) encrypted with AES-256
- [ ] **BUTL-02**: User can ask Jarvis to perform actions on saved sites (buy, cancel, login)
- [ ] **BUTL-03**: Autofill route chains credential retrieval + browser form fill in one call
- [ ] **BUTL-04**: CAPTCHA detected on first occurrence triggers handoff to user with screenshot
- [ ] **BUTL-05**: 2FA prompts enter AWAITING_2FA state with 90-second TTL for user input
- [ ] **BUTL-06**: Action templates exist for top sites (Amazon buy, Netflix cancel, Publix order)
- [ ] **BUTL-07**: Audit log records every credential access and autonomous action

### Shopping Planner

- [ ] **SHOP-01**: User can request complex purchase plan via natural language
- [ ] **SHOP-02**: Jarvis decomposes request into categorized item list via LLM
- [ ] **SHOP-03**: Each item searched across multiple stores with real prices
- [ ] **SHOP-04**: Items grouped by store with subtotals and grand total
- [ ] **SHOP-05**: Pre-order presented to user for approval (approve/remove/swap store)
- [ ] **SHOP-06**: Inline keyboard approval in Telegram + text-based in WhatsApp
- [ ] **SHOP-07**: Prices re-validated within 1 hour before execution
- [ ] **SHOP-08**: Budget-aware optimization (premium for safety items, economy for rest)

### Audio vs Text Routing

- [ ] **AUDIO-01**: Responses with prices, links, lists, or tables always sent as text
- [ ] **AUDIO-02**: Short casual responses sent as audio when user has voice preference
- [ ] **AUDIO-03**: Responses over 40 words always sent as text
- [ ] **AUDIO-04**: Routing logic works identically on WhatsApp and Telegram

### Ray-Ban Meta

- [ ] **META-01**: Jarvis detects when user mentions Ray-Ban Meta glasses
- [ ] **META-02**: user_fact `has_meta_glasses` saved and persisted
- [ ] **META-03**: Responses capped at 30 words when glasses user detected
- [ ] **META-04**: Rich content (links, tables) sent separately with "sent to your phone" note
- [ ] **META-05**: Detection and adaptation work on both WhatsApp and Telegram

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Commerce Integrations

- **COMM-01**: Amadeus integration for hotels and flights
- **COMM-02**: Yelp integration for restaurant recommendations
- **COMM-03**: Ticketmaster integration for event tickets

### Platform

- **PLAT-01**: React Native mobile app
- **PLAT-02**: Visa Click to Pay / Mastercard Buyer Payment Agent
- **PLAT-03**: A2A Protocol (Google agent-to-agent commerce)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| General password manager | PayJarvis stores credentials for action, not password management |
| Storing 2FA backup codes | Security risk too high, user manages their own 2FA |
| Silent autonomous actions | User must always be notified before Jarvis acts on their behalf |
| Cart pre-population at plan time | Carts expire — only populate at execution after approval |
| Real-time chat/messaging | Not core to commerce value |
| Video content | Storage/bandwidth costs disproportionate to value |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 — VPS Disk Cleanup | Pending |
| INFRA-02 | Phase 1 — VPS Disk Cleanup | Pending |
| INFRA-03 | Phase 5 — Supabase → VPS Migration | Pending |
| INFRA-04 | Phase 5 — Supabase → VPS Migration | Pending |
| INFRA-05 | Phase 5 — Supabase → VPS Migration | Pending |
| BUTL-01 | Phase 3 — Butler Protocol Autofill | Pending |
| BUTL-02 | Phase 3 — Butler Protocol Autofill | Pending |
| BUTL-03 | Phase 3 — Butler Protocol Autofill | Pending |
| BUTL-04 | Phase 3 — Butler Protocol Autofill | Pending |
| BUTL-05 | Phase 3 — Butler Protocol Autofill | Pending |
| BUTL-06 | Phase 3 — Butler Protocol Autofill | Pending |
| BUTL-07 | Phase 3 — Butler Protocol Autofill | Pending |
| SHOP-01 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-02 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-03 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-04 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-05 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-06 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-07 | Phase 4 — Shopping Planner Approval | Pending |
| SHOP-08 | Phase 4 — Shopping Planner Approval | Pending |
| AUDIO-01 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| AUDIO-02 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| AUDIO-03 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| AUDIO-04 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| META-01 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| META-02 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| META-03 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| META-04 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |
| META-05 | Phase 2 — Audio Routing + Ray-Ban Meta | Pending |

**Coverage:**
- v1.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after initial definition*
