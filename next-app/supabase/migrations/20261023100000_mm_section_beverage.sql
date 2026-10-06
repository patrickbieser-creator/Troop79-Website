-- Menu Monster: add a food on the fly from a meal (Patrick, 2026-10-06: "there is no way to
-- add Kool-Aid on the fly ... at a minimum, only require the name and if it's a beverage or
-- meat or the appropriate classification").
--
--   1. mm_ingredients.section accepts 'beverage' (drop + re-add the CHECK).
--   2. mm_create_typed_in v2 (same signature): the typed-in's `section` comes from the payload
--      (default 'dry', so older callers are unchanged) and its package is OPTIONAL. With no
--      package (size and price both absent or 0) no mm_packages row is written: the food is
--      "unpriced" until someone prices it (the planner says "No price yet"; the admin Needs
--      attention tab lists it). A package with only one of size / price is still refused.
--
-- DEPLOY ORDER: DB-first. The CHECK only widens and the function keeps its signature; the new
-- code sends section 'beverage' and package-less typed-ins, which the old database refuses.

alter table public.mm_ingredients drop constraint if exists mm_ingredients_section_check;
alter table public.mm_ingredients
  add constraint mm_ingredients_section_check
  check (section in ('produce', 'dairy', 'beverage', 'meat', 'bakery', 'dry'));

-- The 20261005100000 body with `section` read from the payload and the package optional.
create or replace function public.mm_create_typed_in(p_person bigint, p_new jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := p_new->>'kind';
  v_new_name text := btrim(coalesce(p_new->>'name', ''));
  v_one text := btrim(coalesce(p_new->>'unit_one', ''));
  v_many text := btrim(coalesce(p_new->>'unit_many', ''));
  v_section text := coalesce(nullif(btrim(coalesce(p_new->>'section', '')), ''), 'dry');
  v_size numeric := nullif(p_new->'package'->>'size', '')::numeric;
  v_price numeric := nullif(p_new->'package'->>'price', '')::numeric;
  v_store text := nullif(btrim(coalesce(p_new->'package'->>'store', '')), '');
  v_has_package boolean;
  v_count integer;
  v_new_id text;
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  if char_length(v_new_name) < 1 or not mm_scout_text_ok(v_new_name, 60) then
    raise exception 'MM_BAD_TEXT: ingredient';
  end if;
  if v_kind is null or v_kind not in ('count', 'volume', 'weight') then
    raise exception 'MM_BAD_INGREDIENT: kind';
  end if;
  if v_section not in ('produce', 'dairy', 'beverage', 'meat', 'bakery', 'dry') then
    raise exception 'MM_BAD_INGREDIENT: section';
  end if;
  if v_kind = 'count' and (char_length(v_one) < 1 or char_length(v_many) < 1 or not mm_scout_text_ok(v_one, 20) or not mm_scout_text_ok(v_many, 20)) then
    raise exception 'MM_BAD_TEXT: unit';
  end if;
  v_has_package := coalesce(v_size, 0) > 0 or coalesce(v_price, 0) > 0;
  if v_has_package and (v_size is null or v_size <= 0 or v_size > 100000 or v_price is null or v_price < 0.10 or v_price > 500) then
    raise exception 'MM_BAD_INGREDIENT: package';
  end if;
  if v_store is not null and not mm_scout_text_ok(v_store, 40) then
    raise exception 'MM_BAD_TEXT: store';
  end if;
  if exists (select 1 from mm_ingredients i where lower(i.name) = lower(v_new_name) and i.retired_at is null
             and (i.added_by_person_id is null or i.added_by_person_id = p_person or i.shared_at is not null)) then
    raise exception 'MM_DUPLICATE_INGREDIENT: %', v_new_name;
  end if;
  select count(*) into v_count from mm_ingredients
    where added_by_person_id = p_person and needs_match_at is not null and retired_at is null;
  if v_count >= 10 then
    raise exception 'MM_INGREDIENT_CAP';
  end if;

  v_new_id := 'x-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  insert into mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid,
                              added_by_person_id, needs_match_at)
  values (
    v_new_id,
    v_new_name,
    v_kind,
    case v_kind when 'volume' then 'cup' when 'weight' then 'ozw' else 'count' end,
    case v_kind when 'volume' then 'cup' when 'weight' then 'oz' else v_one end,
    case v_kind when 'volume' then 'cups' when 'weight' then 'oz' else v_many end,
    v_section,
    false,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_new->'avoid', '[]'::jsonb)) x
              where x in ('gf', 'nut', 'dairy', 'veg')), '{}'::text[]),
    p_person,
    now()
  );
  if v_has_package then
    insert into mm_packages (id, ingredient_id, name, store, price, anchor_price, yield, noun, as_of, added_by_person_id)
    values (
      'xp-' || substr(v_new_id, 3),
      v_new_id,
      v_new_name,
      v_store,
      round(v_price, 2),
      round(v_price, 2),
      v_size,
      'pack',
      current_date,
      p_person
    );
  end if;
  return v_new_id;
end;
$$;

revoke execute on function public.mm_create_typed_in(bigint, jsonb) from public, anon, authenticated;
