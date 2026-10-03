-- Menu Monster release C (Plans/Menu-Monster-Scout-Workspace.md, "Release C design"):
-- typed-in ingredients on MENUS reuse 4B's real typed-ins, and scouts add packages.
--
--   1. mm_create_typed_in       the one typed-in validator + insert (x- ingredient + xp- package),
--                               extracted from mm_save_scout_recipe so recipes and menus share it.
--   2. mm_add_menu_ingredient   a typed-in from a menu: same lock, same 10-unmatched cap as recipes.
--   3. mm_drop_orphan_typed_ins also keeps an item one of the person's menus mentions, and anything
--                               younger than a day (the gap between adding it and saving the menu).
--   4. mm_save_scout_recipe v3  the 160000 body with its typed-in loop calling (1). Nothing else changes.
--   5. mm_add_scout_package     a scout's package on a book ingredient: live inside ±band of the
--                               cheapest live usable package's unit price, else held for a leader.
--
-- DEPLOY ORDER: DB-first. New functions + same-signature replacements; the old code
-- never calls the new ones. Posture (D-239): EXECUTE revoked from anon/authenticated.

-- ── 1. mm_create_typed_in ──────────────────────────────────────────────────
-- p_new: { name, kind: count|volume|weight, unit_one, unit_many, avoid: [...],
-- package: { size, price, store } } with `size` already in the recipe unit
-- (count: how many; volume: cups; weight: oz). The caller holds the scout's
-- advisory lock. Returns the new x- id.

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
  v_size numeric := nullif(p_new->'package'->>'size', '')::numeric;
  v_price numeric := nullif(p_new->'package'->>'price', '')::numeric;
  v_store text := nullif(btrim(coalesce(p_new->'package'->>'store', '')), '');
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
  if v_kind = 'count' and (char_length(v_one) < 1 or char_length(v_many) < 1 or not mm_scout_text_ok(v_one, 20) or not mm_scout_text_ok(v_many, 20)) then
    raise exception 'MM_BAD_TEXT: unit';
  end if;
  if v_size is null or v_size <= 0 or v_size > 100000 or v_price is null or v_price < 0.10 or v_price > 500 then
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
    'dry',
    false,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_new->'avoid', '[]'::jsonb)) x
              where x in ('gf', 'nut', 'dairy', 'veg')), '{}'::text[]),
    p_person,
    now()
  );
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
  return v_new_id;
end;
$$;

revoke execute on function public.mm_create_typed_in(bigint, jsonb) from public, anon, authenticated;

-- ── 2. mm_add_menu_ingredient ──────────────────────────────────────────────
-- A typed-in added from a menu meal. The menu's next save stores a recipeEdits
-- `add` op naming the returned id; until then the 1-day grace in (3) keeps it.

create or replace function public.mm_add_menu_ingredient(p_person bigint, p_new jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));
  return mm_create_typed_in(p_person, p_new);
end;
$$;

revoke execute on function public.mm_add_menu_ingredient(bigint, jsonb) from public, anon, authenticated;

-- ── 3. mm_drop_orphan_typed_ins ────────────────────────────────────────────
-- A scout's private (never shared), unmatched typed-ins that nothing uses any
-- more: no recipe line, none of the scout's menus (meals / shopping / actuals —
-- the id appears as a quoted JSON value or key), and older than a day.

create or replace function public.mm_drop_orphan_typed_ins(p_person bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[];
begin
  -- The scout's own saves already hold this lock (re-entrant); menu save / delete calls take it here.
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));
  select coalesce(array_agg(i.id), '{}') into v_ids from mm_ingredients i
  where i.added_by_person_id = p_person and i.shared_at is null and i.needs_match_at is not null
    and i.created_at < now() - interval '24 hours'
    and not exists (select 1 from mm_recipe_lines l where l.ingredient_id = i.id)
    and not exists (select 1 from mm_variation_lines v where v.ingredient_id = i.id or v.base_ingredient_id = i.id)
    and not exists (select 1 from mm_conversions c where c.ingredient_id = i.id)
    and not exists (
      select 1 from mm_menus m
      where m.owner_person_id = p_person
        and position(('"' || i.id || '"') in (m.meals::text || m.shopping::text || m.actuals::text)) > 0
    );
  delete from mm_packages p
  where p.ingredient_id = any (v_ids)
    and not exists (select 1 from mm_price_history h where h.package_id = p.id);
  delete from mm_ingredients i
  where i.id = any (v_ids)
    and not exists (select 1 from mm_packages p where p.ingredient_id = i.id);
