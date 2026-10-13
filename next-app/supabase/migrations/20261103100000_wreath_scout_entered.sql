-- Wreath sale: scout-entered orders ("Order for someone I know", Plans/Wreath-Scout-Entered-Orders.md). Patrick, 2026-10-13.
--
-- A scout, or a parent of the scout, enters an order for a customer they know and collects the money themselves.
-- The order is source = 'paper', fulfillment = 'scout', credited to and delivered by that scout. Additive only:
--
--   collected_by_scout    the scout says they have the customer's money. The treasurer still marks the order
--                         Paid when the troop has it (and Paid sets this too).
--   payment_note          free text from the scout or the treasurer ("Venmo'd Patrick 10/20"). Max 200.
--   entered_by_person_id  who typed the order in (the scout or the parent). Null on every online order.
--   customer_note         the optional "Note" on the entry form ("leave on the porch"). Max 300. Not in the plan's
--                         column list; the form needs somewhere to put it.
--
-- wreath_place_order learns the four columns (create or replace; same signature, same idempotency). The new
-- wreath_replace_order is the ONE write path for editing a scout-entered order: header and lines change in one
-- transaction, and the update refuses unless the order is still source 'paper', placed, UNPAID and credited to the
-- scout the caller named, so a treasurer marking it Paid at the same moment wins and the edit is refused.
--
-- Posture (D-051 / D-239): RLS stays on with no policies; function EXECUTE revoked from public, anon, authenticated.
-- DEPLOY ORDER: DB-first (additive columns + a replaced function whose old callers still work).

alter table public.wreath_orders
  add column if not exists collected_by_scout boolean not null default false,
  add column if not exists payment_note text,
  add column if not exists entered_by_person_id bigint references public.people(id),
  add column if not exists customer_note text;

alter table public.wreath_orders drop constraint if exists wreath_orders_payment_note_len;
alter table public.wreath_orders
  add constraint wreath_orders_payment_note_len check (payment_note is null or length(payment_note) <= 200);
alter table public.wreath_orders drop constraint if exists wreath_orders_customer_note_len;
alter table public.wreath_orders
  add constraint wreath_orders_customer_note_len check (customer_note is null or length(customer_note) <= 300);

create index if not exists wreath_orders_entered_by_idx on public.wreath_orders (entered_by_person_id) where entered_by_person_id is not null;

create or replace function public.wreath_place_order(p jsonb)
returns table (order_id bigint, order_number text, public_token uuid, created boolean)
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  v_number text;
  v_token uuid;
begin
  insert into wreath_orders (
    sale_id, idempotency_key, credited_person_id, delivering_person_id, source, fulfillment, round,
    customer_name, customer_email, customer_phone, customer_address, customer_city, customer_zip,
    outside_area_relative, items_subtotal, delivery_fee, fee_covered, gift, total, created_ip, placed_at,
    collected_by_scout, payment_note, entered_by_person_id, customer_note
  ) values (
    (p->>'sale_id')::bigint, p->>'idempotency_key', nullif(p->>'credited_person_id', '')::bigint,
    nullif(p->>'delivering_person_id', '')::bigint, p->>'source', p->>'fulfillment', (p->>'round')::smallint,
    p->>'customer_name', nullif(p->>'customer_email', ''), nullif(p->>'customer_phone', ''),
    nullif(p->>'customer_address', ''), nullif(p->>'customer_city', ''), nullif(p->>'customer_zip', ''),
    coalesce((p->>'outside_area_relative')::boolean, false), (p->>'items_subtotal')::numeric,
    (p->>'delivery_fee')::numeric, (p->>'fee_covered')::numeric, (p->>'gift')::numeric, (p->>'total')::numeric,
    nullif(p->>'created_ip', ''), coalesce(nullif(p->>'placed_at', '')::timestamptz, now()),
    coalesce((p->>'collected_by_scout')::boolean, false), nullif(p->>'payment_note', ''),
    nullif(p->>'entered_by_person_id', '')::bigint, nullif(p->>'customer_note', '')
  )
  on conflict (idempotency_key) do nothing
  returning wreath_orders.id, wreath_orders.order_number, wreath_orders.public_token
  into v_id, v_number, v_token;

  if v_id is null then
    select o.id, o.order_number, o.public_token into v_id, v_number, v_token
      from wreath_orders o where o.idempotency_key = p->>'idempotency_key';
    return query select v_id, v_number, v_token, false;
    return;
  end if;

  insert into wreath_order_lines (order_id, item_id, quantity, donated, unit_price, unit_cost)
  select v_id, (l->>'item_id')::bigint, (l->>'quantity')::integer, coalesce((l->>'donated')::boolean, false),
         (l->>'unit_price')::numeric, (l->>'unit_cost')::numeric
    from jsonb_array_elements(p->'lines') l;

  return query select v_id, v_number, v_token, true;
end;
$$;
revoke all on function public.wreath_place_order(jsonb) from public, anon, authenticated;

-- ── Editing a scout-entered order ─────────────────────────────────────────────────────────────────────────
-- p: order_id, credited_person_id (the scout the caller was authorised for), customer_*, customer_note,
-- collected_by_scout, payment_note, items_subtotal, gift, total, lines[]. Returns true when it changed the order,
-- false when the order is no longer editable (paid, cancelled, not paper, or credited elsewhere).
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
    total = (p->>'total')::numeric
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

-- ── A seller's delivery message ───────────────────────────────────────────────────────────────────────────
-- Plain text the scout (or a parent) or the treasurer writes; the scout's public page shows it IN PLACE OF the
-- standard "<First> delivers your order in person, after distribution day" line. It goes live when saved (no
-- approval step). It replaces the retired personal quote; the old message / message_approved_at columns are
-- left alone and no longer read.
alter table public.wreath_sellers add column if not exists delivery_message text;
alter table public.wreath_sellers drop constraint if exists wreath_sellers_delivery_message_len;
alter table public.wreath_sellers
  add constraint wreath_sellers_delivery_message_len check (delivery_message is null or length(btrim(delivery_message)) between 1 and 200);
