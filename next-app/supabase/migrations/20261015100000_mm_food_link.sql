-- Menu Monster — a single food is one entry (Plans/Menu-Monster-Single-Food-Entry.md, release 1).
--
-- Patrick, 2026-10-05: the two entries behind a single food (the food in the Price book, and the one-line
-- menu item that puts it on a menu) are "a continuing source of confusion". They stay two rows — a dish
-- such as "Eggs - Hard-boiled" is one ingredient under its own name, and every reader of a menu works on
-- menu-item ids — but they are now TIED, and the database keeps the tie true:
--
--   mm_recipes.food_ingredient_id   set = "this menu item IS that food, served by itself"
--
--   1. one such item per food (unique index);
--   2. it holds only while the item is exactly one ingredient line on that food with no diet-swap line.
--      Anything else CLEARS the link at commit — adding a second ingredient simply makes it a recipe;
--   3. a linked item's name is the food's name: written from the food, and following a rename of the food;
--   4. retiring the food retires its linked item (restoring the food does not put it back on the menu).
--
-- Checks 2 runs as DEFERRED constraint triggers because the writers replace an item's lines wholesale
-- inside one call (mm_save_recipe deletes then re-inserts); it is on the tables, not in one writer, because
-- several functions touch lines (unit changes, scout recipes, typed-in ingredient matches and merges).
--
-- Not for scout-owned rows: a scout's recipe (author_person_id) and a scout's typed-in ingredient
-- (added_by_person_id) are theirs; the troop's food list is the leaders'.
--
-- DEPLOY ORDER: DB-first. Additive; the old code never sends food_ingredient_id and the stored value is kept.

alter table public.mm_recipes
  add column if not exists food_ingredient_id text references public.mm_ingredients(id) on delete set null;

create unique index if not exists mm_recipes_food_ingredient_idx
  on public.mm_recipes (food_ingredient_id)
  where food_ingredient_id is not null;

comment on column public.mm_recipes.food_ingredient_id is
  'Set = this menu item is that food served by itself (one line on it, no swap line). Kept true by mm_food_link_* triggers; cleared when it stops holding.';

-- ── 2. the link holds only for one line on that food ────────────────────────
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
     or (select count(*) from mm_recipe_lines l where l.recipe_id = p_recipe) <> 1
     or not exists (select 1 from mm_recipe_lines l where l.recipe_id = p_recipe and l.ingredient_id = v_food)
     or exists (select 1 from mm_variation_lines v where v.recipe_id = p_recipe)
  then
    update mm_recipes set food_ingredient_id = null where id = p_recipe and food_ingredient_id is not null;
  end if;
end;
$$;

