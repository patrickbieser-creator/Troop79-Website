-- Menu Monster — recipe variations, Migration B (the tightening)
-- (Plans/Completed/Menu-Monster-Recipe-Variations.md). Migration A added
-- mm_recipe_lines.serves_restrictions and kept the single serves_restriction
-- populated so code deployed before v1.125.0 could still read it. v1.125.0 has
-- been live since 2026-09-08 and reads the array only, so the old column and
-- the RPC's dual write go now.
--
--   1. C001's placeholder flour line (0 cups) gets a real amount — the seed's
--      only zero line, and the one thing standing between the draft and a
--      publish.
--   2. drop mm_recipe_lines.serves_restriction (its own check constraint and
--      the rule/restriction check that names it go with it; the array-based
--      constraint from Migration A stays).
--   3. mm_save_recipe v3 — same signature, writes serves_restrictions only.
--      A stale caller still sending serves_restriction on a line is ignored,
--      not honoured: the array is the only channel.
-- EXECUTE stays revoked (D-239). `create or replace` preserves the existing
-- grants; the revoke below is re-issued so this file states the posture.

-- ── 1. the seed's zero line ────────────────────────────────────────────────
-- Cinnamon rolls: ~2 rolls a scout, about half a cup of flour each.

-- The count guard is the point: if a second zero flour line ever appears on
-- C001, that is a recipe nobody has described here and the migration should
-- stop rather than guess at it (qa-lead, 2026-09-09).
do $$
declare v_rows integer;
begin
  update public.mm_recipe_lines
     set qty_per_person = 0.5
   where recipe_id = 'C001'
     and ingredient_id = 'flour'
     and qty_per_person = 0;
  get diagnostics v_rows = row_count;
  if v_rows > 1 then
    raise exception 'C001 flour: expected at most one zero line, found %', v_rows;
  end if;
end $$;

-- ── 2. drop the single-restriction column ──────────────────────────────────

alter table public.mm_recipe_lines
  drop column serves_restriction;

-- ── 3. mm_save_recipe v3 ───────────────────────────────────────────────────

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

  insert into mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order)
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
    coalesce((p_recipe->>'sort_order')::integer, 0)
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
