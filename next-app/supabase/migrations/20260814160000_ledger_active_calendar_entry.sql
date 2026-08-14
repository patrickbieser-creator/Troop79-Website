-- Refresh ledger_active so it exposes ledger_entries.calendar_entry_id.
--
-- WHY (Operator, 2026-08-14)
-- `ledger_active` is defined as `select * from ledger_entries`, but Postgres
-- EXPANDS that star into an explicit column list when the view is created. The
-- view therefore froze the column set as it stood, and 20260814140000's new
-- `calendar_entry_id` was invisible through it — the reconciliation audit,
-- which reads ledger_active, failed outright with
-- "column ledger_active.calendar_entry_id does not exist".
--
-- Exactly the same refresh 20260719050000 needed when it added the
-- scoutbook_submitted_* / presented_* columns. Worth knowing as a standing
-- rule: adding a column to ledger_entries means recreating this view too.
--
-- Caught by browser verification, not by tests — the Roll Call tests query
-- ledger_entries directly, so nothing exercised the view's column list.

create or replace view public.ledger_active as
  select * from public.ledger_entries
  where archived_at is null and deleted_at is null;
