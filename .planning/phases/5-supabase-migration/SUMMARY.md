---
phase: 5
name: Supabase to VPS PostgreSQL Migration
status: complete
completed: 2026-03-30
---

# Phase 5 — Complete

## What was delivered

All 18 Supabase databases migrated to local PostgreSQL on VPS. No active project depends on Supabase at runtime.

## Database Migration Status

### 15 DBs with data (imported and verified)
| Database | Tables | Rows |
|----------|--------|------|
| bhome | 5 | ~29 |
| brain12_agentes | 5 | ~48 |
| contaflix | 135 | ~7,925 |
| contaflux_lr | 2 | ~0 |
| crie_app | 2 | ~0 |
| escola_12brain | 27 | ~72 |
| habitus | 22 | ~13 |
| increase_team | 4 | ~24 |
| influencers | 3 | ~10 |
| marcenaria_ia | 4 | ~2 |
| mcp_agentes | 3 | ~0 |
| mentorbr | 4 | ~0 |
| payjarvis_sb | 9 | ~1 |
| payjarvispremium | 1 | ~0 |
| toolsber | 9 | ~0 |

### 3 empty DBs (created locally, were empty on Supabase)
- morgatia, contaflux_agente, lucro_real

### Already local (no migration needed)
- payjarvis (main production DB — already on localhost:5432/payjarvis)

## Active projects Supabase status
- **PayJarvis**: Already local PG. SUPABASE_URL commented out in .env.production
- **OpenClaw**: Uses PayJarvis DB (local PG) — no Supabase dependency
- **Desck-PRO, Nucleo-empreende, vid-teach-guide**: Reference Supabase JS client but NOT running in PM2 (inactive projects)

## Pending (user action required)
- [ ] 1-week verification period before canceling Supabase account
- [ ] Delete 14 dead Supabase projects from dashboard
- [ ] Cancel Supabase subscription ($150/month)
- [ ] Update inactive project .env files to point to local PG (when/if reactivated)

## Requirements covered
- INFRA-03 (database migration)
- INFRA-04 (dead project cleanup — ready to execute on dashboard)
- INFRA-05 (cancel Supabase — after 1-week verification)
