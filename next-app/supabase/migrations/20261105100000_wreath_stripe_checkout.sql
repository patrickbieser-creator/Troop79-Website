-- Wreath sale Release B: card payments through Stripe Checkout (Plans/Wreath-Stripe-Checkout.md, 2026-10-15).
--
-- Additive + a widened CHECK: DB-first deploy (the code that uses these ships after this lands).
-- Posture (D-051 / D-239): RLS on with no policies; function EXECUTE revoked from public, anon, authenticated —
-- only the service role (the webhook route and admin actions) calls them.

-- ── Orders ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.wreath_orders
  add column if not exists stripe_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_fee numeric(10,2) check (stripe_fee is null or stripe_fee >= 0),
  add column if not exists refunded_at timestamptz,
  -- Checkout Sessions created for this order: part of the idempotency key (a re-created session gets a fresh key)
  -- and the per-order cap on the public, token-keyed start action.
  add column if not exists stripe_checkout_count integer not null default 0 check (stripe_checkout_count >= 0),
  -- Set when a card payment landed where it shouldn't (cancelled order, already paid another way, wrong amount):
  -- the reason, shown to the treasurer beside the refund button. Null = nothing to do.
  add column if not exists needs_refund text check (needs_refund is null or length(needs_refund) <= 200);

create unique index if not exists wreath_orders_stripe_payment_intent_key
  on public.wreath_orders (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

alter table public.wreath_orders drop constraint if exists wreath_orders_paid_method_check;
alter table public.wreath_orders add constraint wreath_orders_paid_method_check
  check (paid_method is null or paid_method in ('venmo', 'paypal', 'cash', 'check', 'other', 'card'));

-- ── Finance ledger ─────────────────────────────────────────────────────────────────────────────────────────────
-- 'card' kept in lockstep with lib/finance.ts TRANSACTION_METHODS.
alter table public.financial_transactions drop constraint if exists financial_transactions_method_check;
alter table public.financial_transactions add constraint financial_transactions_method_check
  check (method in ('venmo', 'paypal', 'check', 'cash', 'scout_account', 'bank', 'other', 'card'));

-- A wreath order can carry up to three live ledger rows: the payment, the card fee, and a full refund.
alter table public.financial_transactions
  add column if not exists ledger_role text not null default 'payment'
    check (ledger_role in ('payment', 'fee', 'refund'));

drop index if exists public.financial_transactions_wreath_order_live;
create unique index if not exists financial_transactions_wreath_order_role_live
  on public.financial_transactions (wreath_order_id, ledger_role)
  where wreath_order_id is not null and voided_at is null;

-- ── Card payments to return (qa-lead, 2026-10-15) ──────────────────────────────────────────────────────────────
-- One row per card payment that landed where it shouldn't: on a cancelled order, on an order already paid (another
-- way, or by a different card payment), or for the wrong amount. The order's OWN PaymentIntent is never here, so the
-- refund button returns exactly these and never the payment the order stands on. wreath_orders.needs_refund carries
-- the reason while any row is open.
create table if not exists public.wreath_card_refunds_due (
  payment_intent text primary key,
  order_id bigint not null references public.wreath_orders(id) on delete restrict,
  reason text not null check (length(reason) <= 200),
  amount_cents bigint not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);
create index if not exists wreath_card_refunds_due_order_idx on public.wreath_card_refunds_due (order_id);
alter table public.wreath_card_refunds_due enable row level security;
revoke all on public.wreath_card_refunds_due from anon, authenticated;