create or replace function public.mm_food_link_on_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform mm_food_link_check(old.recipe_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mm_food_link_check(new.recipe_id);
  end if;
  return null;
end;
$$;

create or replace function public.mm_food_link_on_recipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform mm_food_link_check(new.id);
  return null;
end;
$$;

drop trigger if exists mm_food_link_lines on public.mm_recipe_lines;
create constraint trigger mm_food_link_lines
  after insert or update or delete on public.mm_recipe_lines
  deferrable initially deferred
  for each row execute function public.mm_food_link_on_lines();

drop trigger if exists mm_food_link_variation_lines on public.mm_variation_lines;
create constraint trigger mm_food_link_variation_lines
  after insert or update on public.mm_variation_lines
  deferrable initially deferred
  for each row execute function public.mm_food_link_on_lines();

-- Only when the link is set or changed: clearing it (the check's own UPDATE) does not fire this again.
drop trigger if exists mm_food_link_recipe on public.mm_recipes;
create constraint trigger mm_food_link_recipe
  after insert or update of food_ingredient_id on public.mm_recipes
  deferrable initially deferred
  for each row
  when (new.food_ingredient_id is not null)
  execute function public.mm_food_link_on_recipe();

-- ── 3. one name ─────────────────────────────────────────────────────────────
create or replace function public.mm_food_link_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.food_ingredient_id is not null then
    new.name := coalesce((select i.name from mm_ingredients i where i.id = new.food_ingredient_id), new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists mm_food_link_name on public.mm_recipes;
create trigger mm_food_link_name
  before insert or update of name, food_ingredient_id on public.mm_recipes
  for each row execute function public.mm_food_link_name();

-- ── 3 + 4. the food's rename and retirement reach its linked item ───────────
create or replace function public.mm_food_link_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update mm_recipes set name = new.name, updated_at = now()
     where food_ingredient_id = new.id and name is distinct from new.name;
  end if;
  if old.retired_at is null and new.retired_at is not null and new.merged_into_id is null then
    update mm_recipes set status = 'retired', updated_at = now()
     where food_ingredient_id = new.id and status <> 'retired';
  end if;
  return null;
end;
$$;

drop trigger if exists mm_food_link_follow on public.mm_ingredients;
create trigger mm_food_link_follow
  after update of name, retired_at on public.mm_ingredients
  for each row execute function public.mm_food_link_follow();

-- ── mm_save_recipe: carries the link ────────────────────────────────────────
-- Body is the 20261003170000 definition plus the lines marked "link". An absent
-- `food_ingredient_id` key keeps what is stored (the same convention as `equipment`); null clears it.
-- The link is settled BEFORE the row is written (tech-lead review, 2026-10-05), so that today's editor —
-- which renames only the menu item — renames the food too, and a save that adds a second ingredient keeps
-- the name the leader typed instead of the food's.
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
begin
  if v_id is null or v_id = '' then
    raise exception 'recipe id is required';
  end if;

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

  insert into mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, equipment, food_ingredient_id)
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
    v_food
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

revoke execute on function public.mm_save_recipe(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.mm_food_link_check(text) from public, anon, authenticated;
revoke execute on function public.mm_food_link_on_lines() from public, anon, authenticated;
revoke execute on function public.mm_food_link_on_recipe() from public, anon, authenticated;
revoke execute on function public.mm_food_link_name() from public, anon, authenticated;
revoke execute on function public.mm_food_link_follow() from public, anon, authenticated;

-- ── Backfill: link what is already a single food by the same name ───────────
-- One line, no swap line, the troop's own (no scout author, no typed-in food), and the item's name is its
-- food's name. A dish with its own name ("Eggs - Hard-boiled", "Hot cider" on Hot cider mix) is left alone.
-- A food that two such items would claim is linked to neither.
do $$
declare
  v_linked int;
  v_dishes int;
begin
  with single as (
    select r.id, min(l.ingredient_id) as food
      from mm_recipes r
      join mm_recipe_lines l on l.recipe_id = r.id
     where r.author_person_id is null
       and r.food_ingredient_id is null
       and not exists (select 1 from mm_variation_lines v where v.recipe_id = r.id)
     group by r.id
    having count(*) = 1
  ), named as (
    select s.id, s.food
      from single s
      join mm_recipes r on r.id = s.id
      join mm_ingredients i on i.id = s.food
     where i.added_by_person_id is null
       and lower(btrim(r.name)) = lower(btrim(i.name))
  ), once as (
    select food from named group by food having count(*) = 1
  )
  update mm_recipes r
     set food_ingredient_id = n.food
    from named n
    join once o on o.food = n.food
   where r.id = n.id;
  get diagnostics v_linked = row_count;

  select count(*) into v_dishes
    from mm_recipes r
   where r.author_person_id is null
     and r.food_ingredient_id is null
     and (select count(*) from mm_recipe_lines l where l.recipe_id = r.id) = 1
     and not exists (select 1 from mm_variation_lines v where v.recipe_id = r.id);

  raise notice 'mm food link: linked % single food(s); % one-ingredient item(s) left as dishes under their own name', v_linked, v_dishes;
end $$;
