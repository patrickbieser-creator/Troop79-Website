-- Menu Monster: a scout prices their OWN typed-in food (Patrick, 2026-10-06: Hot Chocolate added on the fly
-- has no price, and the "No price yet" badge in the meal opens the package form).
--
-- mm_add_scout_package refused every ingredient with added_by_person_id set, so a typed-in (x-…) could only
-- be priced by the package written at creation, and the on-the-fly add no longer carries one. The refusal
-- now lets through exactly one case: the typed-in's own author (p_person = added_by_person_id). Anyone
-- else still gets MM_BAD_INGREDIENT, the same answer a missing food gets (a typed-in is private).
-- The action passes the MENU'S owner when a leader helps (typedInOwner), so a leader prices it as the owner.
-- The first price on an unpriced food goes live (20261016100000); nothing else changes.
--
-- DEPLOY ORDER: DB-first. Same signature; the old code never sends a typed-in id.

create or replace function public.mm_add_scout_package(
  p_person bigint,
  p_ingredient_id text,
  p_pkg jsonb,
  p_band numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ing mm_ingredients%rowtype;
  v_name text := btrim(coalesce(p_pkg->>'name', ''));
  v_store text := nullif(btrim(coalesce(p_pkg->>'store', '')), '');
  v_size numeric := nullif(p_pkg->>'size', '')::numeric;
  v_price numeric := round(nullif(p_pkg->>'price', '')::numeric, 2);
  v_same text;
  v_count integer;
  v_pc numeric;
  v_yc numeric;
  v_held boolean;
  v_id text;
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  if p_band is null or p_band <= 0 or p_band > 1 then
    raise exception 'MM_BAD_BAND';
  end if;
  if char_length(v_name) < 1 or not mm_scout_text_ok(v_name, 60) then
    raise exception 'MM_BAD_TEXT: package';
  end if;
  if v_store is not null and not mm_scout_text_ok(v_store, 40) then
    raise exception 'MM_BAD_TEXT: store';
  end if;
  if v_size is null or v_size <= 0 or v_size > 100000 or v_price is null or v_price < 0.10 or v_price > 500 then
    raise exception 'MM_BAD_PACKAGE';
  end if;

  -- Two scouts adding to one ingredient run one at a time (the cheapest is read under the lock).
  select * into v_ing from mm_ingredients where id = p_ingredient_id for update;
  if not found or v_ing.retired_at is not null or v_ing.merged_into_id is not null or (v_ing.added_by_person_id is not null and v_ing.added_by_person_id <> p_person) then
    raise exception 'MM_BAD_INGREDIENT: %', p_ingredient_id;
  end if;

  select id into v_same from mm_packages
  where ingredient_id = p_ingredient_id and retired_at is null
    -- never another scout's held package (qa-lead: it would leak an id they can't see)
    and (held_at is null or added_by_person_id = p_person)
    and coalesce(lower(store), '') = coalesce(lower(v_store), '') and yield = v_size and price = v_price
  limit 1;
  if v_same is not null then
    return jsonb_build_object('status', 'same', 'id', v_same);
  end if;

  select count(*) into v_count from mm_packages
    where added_by_person_id = p_person and ingredient_id = p_ingredient_id and retired_at is null;
  if v_count >= 3 then
    raise exception 'MM_PACKAGE_CAP: ingredient';
  end if;

  -- The basis is the troop's OWN packages (added_by_person_id is null): scout-added ones that
  -- went live must not drag the cheapest down step by step without a leader (qa-lead).
  select price, yield into v_pc, v_yc from mm_packages
  where ingredient_id = p_ingredient_id and retired_at is null and held_at is null and yield > 0 and price > 0
    and added_by_person_id is null
  order by price / yield, id
  limit 1;
  -- first price: no troop price to measure against → the FIRST scout package that went live (the oldest, a
  -- fixed anchor that later adds cannot move).
  if v_pc is null then
    select price, yield into v_pc, v_yc from mm_packages
    where ingredient_id = p_ingredient_id and retired_at is null and held_at is null and yield > 0 and price > 0
    order by created_at, id
    limit 1;
  end if;
  -- first price: nothing live at all → this IS the food's first price, and it goes live.
  v_held := v_pc is not null
    and abs(round(v_price * 100) * v_yc - round(v_pc * 100) * v_size) > p_band * round(v_pc * 100) * v_size;

  if v_held then
    select count(*) into v_count from mm_packages
      where added_by_person_id = p_person and held_at is not null and retired_at is null;
    if v_count >= 5 then
      raise exception 'MM_PACKAGE_CAP: held';
    end if;
  end if;

  v_id := 'sp-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  insert into mm_packages (id, ingredient_id, name, store, price, anchor_price, yield, noun, as_of, added_by_person_id, held_at)
  values (v_id, p_ingredient_id, v_name, v_store, v_price, v_price, v_size, 'pack', current_date, p_person,
          case when v_held then now() end);
  return jsonb_build_object('status', case when v_held then 'held' else 'live' end, 'id', v_id);
end;
$$;

revoke execute on function public.mm_add_scout_package(bigint, text, jsonb, numeric) from public, anon, authenticated;
