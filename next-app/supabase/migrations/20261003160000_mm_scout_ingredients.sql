-- Menu Monster Phase 4B: typed-in ingredients on scout recipes, and leader
-- matching (Plans/Menu-Monster-Scout-Workspace.md, "Phase 4 design (revised
-- 2026-10-02 …)" › Typed-in ingredients).
--
-- A scout writing a recipe can add an ingredient the price book doesn't have:
-- name, how it's measured, one package (size + price, store optional) and what
-- it contains (diet ticks, unverified). It becomes a REAL mm_ingredients row +
-- one mm_packages row (a shared recipe's lines need FK targets), flagged
-- needs_match_at, and stays private to its author until a recipe using it is
-- shared (shared_at). A leader then matches it to a book ingredient
-- (mm_match_ingredient re-points every recipe line, retires the typed-in and
-- records merged_into_id + merge_factor so menus resolve the alias on read) or
-- keeps it as a new ingredient (clears needs_match_at).
--
-- DEPLOY ORDER: DB-first. Additive columns; mm_save_scout_recipe gains a
-- defaulted p_new_ingredients, so the 4A code's 4-argument call keeps working.
-- Posture (D-239): RLS on, zero policies, EXECUTE revoked on the RPCs.

-- ── 1. mm_ingredients columns ─────────────────────────────────────────────

alter table public.mm_ingredients
  add column added_by_person_id bigint references public.people (id) on delete restrict,
  add column needs_match_at timestamptz,
  add column shared_at timestamptz,
  add column merged_into_id text references public.mm_ingredients (id) on delete restrict,
  add column merge_factor numeric check (merge_factor is null or merge_factor > 0);

-- A scout's typed-in ingredient has an x-<8 hex> id AND an author; book ingredients neither.
alter table public.mm_ingredients
  add constraint mm_ingredients_scout_id_author_chk
    check ((added_by_person_id is null) = (id !~ '^x-[0-9a-f]{8}$'));

-- A merged-away ingredient is retired and carries its factor.
alter table public.mm_ingredients
  add constraint mm_ingredients_merged_chk
    check (merged_into_id is null or (retired_at is not null and merge_factor is not null and merged_into_id <> id));

create index mm_ingredients_needs_match_idx on public.mm_ingredients (needs_match_at)
  where needs_match_at is not null;
create index mm_ingredients_added_by_idx on public.mm_ingredients (added_by_person_id)
  where added_by_person_id is not null;

-- ── 2a. mm_drop_orphan_typed_ins ──────────────────────────────────────────
-- A scout's private (never shared), unmatched typed-ins that no recipe line
-- uses any more: deleted with their package. Called at the end of every save
-- and draft delete, under the scout's save lock.

create or replace function public.mm_drop_orphan_typed_ins(p_person bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from mm_packages p
  using mm_ingredients i
  where p.ingredient_id = i.id and i.added_by_person_id = p_person and i.shared_at is null and i.needs_match_at is not null
    and not exists (select 1 from mm_recipe_lines l where l.ingredient_id = i.id)
    and not exists (select 1 from mm_price_history h where h.package_id = p.id);
  delete from mm_ingredients i
  where i.added_by_person_id = p_person and i.shared_at is null and i.needs_match_at is not null
    and not exists (select 1 from mm_recipe_lines l where l.ingredient_id = i.id)
    and not exists (select 1 from mm_packages p where p.ingredient_id = i.id)
    and not exists (select 1 from mm_variation_lines v where v.ingredient_id = i.id or v.base_ingredient_id = i.id)
    and not exists (select 1 from mm_conversions c where c.ingredient_id = i.id);
end;
$$;

revoke execute on function public.mm_drop_orphan_typed_ins(bigint) from public, anon, authenticated;

-- ── 2. mm_save_scout_recipe v2 ────────────────────────────────────────────
-- Same contract as 4A, plus the recipe's equipment (gear, 4C) and p_new_ingredients: [{ key: 'new:<8 hex>', name,
-- kind: count|volume|weight, unit_one, unit_many, avoid: [...], package:
-- { size, price, store } }] where `size` is already in the recipe unit (count:
-- how many; volume: cups; weight: oz). Lines may name 'new:<key>' for one of
-- them. A line on an ingredient a leader has since matched away resolves to its
-- target (qty × merge_factor). A line may only use a book ingredient, the
-- scout's own typed-in, or one a shared recipe already revealed.
-- Returns { updated_at, ids: { 'new:<key>': 'x-<hex>' } }.

