-- Drop the 2026-08-17 entered_at backfill's safety copy (Patrick, 2026-08-25:
-- "drop the table. Not needed."). The backfill has been live for eight days;
-- the copy was the only public table without RLS.
drop table if exists public.ledger_entries_entered_at_backup_20260817;
