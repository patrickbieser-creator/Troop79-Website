-- Finance page: database-side aggregates instead of reading every financial_transactions row
-- four times per render (balances, scout balances, reconciliation, activity labels).
--
-- finance_balances(p_as_of): per (account, person_id) balance in integer CENTS, voided rows
-- excluded — the same rule as lib/finance computeBalance (sum of round(amount * 100) over rows with
-- voided_at is null). p_as_of (optional) keeps rows with occurred_on <= p_as_of, which is what
-- reconciliationDrift does for a statement date. The app sums the groups it needs.
--
-- finance_activity_labels(): distinct non-empty activity_label values, voided rows INCLUDED (the old
-- read never filtered them). Unordered on purpose: the action sorts in JS so the order stays
-- code-unit order, exactly as before.
--
-- DEPLOY ORDER: DB-first. Additive; nothing calls them until the app ships.
-- SECURITY INVOKER, search_path pinned, service_role only (D-239; same as finance_audit_totals).

create or replace function public.finance_balances(p_as_of date default null)
returns table (
  account text,
  person_id bigint,
  balance_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select ft.account,
         ft.person_id,
         coalesce(sum(round(ft.amount * 100)), 0)::bigint as balance_cents
    from public.financial_transactions ft
   where ft.voided_at is null
     and (p_as_of is null or ft.occurred_on <= p_as_of)
   group by ft.account, ft.person_id;
$$;

revoke execute on function public.finance_balances(date) from public, anon, authenticated;
grant execute on function public.finance_balances(date) to service_role;

comment on function public.finance_balances(date) is
  'Per (account, person) live balance in cents, optionally as of a date. Same semantics as lib/finance computeBalance.';

create or replace function public.finance_activity_labels()
returns table (activity_label text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct ft.activity_label
    from public.financial_transactions ft
   where ft.activity_label is not null
     and ft.activity_label <> '';
$$;

revoke execute on function public.finance_activity_labels() from public, anon, authenticated;
grant execute on function public.finance_activity_labels() to service_role;

comment on function public.finance_activity_labels() is
  'Distinct non-empty activity labels in use (voided rows included), for the Record form autocomplete.';
