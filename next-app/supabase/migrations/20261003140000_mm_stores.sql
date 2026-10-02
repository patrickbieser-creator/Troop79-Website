-- Menu Monster: the store list becomes an admin-managed table (Patrick,
-- 2026-10-02, "how do I add a store?"). Until now the list was the hardcoded
-- STORES constant in lib/menu-monster/authoring.ts.
--
--  * mm_stores: name unique ignoring case, a sort_order, a retire flag.
--    RLS on with zero policies (D-239) -- service role only, like every mm_*.
--  * mm_packages.store stays plain TEXT, no FK: a package keeps its store
--    name even after the store is retired.
--  * Seed: the five stores the constant held, in that order, then any other
--    distinct non-blank mm_packages.store already in the data (case-insensitive
--    dedupe, first spelling wins) so nothing in use goes missing.
--  * mm_rename_store: renames the store AND every package carrying the old
--    name in one transaction. Returns plain text: ok | same | missing |
--    invalid | duplicate.
--
-- DEPLOY ORDER: DB-first; purely additive (one table, one function). The
-- function is security definer and reachable only with the service role
-- (EXECUTE revoked from public/anon/authenticated), the mm_report_price
-- precedent.

create table public.mm_stores (
  id          integer generated always as identity primary key,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order  integer not null default 0,
  retired_at  timestamptz,
  created_at  timestamptz not null default now()
);

create unique index mm_stores_name_lower_key on public.mm_stores (lower(name));

alter table public.mm_stores enable row level security;

insert into public.mm_stores (name, sort_order) values
  ('Costco', 10), ('Kroger', 20), ('Target', 30), ('Outpost', 40), ('Other', 50);

insert into public.mm_stores (name, sort_order)
select s.name, 50 + 10 * row_number() over (order by s.name)
from (
  select distinct on (lower(btrim(store))) btrim(store) as name
  from public.mm_packages
  where store is not null and btrim(store) <> ''
    and not exists (select 1 from public.mm_stores m where lower(m.name) = lower(btrim(store)))
  order by lower(btrim(store)), btrim(store)
) s;

create or replace function public.mm_rename_store(p_id integer, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_new) < 1 or char_length(v_new) > 40 then
    return 'invalid';
  end if;

  select name into v_old from mm_stores where id = p_id for update;
  if not found then
    return 'missing';
  end if;
  if v_old = v_new then
    return 'same';
  end if;
  if exists (select 1 from mm_stores where lower(name) = lower(v_new) and id <> p_id) then
    return 'duplicate';
  end if;

  update mm_stores set name = v_new where id = p_id;
  update mm_packages set store = v_new where store = v_old;
  return 'ok';
end;
$$;

revoke all on function public.mm_rename_store(integer, text) from public, anon, authenticated;
grant execute on function public.mm_rename_store(integer, text) to service_role;