drop function if exists public.mm_save_scout_recipe(bigint, jsonb, jsonb, timestamptz);

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
  v_kind text;
  v_one text;
  v_many text;
  v_new_name text;
  v_size numeric;
  v_price numeric;
  v_store text;
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

  -- Typed-in ingredients: validated, capped at 10 unmatched per scout, never a
  -- name the book already has, priced from the scout's own entry.
  for v_new in select * from jsonb_array_elements(coalesce(p_new_ingredients, '[]'::jsonb)) loop
    v_key := v_new->>'key';
    v_kind := v_new->>'kind';
    v_new_name := btrim(coalesce(v_new->>'name', ''));
    v_one := btrim(coalesce(v_new->>'unit_one', ''));
    v_many := btrim(coalesce(v_new->>'unit_many', ''));
    v_size := nullif(v_new->'package'->>'size', '')::numeric;
    v_price := nullif(v_new->'package'->>'price', '')::numeric;
    v_store := nullif(btrim(coalesce(v_new->'package'->>'store', '')), '');
    if v_key is null or v_key !~ '^new:[0-9a-f]{8}$' or v_ids ? v_key then
      raise exception 'MM_BAD_INGREDIENT: key';
    end if;
    if char_length(v_new_name) < 1 or not mm_scout_text_ok(v_new_name, 60) then
      raise exception 'MM_BAD_TEXT: ingredient';
    end if;
    if v_kind not in ('count', 'volume', 'weight') then
      raise exception 'MM_BAD_INGREDIENT: kind';
    end if;
    if v_kind = 'count' and (char_length(v_one) < 1 or char_length(v_many) < 1 or not mm_scout_text_ok(v_one, 20) or not mm_scout_text_ok(v_many, 20)) then
      raise exception 'MM_BAD_TEXT: unit';
    end if;
    if v_size is null or v_size <= 0 or v_size > 100000 or v_price is null or v_price < 0.10 or v_price > 500 then
      raise exception 'MM_BAD_INGREDIENT: package';
    end if;
    if v_store is not null and not mm_scout_text_ok(v_store, 40) then
      raise exception 'MM_BAD_TEXT: store';
    end if;
    if exists (select 1 from mm_ingredients i where lower(i.name) = lower(v_new_name) and i.retired_at is null
               and (i.added_by_person_id is null or i.added_by_person_id = p_person or i.shared_at is not null)) then
      raise exception 'MM_DUPLICATE_INGREDIENT: %', v_new_name;
    end if;
    select count(*) into v_count from mm_ingredients
      where added_by_person_id = p_person and needs_match_at is not null and retired_at is null;
    if v_count >= 10 then
      raise exception 'MM_INGREDIENT_CAP';
    end if;

    v_new_id := 'x-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid,
                                added_by_person_id, needs_match_at)
    values (
      v_new_id,
      v_new_name,
      v_kind,
      case v_kind when 'volume' then 'cup' when 'weight' then 'ozw' else 'count' end,
      case v_kind when 'volume' then 'cup' when 'weight' then 'oz' else v_one end,
      case v_kind when 'volume' then 'cups' when 'weight' then 'oz' else v_many end,
      'dry',
      false,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_new->'avoid', '[]'::jsonb)) x
                where x in ('gf', 'nut', 'dairy', 'veg')), '{}'::text[]),
      p_person,
      v_now
    );
    insert into mm_packages (id, ingredient_id, name, store, price, anchor_price, yield, noun, as_of, added_by_person_id)
    values (
      'xp-' || substr(v_new_id, 3),
      v_new_id,
      v_new_name,
      v_store,
      round(v_price, 2),
      round(v_price, 2),
      v_size,
      'pack',
      current_date,
      p_person
    );
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
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
    values (v_id, v_pos, v_ing.id, least(v_qty, 1000), nullif(v_line->>'unit_key', ''), 'everyone', '{}'::text[]);
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

-- ── 3. mm_share_scout_recipe: reveal the recipe's typed-ins ───────────────

