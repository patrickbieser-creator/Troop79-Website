-- ledger_active is `select * from ledger_entries` — Postgres expands `select *`
-- into an explicit column list at CREATE VIEW time, so the view didn't pick up
-- event_type_id (added in 20260705000000_event_types.sql) automatically.
-- Recreate it so the new column flows through.

create or replace view public.ledger_active as
  select * from public.ledger_entries
  where archived_at is null and deleted_at is null;
