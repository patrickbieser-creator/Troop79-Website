-- Leaders may edit a scout's recipe (Patrick, 2026-10-05 — the same rights leaders have on anyone's menu,
-- D-327). mm_save_recipe writes with INSERT ... ON CONFLICT DO UPDATE, and the proposed row is checked
-- before the conflict is seen: for an S- id it failed mm_recipes_scout_id_author_chk (no author on the
-- proposed row) and, for a shared one, the published-needs-a-credit check. So the proposed row now carries
-- the stored author, credit and share date — none of which the update ever changes. A scout recipe stays
-- the scout's: the leader's edit bumps updated_at, which the scout's own editor reads as a version change.
--
-- Body is the 20261015100000 definition plus the lines marked "scout".
-- DEPLOY ORDER: DB-first (function only; the old code sends nothing new).
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
  -- It stays a single food only as exactly one line on that food with no swap line, and only for the
  -- troop's own rows (never a scout's recipe, a typed-in food, or one matched away). Otherwise this save
  -- makes it a recipe: drop the link now, so the name sent below is the name kept.
  if v_food is not null and (
       jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) <> 1
       or (p_lines->0->>'ingredient_id') is distinct from v_food
       or exists (select 1 from jsonb_array_elements(coalesce(p_variations, '[]'::jsonb)) v
                   where jsonb_array_length(coalesce(v->'lines', '[]'::jsonb)) > 0)
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
