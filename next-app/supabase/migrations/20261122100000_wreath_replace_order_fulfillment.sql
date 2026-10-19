-- Wreath sale: a scout-entered order can be a donation with no wreath (Patrick, 2026-10-19, Lily P's page: a $100
-- donation was refused as an empty order). Such an order has nothing to deliver (fulfillment 'none', no delivering
-- scout); adding a wreath to it later makes the scout deliver again, and dropping every wreath makes it a donation.
--
-- wreath_replace_order (the family's edit, lib/wreaths/scout-entry.ts editScoutOrder) learns two OPTIONAL keys,
-- p.fulfillment ('scout' | 'none') and p.delivering_person_id. Without them it behaves exactly as before, so the
-- code live while this lands is unaffected: DB-first deploy. The body is 20261103100000's plus those two lines.
-- Posture (D-051 / D-239): EXECUTE stays revoked from public, anon, authenticated.

create or replace function public.wreath_replace_order(p jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_id bigint := (p->>'order_id')::bigint;
begin
  perform 1 from wreath_orders o
   where o.id = v_id and o.source = 'paper' and o.status = 'placed' and o.payment_status = 'unpaid'
     and o.credited_person_id = (p->>'credited_person_id')::bigint
   for update;
  if not found then
    return false;
  end if;

  update wreath_orders set
    customer_name = p->>'customer_name',
    customer_email = nullif(p->>'customer_email', ''),
    customer_phone = nullif(p->>'customer_phone', ''),
    customer_note = nullif(p->>'customer_note', ''),
    collected_by_scout = coalesce((p->>'collected_by_scout')::boolean, false),
    payment_note = nullif(p->>'payment_note', ''),
    items_subtotal = (p->>'items_subtotal')::numeric,
    gift = (p->>'gift')::numeric,
    total = (p->>'total')::numeric,
    fulfillment = case when p ? 'fulfillment' then p->>'fulfillment' else fulfillment end,
    delivering_person_id = case when p ? 'fulfillment' then nullif(p->>'delivering_person_id', '')::bigint else delivering_person_id end
  where id = v_id;

  delete from wreath_order_lines where order_id = v_id;
  insert into wreath_order_lines (order_id, item_id, quantity, donated, unit_price, unit_cost)
  select v_id, (l->>'item_id')::bigint, (l->>'quantity')::integer, coalesce((l->>'donated')::boolean, false),
         (l->>'unit_price')::numeric, (l->>'unit_cost')::numeric
    from jsonb_array_elements(p->'lines') l;
  return true;
end;
$$;
revoke all on function public.wreath_replace_order(jsonb) from public, anon, authenticated;
