-- Event money: an overpayment CREDITED to the scout account leaves the event
-- (Patrick, 2026-08-22, the Anjali case: owed 30, paid 60, 30 credited —
-- "shouldn't the balance be zero?"). Yes. The balances view now nets the
-- credit: balance = owed − paid + credited, so a fully credited overpayment
-- reads settled while `paid` still tells the truth ($60) and `credited` says
-- where the rest went. A credit is a positive, non-voided `scout_account`
-- adjustment row linked to the entry — exactly what creditOverpaymentAction
-- writes (kind 'adjustment', account 'scout_account', signup_entry_id set).
--
-- CREATE OR REPLACE VIEW may only APPEND columns, so `credited` goes last.
-- Code was deployed first and does not select the new column; it reads
-- balance/settled, which simply become right once this lands.
create or replace view public.signup_entry_balances
  with (security_invoker = true) as
with base as (
  select se.id as entry_id,
         se.event_signup_id,
         coalesce(
           se.amount_override,
           case when p.per = 'day' then p.amount * coalesce(se.days, 1) else p.amount end,
           0
         )::numeric(10,2) as owed,
         coalesce((
           select sum(ft.amount) from public.financial_transactions ft
            where ft.signup_entry_id = se.id and ft.voided_at is null and ft.kind = 'event_fee'
         ), 0)::numeric(10,2) as paid,
         coalesce((
           select sum(ft.amount) from public.financial_transactions ft
            where ft.signup_entry_id = se.id and ft.voided_at is null
              and ft.account = 'scout_account' and ft.kind = 'adjustment' and ft.amount > 0
         ), 0)::numeric(10,2) as credited
    from public.signup_entries se
    left join public.event_prices p on p.id = se.price_id
)
select entry_id, event_signup_id, owed, paid,
       (owed - paid + credited)::numeric(10,2) as balance,
       (owed > 0 and paid - credited >= owed) as settled,
       credited
  from base;