end;
$$;

revoke execute on function public.mm_drop_orphan_typed_ins(bigint) from public, anon, authenticated;

-- ── 4. mm_save_scout_recipe v3 ─────────────────────────────────────────────
-- The 20261003160000 definition; its typed-in loop now validates only the key
-- and calls mm_create_typed_in (marked "release C").

create or replace function public.mm_save_scout_recipe(
  p_person bigint,
  p_recipe jsonb,
  p_lines jsonb,
  p_expected_updated_at timestamptz,
  p_new_ingredients jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_recipe->>'id';
  v_name text := btrim(coalesce(p_recipe->>'name', ''));
  v_steps text := coalesce(p_recipe->>'steps_md', '');
  v_existing mm_recipes%rowtype;
  v_count integer;
  v_line jsonb;
  v_pos integer := 0;
  v_ing mm_ingredients%rowtype;
  v_ing_id text;
  v_qty numeric;
  v_now timestamptz := now();
  v_new jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_key text;
  v_new_id text;
  -- Gear you'll need (4C): trimmed, at most 20, each public-safe text.
  v_gear text[] := coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p_recipe->'equipment', '[]'::jsonb)) x), '{}'::text[]);
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  if v_id is null or v_id !~ '^S-[0-9a-f]{8}$' then
    raise exception 'MM_BAD_RECIPE_ID';
  end if;
  if char_length(v_name) < 1 or not mm_scout_text_ok(v_name, 60) then
    raise exception 'MM_BAD_TEXT: name';
  end if;
  if not mm_scout_text_ok(v_steps, 4000) then
    raise exception 'MM_BAD_TEXT: steps';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 40 then
    raise exception 'MM_BAD_LINES';
  end if;
  if cardinality(v_gear) > 20 or exists (select 1 from unnest(v_gear) g where char_length(g) < 1 or not mm_scout_text_ok(g, 40)) then
    raise exception 'MM_BAD_TEXT: gear';
  end if;
  if jsonb_typeof(coalesce(p_new_ingredients, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_new_ingredients, '[]'::jsonb)) > 10 then
    raise exception 'MM_BAD_INGREDIENT: too many new ingredients';
  end if;

  -- One scout's saves run one at a time (caps + ownership).
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));

  select * into v_existing from mm_recipes where id = v_id for update;
  if found then
    if v_existing.author_person_id is distinct from p_person then
      raise exception 'MM_NOT_YOURS';
    end if;
    if v_existing.status = 'retired' then
      raise exception 'MM_RETIRED';
    end if;
    if p_expected_updated_at is null or v_existing.updated_at <> p_expected_updated_at then
      raise exception 'MM_STALE';
    end if;
    update mm_recipes set
      name        = v_name,
      meal_fit    = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'meal_fit', '[]'::jsonb)) x), '{}'::text[]),
      food_groups = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'food_groups', '[]'::jsonb)) x), '{}'::text[]),
      steps_md    = nullif(v_steps, ''),
      equipment   = v_gear,
      updated_at  = v_now
    where id = v_id;
  else
    select count(*) into v_count from mm_recipes where author_person_id = p_person and status <> 'retired';
    if v_count >= 25 then
      raise exception 'MM_RECIPE_CAP';
    end if;
    insert into mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, steps_md, sort_order,
                            author_person_id, origin_recipe_id, equipment, created_at, updated_at)
    values (
      v_id,
      v_name,
      'draft',
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'meal_fit', '[]'::jsonb)) x), '{}'::text[]),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'food_groups', '[]'::jsonb)) x), '{}'::text[]),
      true,
      false,
      nullif(v_steps, ''),
      1000,
      p_person,
      (select r.id from mm_recipes r where r.id = nullif(p_recipe->>'origin_recipe_id', '') and r.status = 'published'),
      v_gear,
      v_now,
      v_now
    );
  end if;

  -- Typed-in ingredients: mm_create_typed_in validates, caps at 10 unmatched per
  -- scout, refuses a name the book already has, prices from the scout's entry.
  for v_new in select * from jsonb_array_elements(coalesce(p_new_ingredients, '[]'::jsonb)) loop
    v_key := v_new->>'key';
    if v_key is null or v_key !~ '^new:[0-9a-f]{8}$' or v_ids ? v_key then
      raise exception 'MM_BAD_INGREDIENT: key';
    end if;
    -- release C: one validator + insert for recipe and menu typed-ins.
    v_new_id := mm_create_typed_in(p_person, v_new);
    v_ids := v_ids || jsonb_build_object(v_key, v_new_id);
  end loop;

  -- Lines: everyone-lines (scouts don't author diet rules). A matched-away
  -- ingredient resolves to its target; anything retired otherwise, or someone
  -- else's private typed-in, is refused. Locked so a leader can't retire or
  -- match it underneath this save. The ingredients are locked BEFORE the lines
  -- (as mm_match_ingredient does) so a save and a match can't deadlock.
  perform 1 from mm_ingredients i
  where i.id in (
    select coalesce(v_ids->>(l->>'ingredient_id'), l->>'ingredient_id')
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  )
  order by i.id
  for share;
  delete from mm_recipe_lines where recipe_id = v_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    v_qty := (v_line->>'qty_per_person')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 1000 then
      raise exception 'MM_BAD_LINES';
    end if;
    v_ing_id := v_line->>'ingredient_id';
    if v_ing_id like 'new:%' then
      v_ing_id := v_ids->>v_ing_id;
    end if;
    select * into v_ing from mm_ingredients i where i.id = v_ing_id for share;
    if found and v_ing.merged_into_id is not null then
      v_qty := v_qty * v_ing.merge_factor;
      select * into v_ing from mm_ingredients i where i.id = v_ing.merged_into_id for share;
    end if;
    if v_ing.id is null or v_ing_id is null or v_ing.retired_at is not null
       or (v_ing.added_by_person_id is not null and v_ing.added_by_person_id <> p_person and v_ing.shared_at is null) then
      raise exception 'MM_BAD_INGREDIENT: %', v_line->>'ingredient_id';
    end if;
    if exists (select 1 from mm_recipe_lines where recipe_id = v_id and ingredient_id = v_ing.id) then
      raise exception 'MM_BAD_LINES';
    end if;
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
    values (v_id, v_pos, v_ing.id, least(v_qty, 1000), nullif(v_line->>'unit_key', ''), 'everyone', '{}'::text[]);
    v_ing := null;
  end loop;

  -- A shared recipe stays usable for everyone who uses it: it can't be saved
  -- down to no ingredient or no meal (v_existing is null for a new draft).
  if v_existing.status = 'published'
     and (v_pos = 0 or cardinality((select r.meal_fit from mm_recipes r where r.id = v_id)) = 0) then
    raise exception 'MM_NOT_READY';
  end if;

  -- A shared recipe's own typed-ins must be visible to everyone it is shared with.
  if v_existing.status = 'published' then
    update mm_ingredients set shared_at = v_now
    where shared_at is null and added_by_person_id = p_person
      and id in (select ingredient_id from mm_recipe_lines where recipe_id = v_id);
  end if;

  -- The scout's private typed-ins no line uses any more (removed from a recipe,
  -- or a deleted draft) would hold the 10-cap forever and never reach a leader.
  perform mm_drop_orphan_typed_ins(p_person);

  return jsonb_build_object('updated_at', v_now, 'ids', v_ids);
