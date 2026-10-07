-- A line can be for the whole meal (Patrick, 2026-10-06): "4 cups of cooking oil for the potato pancakes,
-- however many are eating". `scale` is 'person' (the default, every line so far: the amount is per
-- person, times the people it feeds) or 'meal' (the amount is for the meal as it stands, once, whenever
-- anybody at all is fed by the line). Troop and scout recipes share mm_recipe_lines, so one column serves both.
-- Variation lines get no column: a swap inherits its base line's scale; an added line is always per person.
--
-- mm_save_recipe and mm_save_scout_recipe are re-created with their latest bodies (20261019100000 and
-- 20261005100000) and one change each: the line insert reads coalesce(line->>'scale', 'person'), so an
-- older caller that sends no scale writes per person. mm_share_scout_recipe and mm_food_link_* never
-- copy lines, so they carry nothing. mm_match_ingredient only rescales qty_per_person in place.
--
-- DEPLOY ORDER: DB-first (additive column with a default; the old code works either way).

alter table public.mm_recipe_lines
  add column if not exists scale text not null default 'person' check (scale in ('person', 'meal'));

comment on column public.mm_recipe_lines.scale is
  'person = qty_per_person is per person fed (default); meal = the amount is for the whole meal, once, whatever the headcount.';

-- ── mm_save_recipe ──────────────────────────────────────────────────────────
create or replace function public.mm_save_recipe(
  p_recipe jsonb,
  p_lines jsonb,
  p_variations jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_recipe->>'id';
  v_line jsonb;
  v_var jsonb;
  v_vline jsonb;
  v_pos integer := 0;
  v_food text;        -- link
  v_author bigint;    -- scout
  v_credit text;      -- scout
  v_shared timestamptz; -- scout
begin
  if v_id is null or v_id = '' then
    raise exception 'recipe id is required';
  end if;

  -- scout: a scout's recipe keeps its author, credit and share date through a leader's save.
  select author_person_id, attribution_label, shared_at into v_author, v_credit, v_shared from mm_recipes where id = v_id;

  -- link: the food this item is, after this save. Sent (null clears) or, for an older caller, what is stored.
  if p_recipe ? 'food_ingredient_id' then
    v_food := nullif(p_recipe->>'food_ingredient_id', '');
  else
    select food_ingredient_id into v_food from mm_recipes where id = v_id;
  end if;
  -- It stays a single food as exactly one EVERYONE line on that food, and only for the troop's own rows
  -- (never a scout's recipe, a typed-in food, or one matched away). Diet swaps are notes on the food and do
  -- not break the link (2026-10-05); p_lines is the COMPILED list, so a swap arrives as an 'only' line beside
  -- the everyone line and only everyone/except lines are counted. Otherwise this save makes it a recipe:
  -- drop the link now, so the name sent below is the name kept.
  if v_food is not null and (
       (select count(*) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
         where coalesce(l->>'serves_rule', 'everyone') in ('everyone', 'except')) <> 1
       or not exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
                       where coalesce(l->>'serves_rule', 'everyone') in ('everyone', 'except') and l->>'ingredient_id' = v_food)
       or exists (select 1 from mm_recipes r where r.id = v_id and r.author_person_id is not null)
       or not exists (select 1 from mm_ingredients i where i.id = v_food and i.added_by_person_id is null and i.merged_into_id is null)
     ) then
    v_food := null;
  end if;
  -- A linked item's name IS the food's name, so a new name here renames the food (and the name trigger
  -- then writes it onto the item). One save, both names.
  if v_food is not null and nullif(btrim(p_recipe->>'name'), '') is not null then
    update mm_ingredients set name = btrim(p_recipe->>'name')
     where id = v_food and name is distinct from btrim(p_recipe->>'name');
  end if;

  insert into mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, equipment, food_ingredient_id,
                          author_person_id, attribution_label, shared_at)
  values (
    v_id,
    p_recipe->>'name',
    coalesce(p_recipe->>'status', 'draft'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'meal_fit', '[]'::jsonb)) x), '{}'::text[]),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_recipe->'food_groups', '[]'::jsonb)) x), '{}'::text[]),
    coalesce((p_recipe->>'camp')::boolean, true),
    coalesce((p_recipe->>'trail')::boolean, false),
    nullif(p_recipe->>'method', ''),
    nullif(p_recipe->>'steps_md', ''),
    coalesce((p_recipe->>'sort_order')::integer, 0),
    -- 4C: gear (at most 20, trimmed, non-empty, each ≤ 40)
    coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p_recipe->'equipment', '[]'::jsonb)) x
              where char_length(btrim(x)) between 1 and 40), '{}'::text[]),
    -- link
    v_food,
    -- scout
    v_author, v_credit, v_shared
  )
  on conflict (id) do update set
    name        = excluded.name,
    status      = excluded.status,
    meal_fit    = excluded.meal_fit,
    food_groups = excluded.food_groups,
    camp        = excluded.camp,
    trail       = excluded.trail,
    method      = excluded.method,
    steps_md    = excluded.steps_md,
    sort_order  = excluded.sort_order,
    -- 4C: an older caller that sends no equipment keeps what is stored.
    equipment   = case when p_recipe ? 'equipment' then excluded.equipment else mm_recipes.equipment end,
    -- link: worked out above (sent, or kept for an older caller, or dropped because it is now a recipe).
    food_ingredient_id = excluded.food_ingredient_id,
    updated_at  = now();

  -- The COMPILED lines, replaced wholesale (positions 1..n in the order sent).
  delete from mm_recipe_lines where recipe_id = v_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions, scale)
    values (
      v_id,
      v_pos,
      v_line->>'ingredient_id',
      (v_line->>'qty_per_person')::numeric,
      nullif(v_line->>'unit_key', ''),
      coalesce(v_line->>'serves_rule', 'everyone'),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(coalesce(v_line->'serves_restrictions', '[]'::jsonb)) x),
        '{}'::text[]
      ),
      coalesce(v_line->>'scale', 'person')
    );
  end loop;

  -- The authoring diffs, replaced wholesale (variation lines cascade).
  delete from mm_recipe_variations where recipe_id = v_id;
  for v_var in select * from jsonb_array_elements(coalesce(p_variations, '[]'::jsonb)) loop
    insert into mm_recipe_variations (recipe_id, restriction, state, note)
    values (v_id, v_var->>'restriction', v_var->>'state', nullif(v_var->>'note', ''));
    v_pos := 0;
    for v_vline in select * from jsonb_array_elements(coalesce(v_var->'lines', '[]'::jsonb)) loop
      v_pos := v_pos + 1;
      insert into mm_variation_lines (recipe_id, restriction, position, op, base_ingredient_id, ingredient_id, qty_per_person, unit_key)
      values (
        v_id,
        v_var->>'restriction',
        v_pos,
        v_vline->>'op',
        nullif(v_vline->>'base_ingredient_id', ''),
        nullif(v_vline->>'ingredient_id', ''),
        nullif(v_vline->>'qty_per_person', '')::numeric,
        nullif(v_vline->>'unit_key', '')
      );
    end loop;
  end loop;

  -- link: the deferred constraint triggers re-check the same rule at commit, for every other writer of lines.
end;
$$;

revoke execute on function public.mm_save_recipe(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ── mm_save_scout_recipe ────────────────────────────────────────────────────
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
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions, scale)
    values (v_id, v_pos, v_ing.id, least(v_qty, 1000), nullif(v_line->>'unit_key', ''), 'everyone', '{}'::text[], coalesce(v_line->>'scale', 'person'));
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
