-- Security Advisor "RLS Policy Always True" (Patrick, 2026-08-25): ledger_write_any
-- was FOR ALL TO authenticated USING (true) — a leftover from before every
-- write moved to the service-role admin client (which bypasses RLS). The app
-- never creates Supabase-authenticated sessions (identity is its own login
-- tokens), so the policy protected nothing and permitted everything. Dropped;
-- ledger_entries keeps RLS on with no policies, like the other 48 tables.
drop policy if exists ledger_write_any on public.ledger_entries;
