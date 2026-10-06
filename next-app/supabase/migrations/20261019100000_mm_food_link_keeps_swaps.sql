-- A single food keeps its diet swaps (Patrick, 2026-10-05, after Bacon turned into a recipe the moment he
-- gave vegetarians veggie bacon, and "Make it a single food" deleted the swap on the way back): "vegetarians
-- get veggie bacon instead" is a note on Bacon, not a different kind of thing. The tie between a menu item
-- and its food (D-326) now means ONE everyone-line on that food; variation lines no longer clear it, in
-- mm_food_link_check and in mm_save_recipe alike.
--
-- DEPLOY ORDER: DB-first (a loosening; the old code works either way).

-- ── the link holds for one everyone line on that food; swaps are fine ──────────
create or replace function public.mm_food_link_check(p_recipe text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_food text;
  v_author bigint;
begin
  select food_ingredient_id, author_person_id into v_food, v_author from mm_recipes where id = p_recipe;
  if v_food is null then
    return;
  end if;
  if v_author is not null
     or exists (select 1 from mm_ingredients i where i.id = v_food and (i.added_by_person_id is not null or i.merged_into_id is not null))
     or (select count(*) from mm_recipe_lines l where l.recipe_id = p_recipe and l.serves_rule in ('everyone', 'except')) <> 1
     or not exists (select 1 from mm_recipe_lines l where l.recipe_id = p_recipe and l.ingredient_id = v_food and l.serves_rule in ('everyone', 'except'))
  then
    update mm_recipes set food_ingredient_id = null where id = p_recipe and food_ingredient_id is not null;
  end if;
end;
$$;

-- Variation lines no longer bear on the link.
drop trigger if exists mm_food_link_variation_lines on public.mm_variation_lines;

-- ── mm_save_recipe: the same rule before the row is written ────────────────────
-- Body is the 20261017100000 definition with the link test above in place of the old one.
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
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
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
      )
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
