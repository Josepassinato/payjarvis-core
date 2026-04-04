# Roadmap: PayJarvis

**Active Milestone:** v1.1 Premium Travel
**Created:** 2026-04-04
**Phases:** 9 (v1.1 adds phases 7–9)
**Requirements (v1.1):** 10

---

## Phases

- [x] **Phase 1: VPS Disk Cleanup** - Reduce disk from 83%+ to below 60% *(v1.0 — complete)*
- [x] **Phase 2: Audio + Ray-Ban Meta** - Port audio/text routing and Ray-Ban detection to WhatsApp *(v1.0 — complete)*
- [x] **Phase 3: Butler Protocol** - Autofill execution layer for autonomous site actions *(v1.0 — complete)*
- [x] **Phase 4: Shopping Planner** - Approval workflow for purchase plans *(v1.0 — complete)*
- [x] **Phase 5: Supabase Migration** - Migrate 9 projects to local PostgreSQL *(v1.0 — complete)*
- [x] **Phase 6: Validation & Close** - Milestone v1.0 validation gate *(v1.0 — complete)*
- [ ] **Phase 7: RateHawk Hotel Scraper** - Browser-agent login, search, and B2B price extraction from RateHawk
- [ ] **Phase 8: Amadeus Flight Enhancement** - Flexible date search, price confidence, and enriched results
- [ ] **Phase 9: Premium Travel Route** - Combined hotel+flight endpoint gated by premium plan

---

## Phase Details

### Phase 7: RateHawk Hotel Scraper
**Goal**: Sniffer can search RateHawk hotels and return B2B prices without user needing to log in
**Depends on**: Nothing (browser-agent already running on port 3003)
**Requirements**: HOTEL-01, HOTEL-02, HOTEL-03, HOTEL-04
**Success Criteria** (what must be TRUE):
  1. Sniffer logs into RateHawk automatically and the session persists across searches without re-login
  2. User can say "find hotels in Rome for 2 people, April 10-15" and get real hotel results back
  3. Each result includes hotel name, B2B price, retail price, room type, meals, cancellation policy, rating, and distance
  4. Results are sorted by price with a savings percentage showing B2B discount vs retail
**Plans**: TBD
**UI hint**: no

### Phase 8: Amadeus Flight Enhancement
**Goal**: Flight search becomes useful by showing cheapest dates and pricing confidence instead of a single date dump
**Depends on**: Phase 7 (parallel build acceptable, but Phase 9 requires both)
**Requirements**: FLIGHT-01, FLIGHT-02, FLIGHT-03
**Success Criteria** (what must be TRUE):
  1. User searching "cheapest flights Rio to Madrid around April 20" gets results across a 7-day window (±3 days) ranked by price
  2. Each flight result shows a price indicator (good / average / expensive) based on historical data for that route
  3. Results display airline, number of stops, total duration, and price alongside the confidence indicator
**Plans**: TBD
**UI hint**: no

### Phase 9: Premium Travel Route
**Goal**: Premium users can search hotels and flights in one request and see total trip cost
**Depends on**: Phase 7, Phase 8
**Requirements**: PREM-01, PREM-02, PREM-03
**Success Criteria** (what must be TRUE):
  1. A premium user can call `/api/travel/search-premium` with origin, destination, dates, guests and receive both hotel and flight results in a single response
  2. A free-tier user hitting the same endpoint receives a 401 with a clear message indicating premium plan is required
  3. The response includes a total trip cost estimate combining the cheapest flight + lowest B2B hotel rate for the selected dates
**Plans**: TBD
**UI hint**: no

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. VPS Disk Cleanup | — | Complete | 2026-03-30 |
| 2. Audio + Ray-Ban Meta | — | Complete | 2026-03-30 |
| 3. Butler Protocol | — | Complete | 2026-03-30 |
| 4. Shopping Planner | — | Complete | 2026-03-30 |
| 5. Supabase Migration | — | Complete | 2026-03-30 |
| 6. Validation & Close | — | Complete | 2026-03-30 |
| 7. RateHawk Hotel Scraper | 0/? | Not started | - |
| 8. Amadeus Flight Enhancement | 0/? | Not started | - |
| 9. Premium Travel Route | 0/? | Not started | - |

---

## Requirement Coverage (v1.1)

| Requirement | Phase | Status |
|-------------|-------|--------|
| HOTEL-01 | Phase 7 | Pending |
| HOTEL-02 | Phase 7 | Pending |
| HOTEL-03 | Phase 7 | Pending |
| HOTEL-04 | Phase 7 | Pending |
| FLIGHT-01 | Phase 8 | Pending |
| FLIGHT-02 | Phase 8 | Pending |
| FLIGHT-03 | Phase 8 | Pending |
| PREM-01 | Phase 9 | Pending |
| PREM-02 | Phase 9 | Pending |
| PREM-03 | Phase 9 | Pending |

**Coverage: 10/10 (100%)**

---

## Technical Context (v1.1)

### RateHawk Scraper (Phase 7)
- RateHawk selectors: `destination-input`, `search-button`, `serp-hotelcard`, `datepicker-calendar`, `date-start-input`, `date-end-input`, `guests-input`
- URL pattern: `/hotel/{country}/{city}/?q={id}&dates={DD.MM.YYYY}-{DD.MM.YYYY}&guests={n}`
- Credentials: `RATEHAWK_EMAIL`, `RATEHAWK_PASSWORD` (env vars, AES-256 session storage)
- Runs in browser-agent (port 3003) via BrowserBase/Stagehand
- Session cookie encrypted with `VAULT_ENCRYPTION_KEY` (existing pattern from Amazon vault)

### Amadeus Enhancement (Phase 8)
- Existing endpoints: `POST /api/commerce/flights/search` and `GET /flights/search`
- Flexible dates: query ±3 days around target, return ranked by price
- Price confidence: compare current price to 90-day historical average for the route
- Keep backwards-compatible — existing callers must not break

### Premium Gate (Phase 9)
- Auth check: `user.planType === 'premium'` via Clerk JWT
- New endpoint: `POST /api/travel/search-premium`
- Orchestrates Phase 7 (hotel) + Phase 8 (flight) in parallel, merges results
- Trip cost estimate: lowest hotel rate × nights + cheapest flight price

---

*Roadmap created: 2026-03-30 (v1.0)*
*v1.1 phases added: 2026-04-04*
*Build order rationale: Hotel scraper first (most novel work, Playwright-heavy) → Flight enhancement (API work, independent) → Premium route last (requires both scrapers working)*
