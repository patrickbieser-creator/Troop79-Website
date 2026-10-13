-- Wreath sale, Release A (Plans/Wreath-Sale.md, "Release A build spec"). Patrick, 2026-10-12.
--
-- The troop's annual Christmas wreath sale: a public store (/wreaths), a personal link per scout
-- (/wreaths/<first-name-last-initial>), and the admin that carries the orders (Admin > Finance > Wreath Sale).
-- Release A takes orders that are paid to the treasurer by Venmo / PayPal and marked paid by hand; PayPal
-- Checkout (Release B) and the books / close-sale / paper entry (Release C) add to these tables, they do not
-- reshape them.
--
--   wreath_sales        one row per year: status, the two cutoffs (end of day Central), distribution day,
--                       delivery area + fee, the processing-fee formula, the scout's share of profit.
--   wreath_items        the catalog (Rose's 19 items): price, unit cost, photo, donatable flag.
--   wreath_sellers      who sells: a scout (people.id), their link (slug), retired flag; goal + message for
--                       Release C.
--   wreath_orders       one per checkout. Customers have no accounts; the confirmation page is keyed by an
--                       unguessable public_token. Money is numeric(10,2), recomputed by the server.
--   wreath_order_lines  items on an order. unit_price / unit_cost are SNAPSHOTS at order time.
--
-- Posture (D-051 / D-239, Supabase security posture 2026-08-25): RLS on, ZERO policies, table privileges
-- revoked from the API roles, function EXECUTE revoked from anon / authenticated. Service role only.
--
-- DEPLOY ORDER: DB-first. The migration and its seed go to production before the code that reads them. The
-- seeded sale is a DRAFT: the store shows "not open yet" until the treasurer flips it to Open in Settings.
--
-- The seed fails loudly (raises, rolling the whole migration back) if any of the 28 sellers' people ids is
-- missing or not linked to an ACTIVE scout. Charlie Walters (people.id 39, the test scout) is deliberately
-- NOT seeded.

create sequence if not exists public.wreath_order_number_seq start 1001;

create table if not exists public.wreath_sales (
  id bigserial primary key,
  year integer not null unique check (year between 2000 and 9999),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  round1_cutoff timestamptz not null,
  round2_cutoff timestamptz not null,
  distribution_date date,
  distribution_window text not null default '',
  distribution_place text not null default '',
  delivery_zip_prefix text not null default '532' check (delivery_zip_prefix ~ '^[0-9]{1,5}$'),
  delivery_fee numeric(10,2) not null default 5.00 check (delivery_fee >= 0),
  delivery_free_at numeric(10,2) not null default 50.00 check (delivery_free_at >= 0),
  fee_percent numeric(5,2) not null default 1.99 check (fee_percent >= 0 and fee_percent <= 10),
  fee_fixed numeric(10,2) not null default 0.49 check (fee_fixed >= 0),
  scout_share numeric(4,3) not null default 0.300 check (scout_share >= 0 and scout_share <= 1),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (round2_cutoff > round1_cutoff)
);

create table if not exists public.wreath_items (
  id bigserial primary key,
  sale_id bigint not null references public.wreath_sales(id) on delete cascade,
  catalog_number integer not null check (catalog_number > 0),
  name text not null check (length(name) between 1 and 80),
  size text not null default '',
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  image_url text,
  -- which heading the store lists it under (Wreaths / Decorated and boxed / Shapes and greens / Trees and table / Hangers and stands)
  store_section text not null default 'wreaths' check (store_section in ('wreaths', 'boxed', 'shapes', 'trees', 'extras')),
  donatable boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (sale_id, catalog_number)
);

create table if not exists public.wreath_sellers (
  id bigserial primary key,
  sale_id bigint not null references public.wreath_sales(id) on delete cascade,
  person_id bigint not null references public.people(id),
  -- null = no personal link; a retired seller keeps their slug but the link falls back to the store
  slug text check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean not null default true,
  goal integer check (goal is null or goal >= 0),
  message text,
  message_approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sale_id, person_id),
  unique (sale_id, slug)
);

