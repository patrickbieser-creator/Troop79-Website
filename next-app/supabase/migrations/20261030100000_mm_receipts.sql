-- Menu Monster receipt reconciliation, the data half (Plans/Menu-Monster-Receipt-Reconciliation.md, v1.207.0).
-- Patrick, 2026-10-08.
--
-- A store receipt becomes data. Each line is stored as printed (store code, name, unit price, quantity, tax
-- code) with a PROPOSED ingredient where one could be inferred; it stays 'pending' until a scout confirms it:
--
--   mm_receipts        one receipt for one menu (store, when, printed subtotal / tax / total / item count).
--   mm_receipt_lines   one printed line (identical lines coalesced into a qty). status:
--                        pending   not looked at yet
--                        confirmed it is the ingredient (ingredient_id) and was written onto mm_menus.bought
--                        extra     not on the plan; joined meal_id, called `label`
--                        skipped   set aside
--                      confirmed_by / confirmed_by_person_id / confirmed_at stamp who settled it.
--
-- DEPLOY ORDER: DB-first. Additive; nothing reads these tables until the Receipt step ships.
-- Posture (D-051 / D-239): RLS on, zero policies, service role only; table privileges revoked from the
-- API roles as well.

create table if not exists public.mm_receipts (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.mm_menus(id) on delete cascade,
  store text not null default '',
  bought_at timestamptz not null,
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  item_count integer not null default 0,
  source text not null default 'manual' check (source in ('photo', 'manual')),
  note text,
  created_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mm_receipts_menu_idx on public.mm_receipts (menu_id);

create table if not exists public.mm_receipt_lines (
  id bigint generated always as identity primary key,
  receipt_id uuid not null references public.mm_receipts(id) on delete cascade,
  position integer not null,
  raw_name text not null,
  store_code text,
  unit_price numeric(10,2) not null default 0,
  qty integer not null default 1 check (qty between 1 and 99),
  tax_code text,
  proposed_ingredient_id text references public.mm_ingredients(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'extra', 'skipped')),
  ingredient_id text references public.mm_ingredients(id) on delete set null,
  meal_id text,
  label text,
  confirmed_by text,
  confirmed_by_person_id bigint references public.people(id) on delete set null,
  confirmed_at timestamptz,
  note text,
  unique (receipt_id, position)
);
create index if not exists mm_receipt_lines_receipt_idx on public.mm_receipt_lines (receipt_id);

alter table public.mm_receipts enable row level security;
alter table public.mm_receipt_lines enable row level security;
revoke all on public.mm_receipts from anon, authenticated;
revoke all on public.mm_receipt_lines from anon, authenticated;
