-- Menu Monster — a recipe's suggested brands (Plans/Menu-Monster-Brands-Gear.md, release 6).
--
-- Patrick, 2026-10-03: "Recipes can have a brand suggestion, but a person using that recipe would be able to
-- overwrite it." One suggested brand per ingredient of the recipe: when the recipe is added to a menu that
-- has not chosen a brand for that ingredient yet, the suggestion is chosen — and is then an ordinary choice
-- the planner can change.
--
--   mm_recipes.brand_suggestions   { ingredientId: brandId }
--   mm_suggest_recipe_brand        set or clear one. p_person = the recipe's author; null = a leader (the
--                                  server action has checked the capability). The brand must be a live brand
--                                  of that ingredient, and the ingredient one the recipe uses.
--
-- DEPLOY ORDER: DB-first. Additive; the new code selects the column. EXECUTE revoked (D-239).

alter table public.mm_recipes add column if not exists brand_suggestions jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mm_recipes_brand_suggestions_chk') then
    alter table public.mm_recipes add constraint mm_recipes_brand_suggestions_chk check (jsonb_typeof(brand_suggestions) = 'object');
  end if;
end $$;

create or replace function public.mm_suggest_recipe_brand(p_recipe text, p_person bigint, p_ingredient text, p_brand text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author bigint;
begin
  select author_person_id into v_author from mm_recipes where id = p_recipe for update;
  if not found then
    return false;
  end if;
  if p_person is not null and v_author is distinct from p_person then
    raise exception 'MM_NOT_YOURS';
  end if;
  if p_brand is null then
    update mm_recipes set brand_suggestions = brand_suggestions - p_ingredient where id = p_recipe;
    return true;
  end if;
  if not exists (select 1 from mm_brands where id = p_brand and ingredient_id = p_ingredient and retired_at is null)
     or not exists (select 1 from mm_recipe_lines where recipe_id = p_recipe and ingredient_id = p_ingredient) then
    raise exception 'MM_BAD_BRAND';
  end if;
  update mm_recipes set brand_suggestions = jsonb_set(brand_suggestions, array[p_ingredient], to_jsonb(p_brand), true) where id = p_recipe;
  return true;
end;
$$;

revoke execute on function public.mm_suggest_recipe_brand(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.mm_suggest_recipe_brand(text, bigint, text, text) to service_role;