-- ── Start-checkout rate limits ─────────────────────────────────────────────────────────────────────────────────
-- One row per Checkout Session the public, token-keyed start action creates: counted per IP and globally per hour.
create table if not exists public.wreath_checkout_starts (
  id bigserial primary key,
  order_id bigint not null references public.wreath_orders(id) on delete cascade,
  ip text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists wreath_checkout_starts_recent_idx on public.wreath_checkout_starts (created_at);
alter table public.wreath_checkout_starts enable row level security;
revoke all on public.wreath_checkout_starts from anon, authenticated;
revoke all on sequence public.wreath_checkout_starts_id_seq from anon, authenticated;

-- ── Webhook dedupe ─────────────────────────────────────────────────────────────────────────────────────────────
-- Written in the SAME transaction as the work an event does, so a failed handler leaves no row and Stripe's retry
-- is processed. A row here means "this event's effect is in the database".
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ── Record a card payment (checkout.session.completed / async_payment_succeeded) ───────────────────────────────
-- p: event_id, event_type, order_id, payment_intent, amount_cents, currency, fee (dollars or null),
--    income (jsonb ledger row), fee_row (jsonb ledger row or null).
-- Returns one of: 'duplicate' | 'paid' | 'already_paid' | 'already_flagged' | 'flagged_cancelled' |
--                 'flagged_paid_otherwise' | 'flagged_mismatch' | 'unknown_order'.
create or replace function public.wreath_record_card_payment(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_order public.wreath_orders%rowtype;
  v_pi text := p->>'payment_intent';
  v_cents bigint := (p->>'amount_cents')::bigint;
  v_outcome text;
  v_reason text;
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;

  select * into v_order from public.wreath_orders where id = (p->>'order_id')::bigint for update;
  if not found then return 'unknown_order'; end if;

  if v_order.payment_status = 'paid' and v_order.stripe_payment_intent_id = v_pi then
    return 'already_paid';
  elsif exists (select 1 from public.wreath_card_refunds_due where payment_intent = v_pi) then
    return 'already_flagged';
  elsif v_order.status = 'cancelled' then
    v_outcome := 'flagged_cancelled';
    v_reason := 'Card payment arrived after the order was cancelled.';
  elsif v_order.payment_status <> 'unpaid' then
    v_outcome := 'flagged_paid_otherwise';
    v_reason := 'Card payment arrived for an order already marked paid.';
  elsif (p->>'currency') <> 'usd' or v_cents <> round(v_order.total * 100)::bigint then
    v_outcome := 'flagged_mismatch';
    v_reason := format('Card paid %s but the order total is $%s.',
      to_char(v_cents::numeric / 100, 'FM$999990.00'), to_char(v_order.total, 'FM999990.00'));
  end if;

  if v_reason is not null then
    -- The stray payment is queued for return; the order's own payment and state are untouched.
    insert into public.wreath_card_refunds_due (payment_intent, order_id, reason, amount_cents)
    values (v_pi, v_order.id, v_reason, v_cents);
    update public.wreath_orders set needs_refund = v_reason where id = v_order.id;
  else
    update public.wreath_orders set payment_status = 'paid', paid_method = 'card', paid_at = now(),
      paid_by_person_id = null, paid_amount = total, collected_by_scout = false,
      stripe_payment_intent_id = v_pi, stripe_fee = (p->>'fee')::numeric, stripe_session_id = null
      where id = v_order.id;
    insert into public.financial_transactions
      (occurred_on, account, amount, kind, method, memo, activity_label, source, wreath_order_id, ledger_role)
    values ((p->'income'->>'occurred_on')::date, p->'income'->>'account', (p->'income'->>'amount')::numeric,
            p->'income'->>'kind', p->'income'->>'method', p->'income'->>'memo', p->'income'->>'activity_label',
            'app', v_order.id, 'payment');
    if jsonb_typeof(p->'fee_row') = 'object' then
      insert into public.financial_transactions
        (occurred_on, account, amount, kind, method, memo, activity_label, source, wreath_order_id, ledger_role)
      values ((p->'fee_row'->>'occurred_on')::date, p->'fee_row'->>'account', (p->'fee_row'->>'amount')::numeric,
              p->'fee_row'->>'kind', p->'fee_row'->>'method', p->'fee_row'->>'memo', p->'fee_row'->>'activity_label',
              'app', v_order.id, 'fee');
    end if;
    v_outcome := 'paid';
  end if;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('wreaths', 'card_' || v_outcome, 'wreath_order', v_order.id::text,
          format('Card payment for order %s: %s', v_order.order_number, replace(v_outcome, '_', ' ')), 'Stripe');
  return v_outcome;
end $$;
revoke all on function public.wreath_record_card_payment(jsonb) from public, anon, authenticated;

-- ── Book a late card fee (charge.updated once the balance transaction exists) ──────────────────────────────────
-- p: event_id, event_type, payment_intent, fee (dollars), fee_row (jsonb). Returns 'duplicate' | 'booked' | 'noop'.
create or replace function public.wreath_record_card_fee(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_order public.wreath_orders%rowtype;
  r jsonb := p->'fee_row';
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into v_order from public.wreath_orders
    where stripe_payment_intent_id = p->>'payment_intent' and paid_method = 'card' for update;
  if not found then return 'noop'; end if;
  insert into public.financial_transactions
    (occurred_on, account, amount, kind, method, memo, activity_label, source, wreath_order_id, ledger_role)
  values ((r->>'occurred_on')::date, r->>'account', (r->>'amount')::numeric, r->>'kind', r->>'method',
          r->>'memo', r->>'activity_label', 'app', v_order.id, 'fee')
  on conflict do nothing;
  if not found then return 'noop'; end if;
  update public.wreath_orders set stripe_fee = (p->>'fee')::numeric where id = v_order.id;
  return 'booked';
end $$;
revoke all on function public.wreath_record_card_fee(jsonb) from public, anon, authenticated;

-- ── Record a refund (charge.refunded) ──────────────────────────────────────────────────────────────────────────
-- p: event_id, event_type, payment_intent, amount_refunded_cents, refund_row (jsonb).
-- A stray payment (wreath_card_refunds_due) returned in full only closes its row — and clears the order's flag when no
-- other stray payment is open. The order's own card payment refunded in FULL marks the order refunded + cancelled and
-- books the reversal; any partial refund is audited and books nothing.
-- Returns 'duplicate' | 'flag_refunded' | 'refunded' | 'partial' | 'already_refunded' | 'unknown_intent'.
create or replace function public.wreath_record_card_refund(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_order public.wreath_orders%rowtype;
  v_due public.wreath_card_refunds_due%rowtype;
  r jsonb := p->'refund_row';
  v_outcome text;
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;

  select * into v_due from public.wreath_card_refunds_due where payment_intent = p->>'payment_intent' for update;
  if found then
    select * into v_order from public.wreath_orders where id = v_due.order_id for update;
    if (p->>'amount_refunded_cents')::bigint < v_due.amount_cents then
      v_outcome := 'partial';
    else
      update public.wreath_card_refunds_due set refunded_at = coalesce(refunded_at, now()) where payment_intent = v_due.payment_intent;
      update public.wreath_orders set needs_refund = (
          select d.reason from public.wreath_card_refunds_due d
          where d.order_id = v_order.id and d.refunded_at is null order by d.created_at limit 1)
        where id = v_order.id;
      v_outcome := 'flag_refunded';
    end if;
    insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
    values ('wreaths', 'card_' || v_outcome, 'wreath_order', v_order.id::text,
            format('Stray card payment for order %s: %s', v_order.order_number, replace(v_outcome, '_', ' ')), 'Stripe');
    return v_outcome;
  end if;

  select * into v_order from public.wreath_orders where stripe_payment_intent_id = p->>'payment_intent' for update;
  if not found then return 'unknown_intent'; end if;

  if v_order.payment_status = 'refunded' then
    v_outcome := 'already_refunded';
  elsif (p->>'amount_refunded_cents')::bigint < round(coalesce(v_order.paid_amount, v_order.total) * 100)::bigint then
    v_outcome := 'partial';
  else
    update public.wreath_orders set payment_status = 'refunded', refunded_at = now(), status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()) where id = v_order.id;
    if v_order.payment_status = 'paid' then
      insert into public.financial_transactions
        (occurred_on, account, amount, kind, method, memo, activity_label, source, wreath_order_id, ledger_role)
      values ((r->>'occurred_on')::date, r->>'account', (r->>'amount')::numeric, r->>'kind', r->>'method',
              r->>'memo', r->>'activity_label', 'app', v_order.id, 'refund')
      on conflict do nothing;
    end if;
    v_outcome := 'refunded';
  end if;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('wreaths', 'card_' || v_outcome, 'wreath_order', v_order.id::text,
          format('Card refund for order %s: %s', v_order.order_number, replace(v_outcome, '_', ' ')), 'Stripe');
  return v_outcome;
end $$;
revoke all on function public.wreath_record_card_refund(jsonb) from public, anon, authenticated;
