-- Event sign-up payment options (Patrick, 2026-11-13).
--
-- 1. Troop-wide "how to pay" details in site_settings (pay.*), so every event's sign-up lists the same options
--    instead of one typed sentence per event. The old boilerplate sentences are cleared; the per-event field stays
--    as an optional extra note.
-- 2. signup_entries.pay_method / pay_from_person_id: how the family said they will pay. A REQUEST only: nothing
--    moves until the treasurer records the payment (scout account included) or Stripe confirms a card payment.
-- 3. event_card_payments: one row per Stripe Checkout Session started from a sign-up, and three functions the
--    webhook calls. Each books its ledger rows and its stripe_events row in one transaction (same contract as the
--    wreath functions, 20261105100000).
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): RLS on with no policies, nothing granted to anon or
-- authenticated; functions are service-role only.

-- ── 1. Troop-wide pay-to details ─────────────────────────────────────────────────────────────────────────────────
insert into public.site_settings (key, value, updated_by) values
  ('pay.venmo_handle', '@Patrick-Bieser-1', 'migration'),
  ('pay.venmo_hint', 'last 4 of phone 6423', 'migration'),
  ('pay.paypal_email', 'patrickbieser@gmail.com', 'migration'),
  ('pay.check_payable_to', 'Troop 79', 'migration'),
  ('pay.check_mail_to', 'Patrick Bieser / Troop 79, 1572 E Capitol, Shorewood WI, 53211', 'migration')
on conflict (key) do nothing;

update public.event_signups set payment_instructions = null
 where payment_instructions ilike 'Venmo @Patrick-Bieser-1%';

-- ── 2. The family's chosen way to pay ────────────────────────────────────────────────────────────────────────────
alter table public.signup_entries
  add column if not exists pay_method text,
  add column if not exists pay_from_person_id bigint references public.people(id) on delete set null;
alter table public.signup_entries drop constraint if exists signup_entries_pay_method_check;
alter table public.signup_entries add constraint signup_entries_pay_method_check
  check (pay_method is null or pay_method in ('venmo', 'paypal', 'check', 'cash', 'scout_account', 'card'));

-- ── 3. Card payments ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.event_card_payments (
  id bigint generated always as identity primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete restrict,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete restrict,
  household_key text not null check (length(household_key) between 1 and 80),
  started_by_person_id bigint references public.people(id) on delete set null,
  -- What this payment covers, fixed when the session was made: [{entry_id, person_id, cents}].
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  due_cents bigint not null check (due_cents > 0),
  fee_cents bigint not null check (fee_cents >= 0),
  total_cents bigint not null,
  status text not null default 'open' check (status in ('open', 'expired', 'paid', 'refunded', 'flagged')),
  flag_reason text check (flag_reason is null or length(flag_reason) <= 200),
  stripe_session_id text,
  stripe_payment_intent_id text,
  stripe_fee numeric(10,2) check (stripe_fee is null or stripe_fee >= 0),
  ip text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  constraint event_card_payments_total check (total_cents = due_cents + fee_cents),
  constraint created_at_from_1900 check (created_at >= '1900-01-01'),
  constraint paid_at_from_1900 check (paid_at >= '1900-01-01'),
  constraint refunded_at_from_1900 check (refunded_at >= '1900-01-01')
);
create unique index if not exists event_card_payments_intent_key
  on public.event_card_payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists event_card_payments_party_idx on public.event_card_payments (event_signup_id, household_key);
-- A party has at most ONE payable session: two starts at once (a double click, two tabs) cannot both insert.
create unique index if not exists event_card_payments_one_open_per_party
  on public.event_card_payments (event_signup_id, household_key) where status = 'open';
create index if not exists event_card_payments_recent_idx on public.event_card_payments (created_at);
create index if not exists event_card_payments_session_idx on public.event_card_payments (stripe_session_id);
alter table public.event_card_payments enable row level security;
revoke all on public.event_card_payments from anon, authenticated;

alter table public.financial_transactions
  add column if not exists event_card_payment_id bigint references public.event_card_payments(id) on delete restrict;

-- 'fee_cover' = the card fee the family paid on top; 'fee_cover_refund' = that part of a full refund.
alter table public.financial_transactions drop constraint if exists financial_transactions_ledger_role_check;
alter table public.financial_transactions add constraint financial_transactions_ledger_role_check
  check (ledger_role in ('payment', 'fee', 'refund', 'donation', 'donation_refund', 'fee_cover', 'fee_cover_refund'));

