-- Supabase advisor "rls_disabled_in_public" (Patrick, 2026-08-25): the ONE
-- public table without Row-Level Security was the safety copy the
-- 20260817160000 entered_at backfill left behind. It holds ledger rows
-- (scout ids + activity credit) and was readable/writable with the anon key.
-- Nothing in the app reads it (every loader uses the service-role admin
-- client); enabling RLS with no policies closes it to anon entirely while
-- keeping the copy for a rollback. Dropping it is a separate, deliberate step.
alter table if exists public.ledger_entries_entered_at_backup_20260817 enable row level security;
