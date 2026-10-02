-- Menu Monster scout workspace, Phase 2 release A (Plans/Menu-Monster-Scout-Workspace.md,
-- "Phase 2 design"): the schema for shopping actuals, the price history and
-- scout-added packages. Nothing writes these yet; release B/C add the actions.
--
--  * mm_price_history: one row per price change reported by a scout (or made by
--    a leader). old_as_of is kept so a revert restores the date too. A 'held'
--    row (outside the +/-50% band) waits for a leader; held rows are undecided.
--  * mm_packages.added_by_person_id: who added a scout package. held_at: a
--    package waiting on a leader; both PUBLIC catalog loaders filter
--    held_at is null, authoring (and the owner's own menu) still see it.
--  * mm_menus.actuals: what was bought, per MENU, keyed by ingredient
--    ({ packageId, qty, pricePaid }); free_items: typed-in ingredients.
--
-- DEPLOY ORDER: DB-first. Purely additive (new table, new nullable / defaulted
-- columns); the old code never selects any of it.
--
-- RLS on, zero policies (D-239): service role only, through createAdminClient.
-- People references are RESTRICT; merge_people re-points them
-- (20261003100100_merge_people_menus.sql).

create table public.mm_price_history (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.mm_packages (id) on delete restrict,
  old_price numeric(10, 2) not null check (old_price >= 0),
  old_as_of date,
  new_price numeric(10, 2) not null check (new_price > 0),
  reported_by_person_id bigint not null references public.people (id) on delete restrict,
  -- SET NULL: deleting a menu keeps the price evidence.
  menu_id uuid references public.mm_menus (id) on delete set null,
  status text not null default 'applied' check (status in ('applied', 'held', 'reverted')),
  created_at timestamptz not null default now(),
  decided_by_person_id bigint references public.people (id) on delete restrict,
  decided_at timestamptz,
  -- A held row is by definition undecided.
  constraint mm_price_history_held_undecided
    check (status <> 'held' or (decided_by_person_id is null and decided_at is null))
);

alter table public.mm_price_history enable row level security;

create index mm_price_history_package_idx on public.mm_price_history (package_id, created_at desc);
create index mm_price_history_held_idx on public.mm_price_history (created_at desc) where status = 'held';

alter table public.mm_packages
  add column added_by_person_id bigint references public.people (id) on delete restrict,
  add column held_at timestamptz;

alter table public.mm_menus
  add column actuals jsonb not null default '{}'::jsonb
    check (jsonb_typeof(actuals) = 'object'),
  add column free_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(free_items) = 'array');