create table if not exists public.wreath_orders (
  id bigserial primary key,
  sale_id bigint not null references public.wreath_sales(id),
  order_number text not null unique default ('W-' || nextval('public.wreath_order_number_seq')),
  public_token uuid not null unique default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 80),
  credited_person_id bigint references public.people(id),
  delivering_person_id bigint references public.people(id),
  source text not null check (source in ('scout_link', 'store', 'paper')),
  -- 'none' = every line is a donated wreath: nothing comes to the customer
  fulfillment text not null check (fulfillment in ('scout', 'pickup', 'delivery', 'none')),
  round smallint not null check (round in (1, 2)),
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_email text,
  customer_phone text,
  customer_address text,
  customer_city text,
  customer_zip text,
  outside_area_relative boolean not null default false,
  items_subtotal numeric(10,2) not null default 0 check (items_subtotal >= 0),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  fee_covered numeric(10,2) not null default 0 check (fee_covered >= 0),
  gift numeric(10,2) not null default 0 check (gift >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  paid_at timestamptz,
  paid_method text check (paid_method is null or paid_method in ('venmo', 'paypal', 'cash', 'check', 'other')),
  paid_by_person_id bigint references public.people(id),
  status text not null default 'placed' check (status in ('placed', 'cancelled')),
  placed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  created_ip text,
  check (fulfillment <> 'scout' or delivering_person_id is not null)
);
create index if not exists wreath_orders_sale_idx on public.wreath_orders (sale_id, placed_at desc);
create index if not exists wreath_orders_credited_idx on public.wreath_orders (credited_person_id);
create index if not exists wreath_orders_ip_idx on public.wreath_orders (created_ip, placed_at);
create index if not exists wreath_orders_email_idx on public.wreath_orders (lower(customer_email), placed_at);

create table if not exists public.wreath_order_lines (
  id bigserial primary key,
  order_id bigint not null references public.wreath_orders(id) on delete cascade,
  item_id bigint not null references public.wreath_items(id),
  quantity integer not null check (quantity between 1 and 50),
  donated boolean not null default false,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  unique (order_id, item_id, donated)
);
create index if not exists wreath_order_lines_item_idx on public.wreath_order_lines (item_id);

alter table public.wreath_sales enable row level security;
alter table public.wreath_items enable row level security;
alter table public.wreath_sellers enable row level security;
alter table public.wreath_orders enable row level security;
alter table public.wreath_order_lines enable row level security;
revoke all on public.wreath_sales, public.wreath_items, public.wreath_sellers, public.wreath_orders, public.wreath_order_lines from anon, authenticated;
revoke all on sequence public.wreath_sales_id_seq, public.wreath_items_id_seq, public.wreath_sellers_id_seq,
  public.wreath_orders_id_seq, public.wreath_order_lines_id_seq, public.wreath_order_number_seq from anon, authenticated;

