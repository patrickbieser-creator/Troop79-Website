-- Menu Monster Phase 4C: gear on leader recipes (Plans/Menu-Monster-Scout-Workspace.md,
-- "Phase 4 design (revised …)" › Releases › 4C). mm_recipes.equipment exists since
-- 20261003150000; scouts write it through mm_save_scout_recipe (20261003160000). This
-- teaches the leader save, mm_save_recipe, to write it too: an `equipment` array in
-- p_recipe (absent = keep what is stored, so an older caller never wipes it).
--
-- DEPLOY ORDER: DB-first (the old code never sends `equipment`; the stored value is kept).
-- Body is the 20260909130000 (v3) definition plus the lines marked "4C".

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
begin
  if v_id is null or v_id = '' then
    raise exception 'recipe id is required';
  end if;

  insert into mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, equipment)
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
              where char_length(btrim(x)) between 1 and 40), '{}'::text[])
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
end;
$$;

revoke execute on function public.mm_save_recipe(jsonb, jsonb, jsonb) from public, anon, authenticated;
