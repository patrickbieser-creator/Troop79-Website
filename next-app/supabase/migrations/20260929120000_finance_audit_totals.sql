-- Ledger Audit (Plans/Ledger-Audit.md, Patrick 2026-09-29): Postgres's own
-- totals over financial_transactions, so the audit can compare the app's
-- JavaScript balances against a second engine reading the table directly.
-- numeric arithmetic here, integer cents in lib/finance.ts; a mismatch — or a
-- row count that differs from what the app read (the PostgREST 1000-row cap)
-- — is the finding.
--
-- DEPLOY ORDER: DB-first. Additive; nothing calls it until the audit page ships.
--
-- SECURITY INVOKER (tech-lead): only service_role executes it, and
-- service_role bypasses RLS anyway — definer would add risk for nothing.

create or replace function public.finance_audit_totals()
returns table (
  account text,
  person_id bigint,
  live_total numeric,
  live_rows bigint,
  voided_rows bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select ft.account,
         ft.person_id,
         coalesce(sum(ft.amount) filter (where ft.voided_at is null), 0)::numeric as live_total,
         count(*) filter (where ft.voided_at is null) as live_rows,
         count(*) filter (where ft.voided_at is not null) as voided_rows
    from public.financial_transactions ft
   group by ft.account, ft.person_id
   order by ft.account, ft.person_id nulls first;
$$;

revoke execute on function public.finance_audit_totals() from public, anon, authenticated;
grant execute on function public.finance_audit_totals() to service_role;

comment on function public.finance_audit_totals() is
  'Ledger Audit: per (account, person) live sums and row counts, computed by Postgres independently of the app.';