-- One live row per role per covered entry per card payment: a replayed webhook can't book twice.
create unique index if not exists financial_transactions_event_card_role_live
  on public.financial_transactions (event_card_payment_id, ledger_role, coalesce(signup_entry_id, 0))
  where event_card_payment_id is not null and voided_at is null;

-- ── Record a card payment (checkout.session.completed / async_payment_succeeded) ─────────────────────────────────
-- p: event_id, event_type, payment_id, payment_intent, amount_cents, currency, fee (dollars or null), occurred_on.
-- Returns 'duplicate' | 'paid' | 'already_paid' | 'already_flagged' | 'flagged_mismatch' | 'unknown_payment'.
create or replace function public.event_record_card_payment(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.event_card_payments%rowtype;
  v_pi text := p->>'payment_intent';
  v_cents bigint := (p->>'amount_cents')::bigint;
  v_day date := (p->>'occurred_on')::date;
  v_bucket bigint;
  v_title text;
  v_fee numeric := nullif(p->>'fee', '')::numeric;
  l jsonb;
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;

  select * into v_pay from public.event_card_payments where id = (p->>'payment_id')::bigint for update;
  if not found then return 'unknown_payment'; end if;
  select title into v_title from public.calendar_entries where id = v_pay.calendar_entry_id;

  if v_pay.status = 'paid' then return 'already_paid'; end if;
  if v_pay.status in ('flagged', 'refunded') then return 'already_flagged'; end if;

  if (p->>'currency') <> 'usd' or v_cents <> v_pay.total_cents then
    update public.event_card_payments
       set status = 'flagged', stripe_payment_intent_id = v_pi, stripe_session_id = null,
           flag_reason = format('Card paid %s but %s was due. Refund it in Stripe.',
             to_char(v_cents::numeric / 100, 'FM$999990.00'), to_char(v_pay.total_cents::numeric / 100, 'FM$999990.00'))
     where id = v_pay.id;
    insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
    values ('calendar', 'card_flagged_mismatch', 'event_card_payment', v_pay.id::text,
            format('Card payment for %s: wrong amount, needs a refund', coalesce(v_title, 'an event')), 'Stripe');
    return 'flagged_mismatch';
  end if;

  -- An 'expired' row still books: the money arrived.
  v_bucket := public.event_bucket(v_pay.calendar_entry_id);
  for l in select * from jsonb_array_elements(v_pay.lines) loop
    insert into public.financial_transactions
      (occurred_on, account, amount, kind, method, memo, person_id, signup_entry_id, calendar_entry_id, bucket_id,
       source, ledger_role, event_card_payment_id)
    values (v_day, 'checking', ((l->>'cents')::bigint)::numeric / 100, 'event_fee', 'card', 'Paid by card',
            (select se.person_id from public.signup_entries se where se.id = (l->>'entry_id')::bigint),
            (select se.id from public.signup_entries se where se.id = (l->>'entry_id')::bigint),
            v_pay.calendar_entry_id, v_bucket, 'app', 'payment', v_pay.id);
  end loop;
  if v_pay.fee_cents > 0 then
    insert into public.financial_transactions
      (occurred_on, account, amount, kind, method, memo, calendar_entry_id, bucket_id, source, ledger_role, event_card_payment_id)
    values (v_day, 'checking', v_pay.fee_cents::numeric / 100, 'event_fee', 'card', 'Card fee paid by the family',
            v_pay.calendar_entry_id, v_bucket, 'app', 'fee_cover', v_pay.id);
  end if;
  if v_fee is not null and v_fee > 0 then
    insert into public.financial_transactions
      (occurred_on, account, amount, kind, method, memo, calendar_entry_id, bucket_id, source, ledger_role, event_card_payment_id)
    values (v_day, 'checking', -v_fee, 'expense', 'card', 'Stripe fee · ' || coalesce(v_title, 'event sign-up'),
            v_pay.calendar_entry_id, v_bucket, 'app', 'fee', v_pay.id);
  end if;
  update public.event_card_payments
     set status = 'paid', paid_at = now(), stripe_payment_intent_id = v_pi, stripe_fee = v_fee, stripe_session_id = null
   where id = v_pay.id;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('calendar', 'card_paid', 'event_card_payment', v_pay.id::text,
          format('Card payment for %s: %s', coalesce(v_title, 'an event'), to_char(v_cents::numeric / 100, 'FM$999990.00')), 'Stripe');
  return 'paid';
end $$;
revoke all on function public.event_record_card_payment(jsonb) from public, anon, authenticated;

-- ── Book a late Stripe fee (charge.updated once the balance transaction exists) ──────────────────────────────────
-- p: event_id, event_type, payment_intent, fee (dollars), occurred_on. Returns 'duplicate' | 'booked' | 'noop'.
create or replace function public.event_record_card_fee(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.event_card_payments%rowtype;
  v_fee numeric := (p->>'fee')::numeric;
  v_title text;
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into v_pay from public.event_card_payments
   where stripe_payment_intent_id = p->>'payment_intent' and status = 'paid' for update;
  if not found or v_pay.stripe_fee is not null or v_fee is null or v_fee <= 0 then return 'noop'; end if;
  select title into v_title from public.calendar_entries where id = v_pay.calendar_entry_id;
  insert into public.financial_transactions
    (occurred_on, account, amount, kind, method, memo, calendar_entry_id, bucket_id, source, ledger_role, event_card_payment_id)
  values ((p->>'occurred_on')::date, 'checking', -v_fee, 'expense', 'card', 'Stripe fee · ' || coalesce(v_title, 'event sign-up'),
          v_pay.calendar_entry_id, public.event_bucket(v_pay.calendar_entry_id), 'app', 'fee', v_pay.id)
  on conflict do nothing;
  update public.event_card_payments set stripe_fee = v_fee where id = v_pay.id;
  return 'booked';
end $$;
revoke all on function public.event_record_card_fee(jsonb) from public, anon, authenticated;

-- ── Record a refund (charge.refunded) ────────────────────────────────────────────────────────────────────────────
-- p: event_id, event_type, payment_intent, amount_refunded_cents, occurred_on.
-- A FULL refund reverses every live row the payment booked except Stripe's fee (Stripe keeps it). A partial refund
-- is audited and books nothing: the treasurer records it on the event's Money tab.
-- Returns 'duplicate' | 'refunded' | 'flag_refunded' | 'partial' | 'already_refunded' | 'unknown_intent'.
create or replace function public.event_record_card_refund(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.event_card_payments%rowtype;
  v_outcome text;
  v_title text;
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into v_pay from public.event_card_payments where stripe_payment_intent_id = p->>'payment_intent' for update;
  if not found then return 'unknown_intent'; end if;
  select title into v_title from public.calendar_entries where id = v_pay.calendar_entry_id;

  if v_pay.status = 'refunded' then
    return 'already_refunded';
  elsif (p->>'amount_refunded_cents')::bigint < v_pay.total_cents then
    v_outcome := 'partial';
  elsif v_pay.status = 'flagged' then
    update public.event_card_payments set status = 'refunded', refunded_at = now() where id = v_pay.id;
    v_outcome := 'flag_refunded';
  else
    insert into public.financial_transactions
      (occurred_on, account, amount, kind, method, memo, person_id, signup_entry_id, calendar_entry_id, bucket_id,
       source, ledger_role, event_card_payment_id)
    select (p->>'occurred_on')::date, ft.account, -ft.amount, ft.kind, ft.method, 'Refund · ' || coalesce(ft.memo, 'card payment'),
           ft.person_id, ft.signup_entry_id, ft.calendar_entry_id, ft.bucket_id, 'app',
           case ft.ledger_role when 'payment' then 'refund' else 'fee_cover_refund' end, v_pay.id
      from public.financial_transactions ft
     where ft.event_card_payment_id = v_pay.id and ft.voided_at is null and ft.ledger_role in ('payment', 'fee_cover')
    on conflict do nothing;
    update public.event_card_payments set status = 'refunded', refunded_at = now() where id = v_pay.id;
    v_outcome := 'refunded';
  end if;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('calendar', 'card_' || v_outcome, 'event_card_payment', v_pay.id::text,
          format('Card refund for %s: %s', coalesce(v_title, 'an event'), replace(v_outcome, '_', ' ')), 'Stripe');
  return v_outcome;
end $$;
revoke all on function public.event_record_card_refund(jsonb) from public, anon, authenticated;
