-- Menu Monster — a recipe saved under the editor's placeholder id.
--
-- Found 2026-10-05 (Patrick: "cookies are listed under a recipe"): production holds a draft named Cookies
-- whose id is `__new__`, the admin editor's own marker for "a recipe that has not been saved yet". It was
-- saved before saveRecipe refused that marker as an id. The editor treats that id as a blank new recipe, so
-- the row could be listed but never opened or edited.
--
-- Give any such row a real id made from its name (cookies, cookies-2, …). Ids are text keys; a row's
-- ingredient lines and diet swaps are moved with it (their foreign keys do not cascade on update, so the
-- recipe is re-inserted under the new id first). A no-op wherever no such row exists (the local mirror).
do $$
declare
  base text;
  new_id text;
  n int := 1;
begin
  if not exists (select 1 from public.mm_recipes where id = '__new__') then
    return;
  end if;

  select coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'menu-item')
    into base from public.mm_recipes where id = '__new__';
  new_id := base;
  while exists (select 1 from public.mm_recipes where id = new_id) loop
    n := n + 1;
    new_id := base || '-' || n;
  end loop;

  insert into public.mm_recipes
    select (jsonb_populate_record(null::public.mm_recipes, to_jsonb(r) || jsonb_build_object('id', new_id))).*
      from public.mm_recipes r where r.id = '__new__';
  update public.mm_recipe_lines set recipe_id = new_id where recipe_id = '__new__';
  update public.mm_recipe_variations set recipe_id = new_id where recipe_id = '__new__';
  update public.mm_recipes set origin_recipe_id = new_id where origin_recipe_id = '__new__';
  delete from public.mm_recipes where id = '__new__';

  raise notice 'mm_recipes: placeholder id __new__ renamed to %', new_id;
end $$;
