-- Prefix-LIKE support for ledger_entries.code (Plans/Performance-Review-2026-10-13.md, finding 2).
--
-- The merit-badge pages read `code LIKE '<mbId>-%'` (admin mb-progress/[mbId], public library/mb/[mbId]).
-- The existing btree on `code` uses the database collation, which cannot serve LIKE prefixes, so every read was a
-- sequential scan of ledger_entries (production: 16k seq scans, mean 38-78 ms). text_pattern_ops can.
-- Partial on the same predicate both callers filter on (archived_at / deleted_at null). Plain CREATE INDEX, not
-- CONCURRENTLY: the table is ~5 MB (ms to build) and CONCURRENTLY cannot run inside the migration transaction.
create index if not exists ledger_entries_code_pattern_idx
  on public.ledger_entries (code text_pattern_ops)
  where archived_at is null and deleted_at is null;