-- ── The one write path for a customer order ──────────────────────────────────────────────────────────────
-- The server action prices everything (prices come from wreath_items, never the client) and hands the finished
-- order here as json so the header and its lines land in ONE transaction. Idempotent on idempotency_key: a
-- retry returns the existing order with created = false (the caller sends no second email).
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
    outside_area_relative, items_subtotal, delivery_fee, fee_covered, gift, total, created_ip, placed_at
  ) values (
    (p->>'sale_id')::bigint, p->>'idempotency_key', nullif(p->>'credited_person_id', '')::bigint,
    nullif(p->>'delivering_person_id', '')::bigint, p->>'source', p->>'fulfillment', (p->>'round')::smallint,
    p->>'customer_name', nullif(p->>'customer_email', ''), nullif(p->>'customer_phone', ''),
    nullif(p->>'customer_address', ''), nullif(p->>'customer_city', ''), nullif(p->>'customer_zip', ''),
    coalesce((p->>'outside_area_relative')::boolean, false), (p->>'items_subtotal')::numeric,
    (p->>'delivery_fee')::numeric, (p->>'fee_covered')::numeric, (p->>'gift')::numeric, (p->>'total')::numeric,
    nullif(p->>'created_ip', ''), coalesce(nullif(p->>'placed_at', '')::timestamptz, now())
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

-- audit_log gains the 'wreaths' area (Mark paid / Reassign / cancel and the admin edits write from/to rows).
alter table public.audit_log drop constraint if exists audit_log_area_check;
alter table public.audit_log
  add constraint audit_log_area_check
  check (area in ('news', 'calendar', 'roster', 'library', 'menus', 'pages', 'wreaths'));

-- ── Seed: the 2026 sale ───────────────────────────────────────────────────────────────────────────────────
-- Cutoffs are end of day Central: Oct 25 is still daylight time (-05), Nov 15 is standard time (-06).
insert into public.wreath_sales (year, status, round1_cutoff, round2_cutoff, distribution_date, distribution_window, distribution_place)
values (2026, 'draft', '2026-10-25 23:59:00-05', '2026-11-15 23:59:00-06', '2026-11-21', '2:30 to 4:30 PM', 'Northwoods parking lot, 1572 East Capitol')
on conflict (year) do nothing;

-- The 19 items from the 2026 sheet (price, unit cost) with Rose's catalog photos on the troop CDN.
-- Descriptions are drafts, editable in Admin. Only the 20″ and 26″ wreaths (1, 2) can be donated.
insert into public.wreath_items (sale_id, catalog_number, name, size, description, price, unit_cost, image_url, store_section, donatable, sort_order)
select s.id, v.n, v.name, v.size, v.descr, v.price, v.cost, v.img, v.sec, v.donatable, v.ord
from public.wreath_sales s,
(values
  (1,  'Wreath',               '20″',   'Fresh mixed greens, pine cones and a red bow. Fits a standard front door.', 26.00, 16.07, 'https://troop79.b-cdn.net/wreaths/2026/wreath-20.jpg', 'wreaths', true,  10),
  (2,  'Wreath',               '26″',   'A fuller door wreath with cones and a red bow attached.', 32.00, 18.24, 'https://troop79.b-cdn.net/wreaths/2026/wreath-26.jpg', 'wreaths', true,  20),
  (3,  'Wreath',               '36″',   'For a wide door, a gate or a garage. Bow attached.', 42.00, 27.87, 'https://troop79.b-cdn.net/wreaths/2026/wreath-36.jpg', 'wreaths', false, 30),
  (4,  'Wreath',               '48″',   'For a garage or a big wall. Bow comes unattached; hanger not included.', 52.00, 38.04, 'https://troop79.b-cdn.net/wreaths/2026/wreath-48.jpg', 'wreaths', false, 40),
  (5,  'Wreath',               '60″',   'For a barn, a church or a storefront. Bow comes unattached.', 60.00, 45.47, 'https://troop79.b-cdn.net/wreaths/2026/wreath-60.jpg', 'wreaths', false, 50),
  (6,  'Wreath',               '72″',   'Our largest. Bow comes unattached; it takes two people to hang.', 76.00, 57.02, 'https://troop79.b-cdn.net/wreaths/2026/wreath-72.jpg', 'wreaths', false, 60),
  (7,  'Double wreath',        '36″',   'Greens on both faces, for a window, a fence or anywhere seen from both sides.', 55.00, 39.55, 'https://troop79.b-cdn.net/wreaths/2026/wreath-double-face-36.jpg', 'wreaths', false, 70),
  (8,  'Double wreath',        '48″',   'The larger two-sided wreath. Bow comes unattached.', 70.00, 50.35, 'https://troop79.b-cdn.net/wreaths/2026/wreath-double-face-48.jpg', 'wreaths', false, 80),
  (21, 'Extra Special wreath', '24″',   'Decorated with cones, berries and ribbon, and boxed, ready to give.', 42.00, 29.85, 'https://troop79.b-cdn.net/wreaths/2026/wreath-special-24.jpg', 'boxed', false, 90),
  (22, 'Platinum wreath',      '24″',   'Our most decorated wreath, boxed, ready to give or ship yourself.', 46.00, 32.70, 'https://troop79.b-cdn.net/wreaths/2026/wreath-platinum-24.jpg', 'boxed', false, 100),
  (9,  'Candy cane',           '36″',   'Greens shaped into a candy cane with a red bow, for a door or a lamp post.', 30.00, 20.25, 'https://troop79.b-cdn.net/wreaths/2026/cane-36.jpg', 'shapes', false, 110),
  (20, 'Cross',                '36″',   'A cross of greens, often placed at a cemetery. Easel sold separately.', 40.00, 27.65, 'https://troop79.b-cdn.net/wreaths/2026/cross-36.jpg', 'shapes', false, 120),
  (10, 'Swag',                 '30″',   'A flat spray of greens with a bow, for a door, a mailbox or a gate.', 20.00, 13.62, 'https://troop79.b-cdn.net/wreaths/2026/door-swag-30.jpg', 'shapes', false, 130),
  (11, 'Roping',               '25 ft', 'Pine roping for railings, porches and doorways. One 25-foot length.', 42.00, 31.82, 'https://troop79.b-cdn.net/wreaths/2026/garland-25.jpg', 'shapes', false, 140),
  (12, 'Tabletop tree',        '18″',   'A small tree for a table or a windowsill, ready to decorate.', 55.00, 43.25, 'https://troop79.b-cdn.net/wreaths/2026/christmas-tree-18.jpg', 'trees', false, 150),
  (13, 'Tabletop tree',        '27″',   'A bigger tabletop tree for an entry or a porch. Stand included.', 75.00, 55.05, 'https://troop79.b-cdn.net/wreaths/2026/christmas-tree-27.jpg', 'trees', false, 160),
  (14, 'Centerpiece',          '',      'A low table arrangement with a candle holder. Candle not included.', 50.00, 38.65, 'https://troop79.b-cdn.net/wreaths/2026/centerpiece.jpg', 'trees', false, 170),
  (15, 'Easel',                '30″',   'A wire stand that holds a wreath or cross upright at a grave or on a porch.', 10.00, 5.85, 'https://troop79.b-cdn.net/wreaths/2026/easel-30.jpg', 'extras', false, 180),
  (16, 'Door hanger',          '15″',   'An over-the-door hook for wreaths up to 26″. No nails needed.', 5.00, 4.05, 'https://troop79.b-cdn.net/wreaths/2026/door-hanger-15.jpg', 'extras', false, 190)
) as v(n, name, size, descr, price, cost, img, sec, donatable, ord)
where s.year = 2026
on conflict (sale_id, catalog_number) do nothing;

-- The 28 sellers by people.id ("Aubry" and "Lilly" on the sheet are Aubrey Reinelt and Lily Porter; Maya ST is
-- dropped; "UnAccounted For" is the troop bucket, i.e. credited scout = none, not a seller). Slug = first name +
-- last initial; the unique (sale_id, slug) constraint fails the migration on a collision.
do $$
declare
  v_ids bigint[] := array[23, 48, 43, 36, 45, 175, 32, 14, 29, 20, 46, 25, 15, 34, 41, 2, 8, 31, 27, 21, 44, 17, 16, 1, 30, 28, 9, 22];
  v_sale bigint;
  v_ok integer;
  v_inserted integer;
begin
  select id into v_sale from public.wreath_sales where year = 2026;
  select count(*) into v_ok
    from public.people p
    join public.scouts s on s.person_id = p.id and s.active
   where p.id = any (v_ids) and p.active;
  if v_ok <> array_length(v_ids, 1) then
    raise exception 'wreath seed: % of % seller people ids are missing or not linked to an active scout',
      array_length(v_ids, 1) - v_ok, array_length(v_ids, 1);
  end if;

  insert into public.wreath_sellers (sale_id, person_id, slug)
  select v_sale, p.id,
         regexp_replace(lower(p.first_name), '[^a-z0-9]+', '', 'g') || '-' || left(regexp_replace(lower(p.last_name), '[^a-z0-9]+', '', 'g'), 1)
    from public.people p
   where p.id = any (v_ids)
  on conflict (sale_id, person_id) do nothing;

  select count(*) into v_inserted from public.wreath_sellers where sale_id = v_sale;
  if v_inserted <> array_length(v_ids, 1) then
    raise exception 'wreath seed: expected % sellers, found %', array_length(v_ids, 1), v_inserted;
  end if;
end $$;