create or replace function public.mm_share_scout_recipe(
  p_person bigint,
  p_id text,
  p_label text
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row mm_recipes%rowtype;
  v_lines integer;
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  if p_label is null or char_length(btrim(p_label)) < 1 or not mm_scout_text_ok(btrim(p_label), 40) then
    raise exception 'MM_BAD_TEXT: credit';
  end if;

  select * into v_row from mm_recipes where id = p_id for update;
  if not found or v_row.author_person_id is distinct from p_person then
    raise exception 'MM_NOT_YOURS';
  end if;
  if v_row.status = 'retired' then
    raise exception 'MM_RETIRED';
  end if;
  if v_row.status = 'published' then
    return v_row.shared_at;
  end if;
  select count(*) into v_lines from mm_recipe_lines where recipe_id = p_id;
  if v_lines = 0 or cardinality(v_row.meal_fit) = 0 then
    raise exception 'MM_NOT_READY';
  end if;

  update mm_ingredients set shared_at = now()
  where shared_at is null and added_by_person_id = p_person
    and id in (select ingredient_id from mm_recipe_lines where recipe_id = p_id);

  update mm_recipes set
    status = 'published',
    shared_at = coalesce(shared_at, now()),
    attribution_label = coalesce(attribution_label, btrim(p_label))
  where id = p_id
  returning shared_at into v_row.shared_at;
  return v_row.shared_at;
end;
$$;

revoke execute on function public.mm_share_scout_recipe(bigint, text, text) from public, anon, authenticated;

-- ── 4. mm_match_ingredient ─────────────────────────────────────────────────
-- A leader matches a scout's typed-in ingredient to a book ingredient:
-- 1 <typed-in unit> = p_factor <target unit>. Every recipe line on it moves to
-- the target (qty × factor; a recipe that already has the target adds into
-- that line), variation lines follow, its package retires, and it retires as
-- merged_into_id / merge_factor so menus resolve the alias on read.
-- Returns the number of recipe lines moved.

create or replace function public.mm_match_ingredient(p_from text, p_to text, p_factor numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from mm_ingredients%rowtype;
  v_to mm_ingredients%rowtype;
  v_moved integer;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'MM_BAD_MATCH: same ingredient';
  end if;
  if p_factor is null or p_factor <= 0 or p_factor > 100000 then
    raise exception 'MM_BAD_MATCH: factor';
  end if;
  -- Lock both in id order so two matches can't deadlock.
  perform 1 from mm_ingredients where id in (p_from, p_to) order by id for update;
  select * into v_from from mm_ingredients where id = p_from;
  select * into v_to from mm_ingredients where id = p_to;
  if v_from.id is null or v_from.added_by_person_id is null or v_from.needs_match_at is null or v_from.retired_at is not null then
    raise exception 'MM_BAD_MATCH: not a typed-in ingredient waiting for a match';
  end if;
  if v_to.id is null or v_to.retired_at is not null or v_to.merged_into_id is not null or v_to.needs_match_at is not null then
    raise exception 'MM_BAD_MATCH: target';
  end if;

  -- A recipe that measures the target in another unit can't take the typed-in
  -- amount (it is in the target's own unit): the leader edits that recipe first.
  if exists (
    select 1 from mm_recipe_lines f join mm_recipe_lines t on t.recipe_id = f.recipe_id and t.ingredient_id = p_to
    where f.ingredient_id = p_from and t.unit_key is not null
  ) then
    raise exception 'MM_BAD_MATCH: a recipe that uses it measures the target in another unit; edit that recipe first';
  end if;

  -- Recipes that already use the target: add into that line, drop the typed-in line.
  update mm_recipe_lines t set qty_per_person = least(t.qty_per_person + f.qty_per_person * p_factor, 1000)
  from mm_recipe_lines f
  where f.ingredient_id = p_from and t.recipe_id = f.recipe_id and t.ingredient_id = p_to;
  delete from mm_recipe_lines f
  where f.ingredient_id = p_from
    and exists (select 1 from mm_recipe_lines t where t.recipe_id = f.recipe_id and t.ingredient_id = p_to);
  update mm_recipe_lines set ingredient_id = p_to, qty_per_person = least(qty_per_person * p_factor, 1000), unit_key = null
  where ingredient_id = p_from;
  get diagnostics v_moved = row_count;

  update mm_variation_lines set ingredient_id = p_to, qty_per_person = qty_per_person * p_factor where ingredient_id = p_from;
  update mm_variation_lines set base_ingredient_id = p_to where base_ingredient_id = p_from;

  update mm_packages set retired_at = now() where ingredient_id = p_from and retired_at is null;
  update mm_ingredients set
    merged_into_id = p_to,
    merge_factor = p_factor,
    needs_match_at = null,
    retired_at = now()
  where id = p_from;
  return v_moved;
end;
$$;

revoke execute on function public.mm_match_ingredient(text, text, numeric) from public, anon, authenticated;

-- ── 4b. mm_delete_scout_draft: also drop the typed-ins only it used ───────
-- Body is the 20261003150000 definition plus the line marked "4B".

create or replace function public.mm_delete_scout_draft(p_person bigint, p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row mm_recipes%rowtype;
begin
  if p_person is null then
    raise exception 'MM_SCOUT_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));
  select * into v_row from mm_recipes where id = p_id for update;
  if not found or v_row.author_person_id is distinct from p_person then
    raise exception 'MM_NOT_YOURS';
  end if;
  if v_row.shared_at is not null or v_row.status <> 'draft' then
    raise exception 'MM_SHARED';
  end if;
  if exists (
    select 1 from mm_menus m
    where m.owner_person_id = p_person
      and m.meals @> jsonb_build_array(jsonb_build_object('recipeIds', jsonb_build_array(p_id)))
  ) then
    raise exception 'MM_IN_USE';
  end if;
  delete from mm_recipe_lines where recipe_id = p_id;
  delete from mm_recipes where id = p_id;
  -- 4B: the private typed-ins only this draft used.
  perform mm_drop_orphan_typed_ins(p_person);
  return v_row.name;
end;
$$;

revoke execute on function public.mm_delete_scout_draft(bigint, text) from public, anon, authenticated;

-- ── 5. merge_people: + mm_ingredients.added_by_person_id ───────────────────
-- Body is the 20261003150000 definition plus the one line marked "Phase 4B".

CREATE OR REPLACE FUNCTION public.merge_people(p_survivor bigint, p_loser bigint, p_decided_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_survivor people%rowtype;
  v_loser people%rowtype;
  v_conflict_event bigint;
begin
  if p_survivor = p_loser then
    raise exception 'Cannot merge a person into themselves';
  end if;

  select * into v_survivor from people where id = p_survivor for update;
  if not found then raise exception 'Person to keep not found'; end if;
  select * into v_loser from people where id = p_loser for update;
  if not found then raise exception 'Duplicate not found'; end if;

  if v_survivor.merged_into_person_id is not null then
    raise exception 'The person you are keeping has itself already been merged away';
  end if;
  if v_loser.merged_into_person_id is not null then
    raise exception 'That duplicate has already been merged';
  end if;

  -- Guest promotion (Plans/Guests-As-People.md): the merged identity is a
  -- member if either side was one.
  if v_survivor.guest_host_household_id is not null and v_loser.guest_host_household_id is null then
    update people set guest_host_household_id = null, updated_at = now() where id = p_survivor;
  end if;
  if v_loser.guest_host_household_id is not null then
    update people set guest_host_household_id = null where id = p_loser;
  end if;

  update people set
    first_name    = coalesce(first_name, v_loser.first_name),
    last_name     = coalesce(last_name, v_loser.last_name),
    birthdate     = coalesce(birthdate, v_loser.birthdate),
    gender        = coalesce(gender, v_loser.gender),
    primary_email = coalesce(nullif(primary_email, ''), v_loser.primary_email),
    primary_phone = coalesce(nullif(primary_phone, ''), v_loser.primary_phone),
    bsa_member_id = coalesce(nullif(bsa_member_id, ''), v_loser.bsa_member_id),
    updated_at    = now()
  where id = p_survivor;

  update scouts        set person_id = p_survivor where person_id = p_loser;

  -- mm_*: Menu Monster workspace references (menus a scout owns, prices they
  -- reported or a leader decided, packages they added).
  update public.mm_menus set owner_person_id = p_survivor where owner_person_id = p_loser;
  update public.mm_price_history set reported_by_person_id = p_survivor where reported_by_person_id = p_loser;
  update public.mm_price_history set decided_by_person_id = p_survivor where decided_by_person_id = p_loser;
  update public.mm_packages set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  -- Phase 4: recipes a scout wrote (the frozen credit text stays as it was).
  update public.mm_recipes set author_person_id = p_survivor where author_person_id = p_loser;
  -- Phase 4B: ingredients a scout typed in.
  update public.mm_ingredients set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  update leaders        set person_id = p_survivor where person_id = p_loser;

  -- Addresses: the loser's person_emails move to the survivor. A duplicate
  -- address merges its flags; the loser's primary stays primary only if the
  -- survivor has none (the one-primary index forbids two).
  update public.person_emails surv
  set bounced_at = coalesce(surv.bounced_at, dup.bounced_at),
      unsubscribed_at = coalesce(surv.unsubscribed_at, dup.unsubscribed_at),
      verified_at = coalesce(surv.verified_at, dup.verified_at)
  from public.person_emails dup
  where surv.person_id = p_survivor and dup.person_id = p_loser
    and lower(trim(dup.email)) = lower(trim(surv.email));
  update public.person_emails pe
  set person_id = p_survivor,
      is_primary = pe.is_primary and not exists (
        select 1 from public.person_emails x where x.person_id = p_survivor and x.is_primary
      )
  where pe.person_id = p_loser
    and not exists (
      select 1 from public.person_emails x
      where x.person_id = p_survivor and lower(trim(x.email)) = lower(trim(pe.email))
    );
  delete from public.person_emails where person_id = p_loser;

  insert into household_members (household_id, person_id)
  select hm.household_id, p_survivor
  from household_members hm where hm.person_id = p_loser
  on conflict do nothing;
  delete from household_members where person_id = p_loser;

  insert into person_roles (person_id, role, start_date, end_date, notes)
  select p_survivor, r.role, r.start_date, r.end_date, r.notes
  from person_roles r
  where r.person_id = p_loser
    and not exists (
      select 1 from person_roles x where x.person_id = p_survivor and x.role = r.role
    );
  delete from person_roles where person_id = p_loser;

  insert into relationships (person_id, related_person_id, type, is_guardian, source_label)
  select p_survivor, r.related_person_id, r.type, r.is_guardian, r.source_label
  from relationships r
  where r.person_id = p_loser and r.related_person_id <> p_survivor
  on conflict (person_id, related_person_id, type) do nothing;

  insert into relationships (person_id, related_person_id, type, is_guardian, source_label)
  select r.person_id, p_survivor, r.type, r.is_guardian, r.source_label
  from relationships r
  where r.related_person_id = p_loser and r.person_id <> p_survivor
  on conflict (person_id, related_person_id, type) do nothing;

  delete from relationships where person_id = p_loser or related_person_id = p_loser;

  select se_loser.event_signup_id into v_conflict_event
  from signup_entries se_loser
  join signup_entries se_survivor
    on se_survivor.event_signup_id = se_loser.event_signup_id
   and se_survivor.person_id = p_survivor
   and se_survivor.status <> 'cancelled'
  where se_loser.person_id = p_loser
    and se_loser.status <> 'cancelled'
  limit 1;

  if v_conflict_event is not null then
    raise exception 'MERGE_BLOCKED_DUPLICATE_SIGNUP: both people already have a live signup for event_signup_id % — cancel one via the event Roster before merging', v_conflict_event;
  end if;

  update signup_entries set person_id = p_survivor, updated_at = now() where person_id = p_loser;

  update merge_suggestions m set person_id = p_survivor
  where m.person_id = p_loser
    and not exists (
      select 1 from merge_suggestions m2
      where m2.import_row_id = m.import_row_id and m2.person_id = p_survivor
    );
  delete from merge_suggestions where person_id = p_loser and status = 'pending';

  update people set
    merged_into_person_id = p_survivor,
    -- The loser is a retired identity: it must drop out of every
    -- active-filtered list (rosters, pickers, counts). Found 2026-08-26 —
    -- all 13 merged-away rows were still active.
    active = false,
    notes = trim(coalesce(notes, '') || ' [merged into person ' || p_survivor
            || ' by ' || p_decided_by || ' on ' || now()::date || ']'),
    updated_at = now()
  where id = p_loser;
end;
$function$;
