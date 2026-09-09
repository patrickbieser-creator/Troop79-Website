-- Menu Monster — recipe variations, Migration A (additive)
-- (Plans/Menu-Monster-Recipe-Variations.md). Code-first-for-tightenings rule:
-- this migration only ADDS; the old serves_restriction column stays populated
-- until Migration B drops it after the new code is live.
--
--  1. mm_recipe_lines.serves_restrictions text[] — a line may name several
--     restrictions ("everyone except dairy-free or vegetarian", decision 2).
--     Backfilled from serves_restriction.
--  2. mm_recipe_variations / mm_variation_lines — the authoring source: per
--     (recipe, restriction) a state and a diff on the base (swap / leave_out /
--     add). Backfilled from today's except/only lines so every seed recipe
--     round-trips to the same compiled lines.
--  3. A unique index on the compiled lines: one base line per ingredient is
--     what makes base_ingredient_id an unambiguous reference.
--  4. mm_save_recipe(p_recipe, p_lines, p_variations) — replaces the row, the
--     compiled lines, the variations and their lines in one transaction.
--     Accepts either serves_restrictions (array) or serves_restriction on a
--     line, writes both columns.
-- RLS on with zero policies; EXECUTE revoked (D-239, unchanged).

-- ── 1. serves_restrictions ─────────────────────────────────────────────────

alter table public.mm_recipe_lines
  add column serves_restrictions text[] not null default '{}'
    check (serves_restrictions <@ array['gf', 'nut', 'dairy', 'veg']::text[]);

update public.mm_recipe_lines
   set serves_restrictions = array[serves_restriction]
 where serves_restriction is not null;

alter table public.mm_recipe_lines
  add constraint mm_recipe_lines_rule_restrictions_check
    check ((serves_rule = 'everyone') = (cardinality(serves_restrictions) = 0));

-- One compiled line per (ingredient, rule, restriction set) per recipe — and
-- therefore one BASE line per ingredient (base = rule everyone/except).
create unique index mm_recipe_lines_unique_rule
  on public.mm_recipe_lines (recipe_id, ingredient_id, serves_rule, serves_restrictions);

-- ── 2. the authoring tables ────────────────────────────────────────────────

create table public.mm_recipe_variations (
  recipe_id   text not null references public.mm_recipes(id) on delete cascade,
  restriction text not null check (restriction in ('gf', 'nut', 'dairy', 'veg')),
  -- nothing: a leader confirmed nothing changes (the flag was a false alarm);
  -- substituted: a diff exists; unsuitable: no fix exists, warn when counted.
  state       text not null check (state in ('nothing', 'substituted', 'unsuitable')),
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (recipe_id, restriction)
);
alter table public.mm_recipe_variations enable row level security;

create table public.mm_variation_lines (
  id                 bigint generated always as identity primary key,
  recipe_id          text not null,
  restriction        text not null,
  position           integer not null,
  op                 text not null check (op in ('swap', 'leave_out', 'add')),
  -- swap / leave_out: which base line, by ingredient (base lines are unique per ingredient).
  base_ingredient_id text references public.mm_ingredients(id) on delete restrict,
  -- swap / add: what goes in.
  ingredient_id      text references public.mm_ingredients(id) on delete restrict,
  qty_per_person     numeric check (qty_per_person is null or qty_per_person >= 0),
  unit_key           text,
  foreign key (recipe_id, restriction) references public.mm_recipe_variations(recipe_id, restriction) on delete cascade,
  check ((op in ('swap', 'leave_out')) = (base_ingredient_id is not null)),
  check ((op in ('swap', 'add')) = (ingredient_id is not null and qty_per_person is not null)),
  unique (recipe_id, restriction, position)
);
alter table public.mm_variation_lines enable row level security;

-- ── Backfill: today's except/only lines → diffs ────────────────────────────
-- Every restriction a recipe's lines name becomes a 'substituted' variation:
-- an "except R" line is a leave_out of that ingredient, an "only R" line an
-- add. A standalone leave-out (D001 chicken for vegetarians) stays a
-- substitution so the compiled lines — and the shopping math — are unchanged.

insert into public.mm_recipe_variations (recipe_id, restriction, state)
select distinct l.recipe_id, r.key, 'substituted'
  from public.mm_recipe_lines l
 cross join lateral unnest(l.serves_restrictions) as r(key)
 where l.serves_rule <> 'everyone';

with ordered as (
  select l.recipe_id,
         r.key as restriction,
         case when l.serves_rule = 'except' then 'leave_out' else 'add' end as op,
         case when l.serves_rule = 'except' then l.ingredient_id end as base_ingredient_id,
         case when l.serves_rule = 'only' then l.ingredient_id end as ingredient_id,
         case when l.serves_rule = 'only' then l.qty_per_person end as qty_per_person,
         case when l.serves_rule = 'only' then l.unit_key end as unit_key,
         row_number() over (partition by l.recipe_id, r.key order by (l.serves_rule = 'only'), l.position) as position
    from public.mm_recipe_lines l
   cross join lateral unnest(l.serves_restrictions) as r(key)
   where l.serves_rule <> 'everyone'
)
insert into public.mm_variation_lines (recipe_id, restriction, position, op, base_ingredient_id, ingredient_id, qty_per_person, unit_key)
select recipe_id, restriction, position, op, base_ingredient_id, ingredient_id, qty_per_person, unit_key
  from ordered;

-- ── 4. mm_save_recipe v2 ───────────────────────────────────────────────────

drop function if exists public.mm_save_recipe(jsonb, jsonb);

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
  v_restrictions text[];
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
    v_restrictions := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_line->'serves_restrictions', '[]'::jsonb)) x),
      case when nullif(v_line->>'serves_restriction', '') is not null then array[v_line->>'serves_restriction'] else '{}'::text[] end
    );
    insert into mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions, serves_restriction)
    values (
      v_id,
      v_pos,
      v_line->>'ingredient_id',
      (v_line->>'qty_per_person')::numeric,
      nullif(v_line->>'unit_key', ''),
      coalesce(v_line->>'serves_rule', 'everyone'),
      v_restrictions,
      v_restrictions[1]
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
