-- Menu Monster phase 2 — leader tools (Plans/Menu-Monster-Leader-Tools.md).
--
-- No new tables. Two functions the admin editors call through the service
-- role so that a recipe's row + lines, and an ingredient's unit change
-- (unit + every package yield + every implicit recipe line), each land in
-- ONE transaction. RLS on the mm_* tables stays on with zero policies
-- (D-051 / D-239); EXECUTE is revoked from anon and authenticated so the
-- functions are reachable only with the service role, like every other
-- write path in this schema.
--
-- The PLAN for a unit change (which yields become what, which lines get the
-- old unit pinned) is computed and previewed in TypeScript
-- (lib/menu-monster/authoring.ts changeUnitPlan); this function applies it
-- verbatim. Keeping the arithmetic in one place keeps it unit-tested.

-- ── mm_save_recipe ─────────────────────────────────────────────────────────

create or replace function public.mm_save_recipe(
  p_recipe jsonb,
  p_lines jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_recipe->>'id';
  v_line jsonb;
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

  -- Replace the lines wholesale: positions are 1..n in the order sent. The
  -- FK's `on delete restrict` guards the RECIPE row, not its lines.
  delete from mm_recipe_lines where recipe_id = v_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restriction)
    values (
      v_id,
      v_pos,
      v_line->>'ingredient_id',
      (v_line->>'qty_per_person')::numeric,
      nullif(v_line->>'unit_key', ''),
      coalesce(v_line->>'serves_rule', 'everyone'),
      nullif(v_line->>'serves_restriction', '')
    );
  end loop;
end;
$$;

revoke execute on function public.mm_save_recipe(jsonb, jsonb) from public, anon, authenticated;

-- ── mm_change_ingredient_unit ──────────────────────────────────────────────

create or replace function public.mm_change_ingredient_unit(
  p_ingredient_id text,
  p_unit jsonb,
  p_package_yields jsonb,
  p_pin_unit text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg jsonb;
begin
  update mm_ingredients
     set unit_kind = p_unit->>'kind',
         unit_key  = p_unit->>'key',
         unit_one  = p_unit->>'one',
         unit_many = p_unit->>'many'
   where id = p_ingredient_id;
  if not found then
    raise exception 'ingredient % not found', p_ingredient_id;
  end if;

  -- Each entry: { id, yield (number | null), yield_unit_label (text | null) }.
  for v_pkg in select * from jsonb_array_elements(coalesce(p_package_yields, '[]'::jsonb)) loop
    update mm_packages
       set yield = nullif(v_pkg->>'yield', '')::numeric,
           yield_unit_label = nullif(v_pkg->>'yield_unit_label', '')
     where id = v_pkg->>'id' and ingredient_id = p_ingredient_id;
  end loop;

  -- Lines that relied on "no unit = the recipe unit" keep meaning what they
  -- meant: pin the OLD unit on them. Null = a noun-only rename, nothing to pin.
  if p_pin_unit is not null then
    update mm_recipe_lines
       set unit_key = p_pin_unit
     where ingredient_id = p_ingredient_id and unit_key is null;
  end if;
end;
$$;

revoke execute on function public.mm_change_ingredient_unit(text, jsonb, jsonb, text) from public, anon, authenticated;
