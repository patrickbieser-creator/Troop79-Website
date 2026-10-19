-- Wreath sale: the treasurer's full order edit (Patrick, 2026-10-18 — a customer ordered the wrong item, then paid by
-- Venmo for a different one). One function applies an edit the admin action has already validated and priced:
-- the order's fields, its lines (diffed by item + donated, so a kept line keeps its id and its price snapshot), and,
-- when the payment itself is corrected, the ledger rebook (void the live payment row, insert the corrected one on the
-- same day). All in one transaction, guarded by what the caller saw: status, payment status, total, and the live
-- payment row's id and amount. No pricing in here — lib/wreaths/rules.ts is the only place a price is decided.
--
-- Additive: DB-first deploy (the code that calls it ships after this lands).
-- Posture (D-051 / D-239): EXECUTE revoked from public, anon, authenticated — only the service role calls it.

create or replace function public.wreath_edit_order(p jsonb)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id bigint := (p->>'order_id')::bigint;
  v_order wreath_orders%rowtype;
  v_ledger financial_transactions%rowtype;
  o jsonb := p->'order';
  e jsonb := p->'expect';
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

  delete from wreath_order_lines l
   where l.order_id = v_id
     and not exists (
       select 1 from jsonb_array_elements(p->'lines') n
        where (n->>'item_id')::bigint = l.item_id and coalesce((n->>'donated')::boolean, false) = l.donated
     );
  -- A kept line changes only its quantity: its price and cost are what it was sold at.
  insert into wreath_order_lines (order_id, item_id, quantity, donated, unit_price, unit_cost)
  select v_id, (n->>'item_id')::bigint, (n->>'quantity')::integer, coalesce((n->>'donated')::boolean, false),
         (n->>'unit_price')::numeric, (n->>'unit_cost')::numeric
    from jsonb_array_elements(p->'lines') n
  on conflict (order_id, item_id, donated) do update set quantity = excluded.quantity;

  if p->'ledger' is not null and jsonb_typeof(p->'ledger') = 'object' and v_ledger.id is not null then
    update financial_transactions
       set voided_at = now(), voided_by_person_id = nullif(p->'ledger'->>'actor_person_id', '')::bigint
     where id = v_ledger.id;
    insert into financial_transactions (
      occurred_on, account, amount, kind, method, memo, bucket_id, person_id, wreath_order_id, ledger_role, source,
      entered_by_person_id
    ) values (
      v_ledger.occurred_on, v_ledger.account, (p->'ledger'->>'amount')::numeric, v_ledger.kind, p->'ledger'->>'method',
      p->'ledger'->>'memo', v_ledger.bucket_id, v_ledger.person_id, v_id, 'payment', 'app',
      nullif(p->'ledger'->>'actor_person_id', '')::bigint
    );
  end if;

  return 'ok';
end;
$$;

revoke all on function public.wreath_edit_order(jsonb) from public, anon, authenticated;
