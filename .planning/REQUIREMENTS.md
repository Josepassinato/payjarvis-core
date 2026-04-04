# Requirements: PayJarvis — Milestone v1.1 Premium Travel

**Defined:** 2026-04-04
**Core Value:** The user tells Sniffer what they want, and Sniffer finds, compares, and buys it — safely, autonomously, with full spending control.

## v1.1 Requirements

### Hotel Search (RateHawk)

- [ ] **HOTEL-01**: System can login to RateHawk automatically and maintain session cookies
- [ ] **HOTEL-02**: User can search hotels by city, dates, and guest count via Sniffer
- [ ] **HOTEL-03**: System extracts hotel name, B2B price, retail price, room type, meals, cancellation policy, rating, and distance from search results
- [ ] **HOTEL-04**: System returns top 10 hotel results sorted by price with B2B savings highlighted

### Flight Search (Amadeus Enhanced)

- [ ] **FLIGHT-01**: User can search flights with flexible dates (+-3 days) to find cheapest option
- [ ] **FLIGHT-02**: System provides price analysis indicator (good/average/expensive vs historical data)
- [ ] **FLIGHT-03**: System returns enriched flight results with airline, stops, duration, and price confidence

### Premium Travel Route

- [ ] **PREM-01**: Premium users can search hotels and flights in a single request via `/api/travel/search-premium`
- [ ] **PREM-02**: Route is gated by `planType === 'premium'` — free users get 401
- [ ] **PREM-03**: Results combine hotel + flight options with total trip cost estimate

## Future Requirements

### Miles & Loyalty

- **MILES-01**: System shows equivalent miles for cash prices (static conversion table)
- **MILES-02**: System compares cash vs miles for the same itinerary

### Booking

- **BOOK-01**: User can book hotels directly via RateHawk API (requires API access)
- **BOOK-02**: User can book flights via Amadeus booking API

## Out of Scope

| Feature | Reason |
|---------|--------|
| RateHawk API integration | Account doesn't have API access yet — Playwright bridge for now |
| Hotel booking via RateHawk | Search only — booking requires API or manual action |
| Miles/loyalty point comparison | No API access to LATAM Pass/Smiles — defer to future |
| Flight booking via Amadeus | Already exists as basic stub — not part of this milestone |
| RateHawk flights | Account doesn't have flights module enabled |
| Google Flights/Kayak scraping | ToS violation, fragile, actively blocked by anti-bot |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HOTEL-01 | Pending | Pending |
| HOTEL-02 | Pending | Pending |
| HOTEL-03 | Pending | Pending |
| HOTEL-04 | Pending | Pending |
| FLIGHT-01 | Pending | Pending |
| FLIGHT-02 | Pending | Pending |
| FLIGHT-03 | Pending | Pending |
| PREM-01 | Pending | Pending |
| PREM-02 | Pending | Pending |
| PREM-03 | Pending | Pending |

**Coverage:**
- v1.1 requirements: 10 total
- Mapped to phases: 0
- Unmapped: 10

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-04 after milestone v1.1 initialization*
