# Tools Rationalization — 2026-04-06

## Summary

Reduced Gemini tool declarations from **~48 to 36** through dead tool removal, consolidation, and lazy loading.

**Impact**: Fewer tokens per Gemini call, faster response times, cleaner tool selection.

---

## PASSO 1: Tool Call Logging (Safety Net)

### New Prisma Model: `ToolCallLog`
- Table: `tool_call_logs`
- Fields: userId, toolName, parameters (JSON), success, duration (ms), channel, errorMessage
- Indexes: (toolName, createdAt), (userId, createdAt), (createdAt)
- Migration: `20260406_add_tool_call_logs`

### Handler Instrumentation
- `handleTool()` now wraps `_handleToolInner()` with timing + logging
- Fire-and-forget async logging (never blocks tool response)
- Logs: tool name, parameters, success/failure, duration, channel (whatsapp/telegram/pwa)

---

## PASSO 2: Dead Tools Removed (12 tools)

Removed from declarations only. **Handlers preserved** for easy reactivation.

| Tool | Reason |
|------|--------|
| `amazon_search` | Duplicate of `search_products` |
| `search_flights` | Amadeus API key = CHANGE_ME |
| `search_hotels` | Amadeus API key = CHANGE_ME |
| `search_restaurants` | Yelp API key = CHANGE_ME |
| `search_events` | Ticketmaster API key = CHANGE_ME |
| `skyfire_setup_wallet` | Skyfire API non-functional |
| `skyfire_checkout` | Skyfire API non-functional |
| `skyfire_my_purchases` | Skyfire API non-functional |
| `skyfire_spending` | Skyfire API non-functional |
| `skyfire_set_limits` | Skyfire API non-functional |
| `smart_checkout` | Depends on Skyfire |
| `request_payment` | Dead — superseded by manage_payment_methods |

Also removed from `gemini.ts` credentialTools: `amazon_search`, `smart_checkout`, and vault tools consolidated.

---

## PASSO 3: Tool Consolidation (12 → 4)

### manage_vault (was: setup_vault, save_card, list_vault_items, delete_vault_item)
- `action: "setup"` → setup_vault handler
- `action: "save"` → save_card handler
- `action: "list"` → list_vault_items handler
- `action: "delete"` → delete_vault_item handler

### manage_contacts (was: list_contacts, delete_contact, update_contact)
- `action: "list"` → list_contacts handler
- `action: "delete"` → delete_contact handler
- `action: "update"` → update_contact handler

### manage_reminders (was: set_reminder, get_reminders, complete_reminder)
- `action: "set"` → set_reminder handler
- `action: "list"` → get_reminders handler
- `action: "complete"` → complete_reminder handler

### manage_price_alerts (was: set_price_alert, get_price_alerts)
- `action: "set"` → set_price_alert handler
- `action: "list"` → get_price_alerts handler
- `action: "delete"` → new (deactivates alert by ID)

---

## PASSO 4: Lazy Loading — `getToolsForContext()`

### Architecture
- **12 core tools** always loaded: web_search, browse, search_products, compare_prices, find_coupons, check_price_history, manage_price_alerts, save_user_fact, manage_reminders, manage_vault, manage_contacts, share_jarvis
- **24 conditional tools** loaded only when user message matches regex triggers
- Logs: `[TOOLS] Loaded N/M tools for context` on every conversation

### Trigger Examples
| Tool | Triggers On |
|------|-------------|
| `grocery_search` | groc, supermercado, milk, eggs, publix |
| `make_phone_call` | liga, call, telefon, phone |
| `butler_gmail` | email, gmail, inbox |
| `search_transit` | trem, train, ônibus, bus, amtrak |
| `generate_document` | document, contrato, carta, report, pdf |

### Safety
- Tools without a defined trigger always load (fail-safe)
- Original handlers still respond to old tool names (backward compat)

---

## PASSO 5: System Prompt — Tool Selection Rules

Added to Gemini system prompt:
```
TOOL SELECTION RULES
- Product/buy/price → search_products
- Compare prices → compare_prices
- Coupon/discount → find_coupons
- Price alert → manage_price_alerts
- Profile/preference → save_user_fact
- Reminder → manage_reminders
- Vault/card → manage_vault
- Contact → manage_contacts
- Web search → web_search
- Navigate site → browse
```

Also removed dead reference to `request_payment` from execution flow.

---

## Files Changed

| File | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | Added ToolCallLog model |
| `packages/database/prisma/migrations/20260406_add_tool_call_logs/migration.sql` | New migration |
| `apps/api/src/services/jarvis-whatsapp.service.ts` | All 5 steps |
| `apps/api/src/services/gemini.ts` | Removed amazon_search, smart_checkout, consolidated vault |

## Tool Count

| Stage | Count |
|-------|-------|
| Before | ~48 declarations |
| After dead removal | 36 |
| After consolidation | 36 (12→4 = 8 fewer, but handlers still exist) |
| Core (always loaded) | 12 |
| Conditional (on-demand) | 24 |

## Validation

- TypeScript build: 0 errors
- PM2 restart: payjarvis-api online
- Smoke test: 16/16 passed, 0 failed
- DB migration: applied successfully

## Reactivation Guide

To reactivate a removed tool:
1. Un-comment its declaration in `jarvis-whatsapp.service.ts` (search for `REMOVED:`)
2. Add its API key to `.env.production`
3. Build + restart
4. Handler already exists — no code changes needed
