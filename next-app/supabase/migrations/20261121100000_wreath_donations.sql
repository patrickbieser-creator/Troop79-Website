-- Wreath sale W-3: "Donate to Troop 79" and the scouts' share of cash donations (Plans/Wreath-Sale.md, "Tune-up
-- feedback (2026-10-19)", W-3; Patrick, 2026-10-19).
--
--   * wreath_sales.donation_scout_share — the share of an order's cash donation (wreath_orders.gift) that goes to the
--     credited scout, after the donation's part of the card fee. Per sale, set in Admin › Wreath Sale › Settings;
--     0.15 to start. It applies to every counted order, so round 1 gifts already paid count once this ships.
--   * financial_transactions.ledger_role gains 'donation' and 'donation_refund': the donation is booked in the sale's
--     bucket as its own row (kind 'donation'), apart from the wreath payment, so reports can separate it. One live row
--     per role per order, as before (financial_transactions_wreath_order_role_live).
--   * The three card RPCs and wreath_edit_order learn the donation row. Every new key is optional, so the code that is
--     live while this lands (it sends no donation keys) books exactly as before: DB-first deploy.
--       wreath_record_card_payment  + p.donation_row (inserted when an object); p.income may now be null
--                                     (a donation-only order).
--       wreath_record_card_fee      + p.donation_amount: the fee arrived after the payment, so the live donation row
--                                     is set to its net (0 voids it); p.fee_row may be null (a donation-only order's
--                                     whole fee is the donation's). A fee already recorded on the order is a noop.
--       wreath_record_card_refund   + p.donation_refund_row; p.refund_row may be null.
--       wreath_edit_order           + p.donation_ledger (void + insert the donation row) and expect.donation_ledger_id;
--                                     p.ledger.amount 0 voids the payment row without a replacement.
--
-- Additive: DB-first deploy. Posture (D-051 / D-239): EXECUTE stays revoked from public, anon, authenticated.

alter table public.wreath_sales
  add column if not exists donation_scout_share numeric(4,3) not null default 0.150;
alter table public.wreath_sales drop constraint if exists wreath_sales_donation_scout_share_range;
alter table public.wreath_sales
  add constraint wreath_sales_donation_scout_share_range check (donation_scout_share >= 0 and donation_scout_share <= 1);

alter table public.financial_transactions drop constraint if exists financial_transactions_ledger_role_check;
alter table public.financial_transactions
  add constraint financial_transactions_ledger_role_check
  check (ledger_role in ('payment', 'fee', 'refund', 'donation', 'donation_refund'));

-- ── card payment: + the donation row ─────────────────────────────────────────────────────────────────────────────
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
    if jsonb_typeof(p->'income') = 'object' then
      insert into public.financial_transactions
        (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
      values ((p->'income'->>'occurred_on')::date, p->'income'->>'account', (p->'income'->>'amount')::numeric,
              p->'income'->>'kind', p->'income'->>'method', p->'income'->>'memo', bucket_id_for_name(coalesce(p->'income'->>'bucket', p->'income'->>'activity_label')),
              'app', v_order.id, 'payment');
    end if;
    if jsonb_typeof(p->'donation_row') = 'object' then
      insert into public.financial_transactions
        (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
      values ((p->'donation_row'->>'occurred_on')::date, p->'donation_row'->>'account', (p->'donation_row'->>'amount')::numeric,
              p->'donation_row'->>'kind', p->'donation_row'->>'method', p->'donation_row'->>'memo', bucket_id_for_name(p->'donation_row'->>'bucket'),
              'app', v_order.id, 'donation');
    end if;
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
end $fn$;

-- ── card fee, settled after the payment: + the donation's net ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wreath_record_card_fee(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  v_order public.wreath_orders%rowtype;
  r jsonb := p->'fee_row';
  v_booked boolean := false;
begin
  insert into public.stripe_events (id, type) values (p->>'event_id', p->>'event_type') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into v_order from public.wreath_orders
    where stripe_payment_intent_id = p->>'payment_intent' and paid_method = 'card' for update;
  if not found then return 'noop'; end if;
  -- With a donation on the order (donation_amount sent), a donation-only order has no fee row to collide on, so the
  -- order's own fee says whether the fee was booked already (at payment, or by an earlier event).
  if p ? 'donation_amount' and v_order.stripe_fee is not null then return 'noop'; end if;
  if jsonb_typeof(r) = 'object' then
    insert into public.financial_transactions
      (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
    values ((r->>'occurred_on')::date, r->>'account', (r->>'amount')::numeric, r->>'kind', r->>'method',
            r->>'memo', bucket_id_for_name(coalesce(r->>'bucket', r->>'activity_label')), 'app', v_order.id, 'fee')
    on conflict do nothing;
    v_booked := found;
    if not v_booked then return 'noop'; end if;
  end if;
  if p ? 'donation_amount' then
    if (p->>'donation_amount')::numeric = 0 then
      update public.financial_transactions set voided_at = now()
       where wreath_order_id = v_order.id and ledger_role = 'donation' and voided_at is null;
    else
      update public.financial_transactions set amount = (p->>'donation_amount')::numeric, updated_at = now()
       where wreath_order_id = v_order.id and ledger_role = 'donation' and voided_at is null;
    end if;
    v_booked := true;
  end if;
  if not v_booked then return 'noop'; end if;
  update public.wreath_orders set stripe_fee = (p->>'fee')::numeric where id = v_order.id;
  return 'booked';
end $fn$;

-- ── card refund: + the donation's reversal ───────────────────────────────────────────────────────────────────────
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
  d jsonb := p->'donation_refund_row';
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
          select d2.reason from public.wreath_card_refunds_due d2
          where d2.order_id = v_order.id and d2.refunded_at is null order by d2.created_at limit 1)
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
      if jsonb_typeof(r) = 'object' then
        insert into public.financial_transactions
          (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
        values ((r->>'occurred_on')::date, r->>'account', (r->>'amount')::numeric, r->>'kind', r->>'method',
                r->>'memo', bucket_id_for_name(coalesce(r->>'bucket', r->>'activity_label')), 'app', v_order.id, 'refund')
        on conflict do nothing;
      end if;
      if jsonb_typeof(d) = 'object' then
        insert into public.financial_transactions
          (occurred_on, account, amount, kind, method, memo, bucket_id, source, wreath_order_id, ledger_role)
        values ((d->>'occurred_on')::date, d->>'account', (d->>'amount')::numeric, d->>'kind', d->>'method',
                d->>'memo', bucket_id_for_name(d->>'bucket'), 'app', v_order.id, 'donation_refund')
        on conflict do nothing;
      end if;
    end if;
    v_outcome := 'refunded';
  end if;

  insert into public.audit_log (area, action, entity_type, entity_id, summary, actor_label)
  values ('wreaths', 'card_' || v_outcome, 'wreath_order', v_order.id::text,
          format('Card refund for order %s: %s', v_order.order_number, replace(v_outcome, '_', ' ')), 'Stripe');
  return v_outcome;
end $fn$;

-- ── the treasurer's order edit: + the donation row ───────────────────────────────────────────────────────────────
create or replace function public.wreath_edit_order(p jsonb)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id bigint := (p->>'order_id')::bigint;
  v_order wreath_orders%rowtype;
  v_ledger financial_transactions%rowtype;
  v_don financial_transactions%rowtype;
  v_has_live boolean;
  o jsonb := p->'order';
  e jsonb := p->'expect';
  l jsonb := p->'ledger';
  dl jsonb := p->'donation_ledger';
  v_actor bigint := nullif(coalesce(p->'ledger'->>'actor_person_id', p->'donation_ledger'->>'actor_person_id'), '')::bigint;
begin
  select * into v_order from wreath_orders where id = v_id for update;
  if not found then return 'missing'; end if;
  if v_order.status <> 'placed' then return 'cancelled'; end if;
  if v_order.payment_status <> e->>'payment_status' or v_order.total <> (e->>'total')::numeric
     or v_order.paid_amount is distinct from nullif(e->>'paid_amount', '')::numeric
     or coalesce(v_order.paid_method, '') <> coalesce(e->>'paid_method', '') then
    return 'changed';
  end if;

  select * into v_ledger from financial_transactions
   where wreath_order_id = v_id and ledger_role = 'payment' and voided_at is null
   for update;
  if coalesce(v_ledger.id, 0) <> coalesce(nullif(e->>'ledger_id', '')::bigint, 0) then return 'changed'; end if;
  if v_ledger.id is not null and v_ledger.amount <> (e->>'ledger_amount')::numeric then return 'changed'; end if;
  select * into v_don from financial_transactions
   where wreath_order_id = v_id and ledger_role = 'donation' and voided_at is null
   for update;
  if e ? 'donation_ledger_id' and coalesce(v_don.id, 0) <> coalesce(nullif(e->>'donation_ledger_id', '')::bigint, 0) then return 'changed'; end if;
  v_has_live := v_ledger.id is not null or v_don.id is not null;

  update wreath_orders set
    customer_name = o->>'customer_name',
    customer_email = nullif(o->>'customer_email', ''),
    customer_phone = nullif(o->>'customer_phone', ''),
    customer_address = nullif(o->>'customer_address', ''),
    customer_city = nullif(o->>'customer_city', ''),
    customer_zip = nullif(o->>'customer_zip', ''),
    credited_person_id = nullif(o->>'credited_person_id', '')::bigint,
    delivering_person_id = nullif(o->>'delivering_person_id', '')::bigint,
    fulfillment = o->>'fulfillment',
    items_subtotal = (o->>'items_subtotal')::numeric,
    delivery_fee = (o->>'delivery_fee')::numeric,
    fee_covered = (o->>'fee_covered')::numeric,
    gift = (o->>'gift')::numeric,
    total = (o->>'total')::numeric,
    paid_method = case when o ? 'paid_method' then o->>'paid_method' else paid_method end,
    paid_amount = case when o ? 'paid_amount' then (o->>'paid_amount')::numeric else paid_amount end
  where id = v_id;

  delete from wreath_order_lines wl
   where wl.order_id = v_id
     and not exists (
       select 1 from jsonb_array_elements(p->'lines') n
        where (n->>'item_id')::bigint = wl.item_id and coalesce((n->>'donated')::boolean, false) = wl.donated
     );
  -- A kept line changes only its quantity: its price and cost are what it was sold at.
  insert into wreath_order_lines (order_id, item_id, quantity, donated, unit_price, unit_cost)
  select v_id, (n->>'item_id')::bigint, (n->>'quantity')::integer, coalesce((n->>'donated')::boolean, false),
         (n->>'unit_price')::numeric, (n->>'unit_cost')::numeric
    from jsonb_array_elements(p->'lines') n
  on conflict (order_id, item_id, donated) do update set quantity = excluded.quantity;

  -- The ledger is rebooked only on an order whose payment is already in it (a payment or a donation row); an order
  -- paid before the ledger existed is corrected in Finance by hand, as before. New rows keep the old rows' day,
  -- account and bucket.
  if jsonb_typeof(l) = 'object' and v_has_live then
    if v_ledger.id is not null then
      update financial_transactions set voided_at = now(), voided_by_person_id = v_actor where id = v_ledger.id;
    end if;
    if (l->>'amount')::numeric <> 0 then
      insert into financial_transactions (
        occurred_on, account, amount, kind, method, memo, bucket_id, person_id, wreath_order_id, ledger_role, source,
        entered_by_person_id
      ) values (
        coalesce(v_ledger.occurred_on, v_don.occurred_on), coalesce(v_ledger.account, v_don.account), (l->>'amount')::numeric,
        coalesce(v_ledger.kind, 'fundraiser'), l->>'method', l->>'memo', coalesce(v_ledger.bucket_id, v_don.bucket_id),
        coalesce(v_ledger.person_id, v_don.person_id), v_id, 'payment', 'app', v_actor
      );
    end if;
  end if;
  if jsonb_typeof(dl) = 'object' and v_has_live then
    if v_don.id is not null then
      update financial_transactions set voided_at = now(), voided_by_person_id = v_actor where id = v_don.id;
    end if;
    if (dl->>'amount')::numeric <> 0 then
      insert into financial_transactions (
        occurred_on, account, amount, kind, method, memo, bucket_id, person_id, wreath_order_id, ledger_role, source,
        entered_by_person_id
      ) values (
        coalesce(v_don.occurred_on, v_ledger.occurred_on), coalesce(v_don.account, v_ledger.account), (dl->>'amount')::numeric,
        'donation', dl->>'method', dl->>'memo', coalesce(v_don.bucket_id, v_ledger.bucket_id),
        coalesce(v_don.person_id, v_ledger.person_id), v_id, 'donation', 'app', v_actor
      );
    end if;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.wreath_record_card_payment(jsonb) from public, anon, authenticated;
revoke all on function public.wreath_record_card_fee(jsonb) from public, anon, authenticated;
revoke all on function public.wreath_record_card_refund(jsonb) from public, anon, authenticated;
revoke all on function public.wreath_edit_order(jsonb) from public, anon, authenticated;
