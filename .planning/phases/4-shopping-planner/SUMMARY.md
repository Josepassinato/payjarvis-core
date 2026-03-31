---
phase: 4
name: Shopping Planner — Approval Workflow
status: complete
completed: 2026-03-30
---

# Phase 4 — Complete

## What was delivered

Added user approval layer to Shopping Planner — users can review, modify, and confirm purchase plans before execution.

## Key changes

1. **Prisma Migration** — 4 new columns on `shopping_lists`:
   - `approved_at` (DateTime?)
   - `approved_items` (JSONB)
   - `rejected_items` (JSONB)
   - `purchase_result` (JSONB)

2. **Approval Route** (`POST /api/shopping/lists/:id/approve`) — Handles approve_all, approve_partial, reject, swap_store. Re-validates prices if list >1 hour old.

3. **Execute Route** (`POST /api/shopping/lists/:id/execute`) — Stub endpoint for future purchase execution.

4. **`shopping_plan_action` tool** — Added to gemini.js and jarvis-whatsapp.service.ts with listId, action, approvedItemIds, rejectedItemIds, swapRequests params.

5. **Tool handlers** — Added to both index.js (OpenClaw) and jarvis-whatsapp.service.ts (WhatsApp).

## Commits
- PayJarvis: `8dec4b3`, `4e8f57c`, `2260b5d`
- OpenClaw: `b8f00b0`, `9eca418`

## Requirements covered
- SHOP-01 through SHOP-08
