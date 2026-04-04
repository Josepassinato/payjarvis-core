# State: PayJarvis

## Current Position

Phase: 7 (starting)
Plan: —
Status: Roadmap defined, ready to plan Phase 7
Last activity: 2026-04-04 — Milestone v1.1 roadmap created

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** The user tells Sniffer what they want, and Sniffer finds, compares, and buys it — safely, autonomously, with full spending control.
**Current focus:** Milestone v1.1 — Premium Travel (Phase 7: RateHawk Hotel Scraper)

## Milestone Progress: 0% (v1.1)

| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| 1 | VPS Disk Cleanup | ✅ COMPLETE | 2026-03-30 |
| 2 | Audio + Ray-Ban Meta | ✅ COMPLETE | 2026-03-30 |
| 3 | Butler Protocol | ✅ COMPLETE | 2026-03-30 |
| 4 | Shopping Planner | ✅ COMPLETE | 2026-03-30 |
| 5 | Supabase Migration | ✅ COMPLETE | 2026-03-30 |
| 6 | Validation & Close | ✅ COMPLETE | 2026-03-30 |
| 7 | RateHawk Hotel Scraper | 🔲 NOT STARTED | - |
| 8 | Amadeus Flight Enhancement | 🔲 NOT STARTED | - |
| 9 | Premium Travel Route | 🔲 NOT STARTED | - |

## Performance Metrics

- Requirements defined: 10/10
- Requirements mapped: 10/10 (100% coverage)
- Phases planned: 0/3
- Plans complete: 0

## Accumulated Context

### Decisions
- RateHawk via Playwright (not API) — account lacks API access, browser scraper is the bridge
- Amadeus enhancements are backwards-compatible — existing callers at `/api/commerce/flights/search` must not break
- Premium gate uses existing `user.planType` field from Clerk JWT — no schema migration needed
- Session cookies for RateHawk stored with existing AES-256 pattern (same as Amazon vault)

### Key Technical Facts
- Browser-agent runs on port 3003 with BrowserBase/Stagehand
- RateHawk selectors confirmed: destination-input, search-button, serp-hotelcard, datepicker-calendar, date-start-input, date-end-input, guests-input
- RateHawk URL pattern: /hotel/{country}/{city}/?q={id}&dates={DD.MM.YYYY}-{DD.MM.YYYY}&guests={n}
- Credentials in env: RATEHAWK_EMAIL, RATEHAWK_PASSWORD
- Amadeus existing: POST /api/commerce/flights/search and GET /flights/search
- Premium check: user.planType === 'premium' via Clerk JWT

### Pending (non-blocking, carried from v1.0)
- [ ] Supabase account cancellation (after 1-week verification — target: 2026-04-06)
- [ ] Delete 14 dead Supabase projects from dashboard
- [ ] Playwright E2E test files not found in workspace (may need rebuild)

### Blockers
- None

## Session Continuity

Next action: `/gsd:plan-phase 7` to decompose Phase 7 (RateHawk Hotel Scraper) into executable plans.

Phase 7 key scope:
- New browser-agent task: login to RateHawk, maintain session, search by city/dates/guests
- Extract: name, B2B price, retail price, room type, meals, cancellation policy, rating, distance
- Return top 10 sorted by price with B2B savings highlighted
- New API route in apps/api to expose the scraper result

Phase 8 key scope:
- Modify existing Amadeus flight search to support ±3 day flexible window
- Add price confidence scoring (good/average/expensive vs 90-day historical)
- Enrich results with airline, stops, duration — backwards-compatible

Phase 9 key scope:
- New route: POST /api/travel/search-premium
- Auth gate: planType === 'premium' → 401 for free users
- Parallel call to Phase 7 hotel scraper + Phase 8 flight search
- Merge results with total trip cost estimate
