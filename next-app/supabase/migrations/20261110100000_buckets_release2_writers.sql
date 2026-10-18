-- Buckets Release 2, migration A (additive, DB-first — Plans/Buckets-Lookup.md, Patrick 2026-10-18).
--
-- Writers move from activity_label text to bucket_id before the label column is dropped (migration B, after the
-- code that stops reading and writing the label is live):
--   * bucket_id_for_name(name) — the bucket a name means (bucket_key match), created when new. The one place a
--     bucket is made from text: wreath ledger rows ("Wreaths '26"), the import scripts.
--   * event_bucket(calendar_entry_id) — the event's bucket; when it has none, the bucket named for its title is
--     found or created and the event is linked to it. What the sync trigger did for a sign-up fee row labelled with
--     the event title, as an explicit call the fee / refund / credit / expense actions make.
--   * The three wreath card RPCs write bucket_id, from a row's `bucket` name or (until the code ships) its old
--     `activity_label` key, so a card payment books correctly before, during and after the code deploy.

create or replace function public.bucket_id_for_name(p_name text)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id bigint;
begin
  if v_name = '' then return null; end if;
  select b.id into v_id from buckets b where bucket_key(b.name) = bucket_key(v_name);
  if v_id is null then
    insert into buckets (name) values (v_name)
      on conflict (bucket_key(name)) do nothing
      returning id into v_id;
    if v_id is null then
      select b.id into v_id from buckets b where bucket_key(b.name) = bucket_key(v_name);
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.event_bucket(p_calendar_entry_id bigint)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_bucket bigint;
  v_title text;
begin
  select c.bucket_id, c.title into v_bucket, v_title from calendar_entries c where c.id = p_calendar_entry_id for update;
  if not found then return null; end if;
  if v_bucket is null then
    v_bucket := bucket_id_for_name(v_title);
    update calendar_entries set bucket_id = v_bucket where id = p_calendar_entry_id and bucket_id is null;
  end if;
  return v_bucket;
end $$;

revoke all on function public.bucket_id_for_name(text) from public, anon, authenticated;
revoke all on function public.event_bucket(bigint) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wreath_record_card_payment(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
      (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
    values ((p->'income'->>'occurred_on')::date, p->'income'->>'account', (p->'income'->>'amount')::numeric,
            p->'income'->>'kind', p->'income'->>'method', p->'income'->>'memo', bucket_id_for_name(coalesce(p->'income'->>'bucket', p->'income'->>'activity_label')),
            'app', v_order.id, 'payment');
    if jsonb_typeof(p->'fee_row') = 'object' then
      insert into public.financial_transactions
        (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
      values ((p->'fee_row'->>'occurred_on')::date, p->'fee_row'->>'account', (p->'fee_row'->>'amount')::numeric,
              p->'fee_row'->>'kind', p->'fee_row'->>'method', p->'fee_row'->>'memo', bucket_id_for_name(coalesce(p->'fee_row'->>'bucket', p->'fee_row'->>'activity_label')),
              'app', v_order.id, 'fee');
    end if;
    v_outcome := 'paid';
  end if;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('wreaths', 'card_' || v_outcome, 'wreath_order', v_order.id::text,
          format('Card payment for order %s: %s', v_order.order_number, replace(v_outcome, '_', ' ')), 'Stripe');
  return v_outcome;
end $fn$

;

CREATE OR REPLACE FUNCTION public.wreath_record_card_fee(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
    (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
  values ((r->>'occurred_on')::date, r->>'account', (r->>'amount')::numeric, r->>'kind', r->>'method',
          r->>'memo', bucket_id_for_name(coalesce(r->>'bucket', r->>'activity_label')), 'app', v_order.id, 'fee')
  on conflict do nothing;
  if not found then return 'noop'; end if;
  update public.wreath_orders set stripe_fee = (p->>'fee')::numeric where id = v_order.id;
  return 'booked';
end $fn$

;

CREATE OR REPLACE FUNCTION public.wreath_record_card_refund(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
        (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
      values ((r->>'occurred_on')::date, r->>'account', (r->>'amount')::numeric, r->>'kind', r->>'method',
              r->>'memo', bucket_id_for_name(coalesce(r->>'bucket', r->>'activity_label')), 'app', v_order.id, 'refund')
      on conflict do nothing;
    end if;
    v_outcome := 'refunded';
  end if;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('wreaths', 'card_' || v_outcome, 'wreath_order', v_order.id::text,
          format('Card refund for order %s: %s', v_order.order_number, replace(v_outcome, '_', ' ')), 'Stripe');
  return v_outcome;
end $fn$

;

