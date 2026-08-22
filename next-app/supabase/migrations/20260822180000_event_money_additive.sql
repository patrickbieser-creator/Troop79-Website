-- Event Logistics, Phase 0 / C — money, ADDITIVE ONLY (Plans/Event-Logistics.md).
--
-- What lands now: a per-person amount override, a real link from a ledger row
-- to its calendar entry, the derived per-entry balance, and milestones
-- (deposit schedules, registration deadlines — Patrick: "common occurrences").
--
-- What deliberately does NOT land now: dropping fin_tx_signup_entry_uq (the
-- one-payment-per-entry index) and retiring payment_received. Those ship in
-- the SAME deploy as the rewritten record/void actions (Phase 3) so there is
-- never a window where the DB stops enforcing the invariant and only the old
-- app guard stands (qa-lead, 2026-08-22 — the 2026-08-18 reimbursement
-- near-miss in 20260818200000_finance_core.sql is exactly that window).
--
-- Balances are DERIVED (D-134): a view, never a stored total.

-- ── 1. per-person owed override ────────────────────────────────────────────
-- Tesomas had many tiers; BWCA was 840 vs 850; Lapham had "Expected". The
-- tier stays the default; this wins when set.
alter table public.signup_entries
  add column if not exists amount_override numeric(10,2)
    check (amount_override is null or amount_override >= 0);

-- ── 2. transactions know their event ───────────────────────────────────────
-- Patrick: "every place we want to track this will have a calendar event ID".
-- activity_label stays free text — the calendar entry IS the lookup now.
alter table public.financial_transactions
  add column if not exists calendar_entry_id bigint references public.calendar_entries(id) on delete set null;

update public.financial_transactions t
   set calendar_entry_id = es.calendar_entry_id
  from public.signup_entries se
  join public.event_signups es on es.id = se.event_signup_id
 where t.signup_entry_id = se.id and t.calendar_entry_id is null;

create index if not exists financial_transactions_calendar_entry_idx
  on public.financial_transactions (calendar_entry_id) where calendar_entry_id is not null;

-- A row that settles a sign-up entry belongs to that entry's event, always.
create or replace function public.financial_transactions_fill_event()
returns trigger
language plpgsql
as $$
begin
  if new.signup_entry_id is not null and new.calendar_entry_id is null then
    select es.calendar_entry_id into new.calendar_entry_id
      from public.signup_entries se join public.event_signups es on es.id = se.event_signup_id
     where se.id = new.signup_entry_id;
  end if;
  return new;
end;
$$;

drop trigger if exists financial_transactions_fill_event on public.financial_transactions;
create trigger financial_transactions_fill_event
  before insert or update of signup_entry_id on public.financial_transactions
  for each row execute function public.financial_transactions_fill_event();

-- ── 3. the derived balance ─────────────────────────────────────────────────
-- owed    = amount_override, else tier amount (× days when priced per day), else 0
-- paid    = Σ non-voided event_fee rows linked to the entry (refunds are
--           negative event_fee rows, so they net out here)
-- settled = something was owed and it is covered
-- security_invoker: the anon key's RLS on signup_entries applies, so the view
-- is as closed as its tables.
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
         ), 0)::numeric(10,2) as paid
    from public.signup_entries se
    left join public.event_prices p on p.id = se.price_id
)
select entry_id, event_signup_id, owed, paid,
       (owed - paid)::numeric(10,2) as balance,
       (owed > 0 and paid >= owed) as settled
  from base;

-- ── 4. milestones ──────────────────────────────────────────────────────────
-- "Deposit $300 by Jan 25 · balance by Jun 1 · council registration by Mar 1 ·
-- AHMR due". Payment milestones carry an amount; "behind" = paid < Σ amounts
-- of payment milestones due on or before today (computed in code).
create table if not exists public.event_milestones (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,
  kind text not null check (kind in ('payment', 'registration', 'form', 'other')),
  label text not null,
  due_on date not null,
  amount numeric(10,2) check (amount is null or amount > 0),
  applies_to text not null default 'both' check (applies_to in ('scouts', 'adults', 'both')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  constraint event_milestones_payment_amount check (kind <> 'payment' or amount is not null)
);
create index if not exists event_milestones_signup_idx on public.event_milestones (event_signup_id, due_on);

alter table public.event_milestones enable row level security;
