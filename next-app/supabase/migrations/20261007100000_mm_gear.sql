-- Menu Monster gear (Plans/Menu-Monster-Brands-Gear.md, release 2).
--
--   1. mm_gear          the troop's gear list: one spelling per item, where it lives, and whether a menu
--                       needs one per person (the troop's mess kits). Scouts add to it by naming gear on a
--                       recipe or a menu; leaders tidy it in admin. No owned counts (Patrick, 2026-10-03:
--                       the quartermaster does not keep them true).
--   2. mm_menus.gear_extras / gear_packed
--                       a menu's own extra gear (things no recipe names) and its Packed ticks:
--                       { "<name, lower case>": { count, by, personId, at } }. Written only by the gear
--                       actions, never by a menu save, and never bumping updated_at — an open Plan tab's
--                       version token must not go stale because someone packed a skillet.
--   3. mm_set_gear_packed
--                       one tick, merged into the jsonb atomically (two scouts packing at once).
--
-- Recipes keep `equipment text[]` (names; "Skillet × 2" carries a count).
--
-- DEPLOY ORDER: DB-first. Additive; the new code selects the new columns. Posture (D-239): RLS on,
-- zero policies, EXECUTE revoked from anon/authenticated.

create table if not exists public.mm_gear (
  id integer generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  home text not null default 'trailer' check (home in ('patrol_box', 'trailer', 'home')),
  per_person boolean not null default false,
  added_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index if not exists mm_gear_name_lower_key on public.mm_gear (lower(name));
alter table public.mm_gear enable row level security;

alter table public.mm_menus
  add column if not exists gear_extras text[] not null default '{}',
  add column if not exists gear_packed jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.mm_menus add constraint mm_menus_gear_extras_check check (cardinality(gear_extras) <= 30);
exception when duplicate_object then null; end $$;

insert into public.mm_gear (name, home, per_person)
select v.name, v.home, v.per_person
from (values
  ('Troop mess kit', 'trailer', true),
  ('Camp stove', 'trailer', false), ('Griddle', 'trailer', false), ('Skillet', 'trailer', false),
  ('Large pot', 'trailer', false), ('Medium pot', 'trailer', false), ('Kettle', 'trailer', false),
  ('Coffee pot', 'trailer', false), ('Dutch oven (12 in)', 'trailer', false), ('Lid lifter', 'trailer', false),
  ('Leather gloves', 'trailer', false), ('Charcoal chimney', 'trailer', false), ('Roasting sticks', 'trailer', false),
  ('Cooler', 'trailer', false),
  ('Long tongs', 'patrol_box', false), ('Spatula', 'patrol_box', false), ('Whisk', 'patrol_box', false),
  ('Mixing bowl', 'patrol_box', false), ('Serving bowl', 'patrol_box', false), ('Serving spoon', 'patrol_box', false),
  ('Ladle', 'patrol_box', false), ('Cutting board', 'patrol_box', false), ('Knife', 'patrol_box', false),
  ('Butter knife', 'patrol_box', false), ('Can opener', 'patrol_box', false), ('Colander', 'patrol_box', false),
  ('Measuring cups', 'patrol_box', false)
) as v(name, home, per_person)
where not exists (select 1 from public.mm_gear g where lower(g.name) = lower(v.name));

-- One Packed tick. p_packed false removes it. Returns false when the menu is gone.
create or replace function public.mm_set_gear_packed(
  p_menu uuid, p_key text, p_packed boolean, p_count integer, p_person bigint, p_label text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
begin
  if char_length(v_key) < 1 or char_length(v_key) > 60 then
    raise exception 'MM_BAD_GEAR';
  end if;
  if p_packed then
    -- A menu's gear is a few dozen rows; the cap stops anyone growing another scout's row without limit (qa-lead).
    if exists (select 1 from mm_menus where id = p_menu and not (gear_packed ? v_key)
               and (select count(*) from jsonb_object_keys(gear_packed)) >= 100) then
      raise exception 'MM_BAD_GEAR';
    end if;
    update mm_menus
    set gear_packed = gear_packed || jsonb_build_object(v_key, jsonb_build_object(
      'count', greatest(1, least(coalesce(p_count, 1), 99)),
      'by', left(coalesce(p_label, ''), 60),
      'personId', p_person,
      'at', now()))
    where id = p_menu;
  else
    update mm_menus set gear_packed = gear_packed - v_key where id = p_menu;
  end if;
  return found;
end;
$$;

revoke execute on function public.mm_set_gear_packed(uuid, text, boolean, integer, bigint, text) from public, anon, authenticated;