end;
$$;

revoke execute on function public.mm_save_scout_recipe(bigint, jsonb, jsonb, timestamptz, jsonb) from public, anon, authenticated;

-- ── 5. mm_add_scout_package ────────────────────────────────────────────────
-- p_pkg: { name, store, size, price } with `size` in the ingredient's recipe
-- unit (the client converts from the ingredient's own kind). Book ingredients
-- only. Band (p_band, the caller's PRICE_BAND): |P·Yc − Pc·Y| ≤ band·Pc·Y in
-- whole cents against the cheapest live usable BOOK package (not scout-added) —
-- newPackageBand() in price-band.ts is the same rule, given those siblings. Returns { status: live|held|same, id }.

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
  if not found or v_ing.retired_at is not null or v_ing.merged_into_id is not null or v_ing.added_by_person_id is not null then
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
  v_held := v_pc is null
    or abs(round(v_price * 100) * v_yc - round(v_pc * 100) * v_size) > p_band * round(v_pc * 100) * v_size;

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

-- ── 6. mm_package_in_use ───────────────────────────────────────────────────
-- Whether anything still names a package: a price-history row, or any menu's
-- shopping choices / actuals (the id as a quoted JSON value). A leader's Reject
-- deletes a held scout package only when this is false; otherwise it retires it.

create or replace function public.mm_package_in_use(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from mm_price_history h where h.package_id = p_id)
      or exists (
        select 1 from mm_menus m
        where position(('"' || p_id || '"') in (m.shopping::text || m.actuals::text)) > 0
      );
$$;

revoke execute on function public.mm_package_in_use(text) from public, anon, authenticated;
