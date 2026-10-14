# Admin Performance Review — 2026-10-13

**Status:** SHIPPED v1.218.0 (2026-10-13, ef4d515) — the four quick fixes and the three larger jobs.
**Priority:** Medium
**Follows:** `Plans/Performance-Review-2026-08-27.md`

## Overview

Patrick: "The admin is getting sluggish once again." A read-only audit (code + production `pg_stat_statements`,
`pg_stat_user_tables`, EXPLAIN) found the database is small (ledger 11k rows) and mostly not the bottleneck.
Perceived slowness comes from no loading feedback on admin navigation and a zero client cache; three query
hot spots are real.

## Findings (ranked by impact ÷ effort)

1. **No `loading.tsx` anywhere and no `staleTimes`.** Every admin click shows nothing until the server render ends;
   back/forward refetch everything.
2. **`ledger_entries.code LIKE '<mbId>-%'` seq-scans** (mb-progress/[mbId]/page.tsx:79, (public)/library/mb/[mbId]/page.tsx:163).
   Prod: 1,590 + 2,334 calls, mean 78 ms / 37.5 ms, max ~390 ms; 16,055 seq scans on ledger_entries. Existing btree
   on `code` can't serve LIKE (non-C collation). Those paginated reads also lack `.order()`.
3. **`mb_progress` view ~66 ms per read** — nested loop with `code ~~ (m.id || '-%')`, 188,720 rows removed by join
   filter. Callers: mb-progress/page.tsx:35, has-needs/page.tsx:55, (public)/library/page.tsx:88, meeting-plan/load-input.ts:51.
4. **Fast Entry skips the cached catalog** (fast-entry/page.tsx:70-93: 10 queries incl. paginated
   merit_badge_requirements; `loadAdvancementCatalog()` already caches them). Today's-tape read is `select('*')`.
5. **Finance page reads `financial_transactions` four times** (finance/actions.ts:197, :221, :1031, :1297 via fetchAllRows),
   reconciliation adds 2 serial reads in a loop.
6. Per-request overhead (proxy.ts, layout `person_authz` RPC in cache(), Home inbox in parallel) is fine.
7. Small: roster guest chain 3 serial reads on every tab (roster/page.tsx:152-185); wreath card loads the sale twice.

## Quick wins (≤ 1 hour each)

- [ ] `experimental.staleTimes: { dynamic: 30 }` in next.config.ts (actions that revalidate still clear it; risk:
      another leader's edit can show up to 30 s late).
- [ ] `loading.tsx` skeletons at `admin/(workspace)/`, `advancement/`, `finance/`.
- [ ] Index + `.order('id')` on the two `code.like` reads:
      `create index concurrently if not exists ledger_entries_code_pattern_idx on public.ledger_entries (code text_pattern_ops) where archived_at is null and deleted_at is null;`
      (verify the planner uses it with the `.or(...)`; fallback: gte/lt range queries).
- [ ] Fast Entry onto `loadAdvancementCatalog()`.

## Larger work

- [ ] Rewrite the `mb_progress` view join (hyphen-prefix candidates, hash join, longest match) — keep the 2026-07-19
      hyphenated-id fix; run the existing mb_progress tests first. Expected 66 → ~10 ms.
- [ ] One finance balances aggregate (RPC/view grouped by account, person) + one distinct-label query.
- [ ] Roster guest chain into one query or only on the Guests tab.
- Deferred, unchanged: `cacheComponents` / `'use cache'`; moving Supabase to us-east-1.

## Not measured

Real Vercel function timings / TTFB; whether the index is chosen; client bundle sizes. `pg_stat_statements` also shows
304 PostgREST schema reloads and `pg_timezone_names` at 500 ms × 304 — Supabase tooling, not app traffic.
