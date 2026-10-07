-- A leader can delete a troop recipe (Patrick, 2026-10-06: "Allow for the deleting of a recipe in admin").
-- One atomic delete: the check that no saved menu still uses it and the delete itself happen under one row lock,
-- so a menu saved a moment earlier cannot be left pointing at nothing.
--
-- mm_recipe_lines is ON DELETE RESTRICT, so the lines go first; mm_recipe_variations (and its lines) cascade;
-- brand_suggestions and equipment are columns of the row; a scout recipe's origin_recipe_id is SET NULL.
-- Menus hold recipe ids in mm_menus.meals[].recipeIds (jsonb, no foreign key), hence the explicit check.
--
-- Returns one word: 'ok', 'gone' (no such recipe), 'tied' (a single food: take it off the menu instead),
-- 'scout' (a scout's own recipe: it has Retire), 'on_menu' (a saved menu still uses it).
--
-- DEPLOY ORDER: DB-first (a new function; nothing calls it until the code ships).

create or replace function public.mm_delete_recipe(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_food text;
  v_author bigint;
begin
  select food_ingredient_id, author_person_id into v_food, v_author from mm_recipes where id = p_id for update;
  if not found then
    return 'gone';
  end if;
  if v_food is not null then
    return 'tied';
  end if;
  if v_author is not null then
    return 'scout';
  end if;
  if exists (
    select 1 from mm_menus m, jsonb_array_elements(m.meals) meal
     where meal->'recipeIds' ? p_id
  ) then
    return 'on_menu';
  end if;

  delete from mm_recipe_lines where recipe_id = p_id;
  delete from mm_recipes where id = p_id;
  return 'ok';
end;
$$;

revoke execute on function public.mm_delete_recipe(text) from public, anon, authenticated;
grant execute on function public.mm_delete_recipe(text) to service_role;
