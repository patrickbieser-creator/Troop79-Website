-- Supabase Security Advisor sweep (Patrick, 2026-08-25, after the
-- rls_disabled_in_public email). Three findings, all closed here; every
-- app read/write goes through the service-role admin client, which keeps
-- its access, so nothing user-visible changes.
--
-- 1. security_definer_view — ten public views ran with their owner's rights,
--    bypassing RLS on people / scouts / ledger_entries, and the anon role
--    holds SELECT on them. With security_invoker the caller's own RLS
--    applies, which for anon is "nothing" on those tables.
-- 2. anon (and authenticated) could EXECUTE every public function, including
--    SECURITY DEFINER ones such as merge_people. Revoke from anon /
--    authenticated / PUBLIC; grant service_role explicitly (it previously
--    relied on the PUBLIC grant); make the same the default for new functions.
-- 3. function_search_path_mutable — pin search_path = public on every public
--    function so a caller-controlled search_path cannot swap in a lookalike.
--
-- All three are written as DO loops over the catalog so the migration is the
-- same on local and prod and stays correct as functions and views are added.

-- 1. views → security_invoker
do $$
declare v record;
begin
  for v in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- 2. function execute grants
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- 3. search_path pinned
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;
