-- Event money: fees paid FROM a notional account (scout_account, scholarship)
-- are NEGATIVE rows on that account — the finance plan's "a scout spending
-- that balance on a camp fee is a single scout_account −50 row" — so the
-- per-scout balance goes down. The event side of that same row is +50 paid.
-- The balances view now reads event_fee rows with the sign the EVENT sees:
-- notional-account rows flipped, checking rows as-is (refunds stay negative).
--
-- Found 2026-08-22 while adding the scout-account guard (Patrick): the app's
-- "Scout account balance" payment had been writing +amount into scout_account,
-- raising the scout's balance instead of lowering it. recordEventFeePaymentAction
-- / refundEventFeeAction now write the notional sign; this view makes the event
-- balance read the same either way. Trailing `credited` column kept
-- (20260823100000). Code deployed first; it selects neither new behaviour.
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
           select sum(case when ft.account in ('scout_account', 'scholarship') then -ft.amount else ft.amount end)
             from public.financial_transactions ft
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

-- Repair any app-written scout-account fee rows that carry the old (+) sign:
-- an event_fee on scout_account written by the app is a payment FROM the
-- account and must be negative. Imported rows were already negative.
update public.financial_transactions
   set amount = -amount
 where account = 'scout_account' and kind = 'event_fee' and source = 'app' and amount > 0;
