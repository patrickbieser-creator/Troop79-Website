-- Track two confirmations per award/rank ledger row, independent of each
-- other: submission to Scoutbook's official record, and physical
-- presentation to the scout (usually at a regular meeting, sometimes a
-- Court of Honor — the troop does both, so this isn't tied to coh_history).
-- Same write-once-by-a-human, nullable-until-confirmed shape as the existing
-- archived_at/archived_by and deleted_at/deleted_by columns on this table.

set search_path = public;

alter table public.ledger_entries
  add column scoutbook_submitted_at timestamptz,
  add column scoutbook_submitted_by text,
  add column presented_at timestamptz,
  add column presented_by text;

-- ledger_active is `select * from ledger_entries` — Postgres expands `select *`
-- into an explicit column list at CREATE VIEW time (see
-- 20260705000100_ledger_active_view_refresh.sql), so it won't pick up the
-- 4 columns just added above without being recreated.
create or replace view public.ledger_active as
  select * from public.ledger_entries
  where archived_at is null and deleted_at is null;
