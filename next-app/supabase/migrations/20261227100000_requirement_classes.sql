-- Requirement classes (Plans/Requirement-Classification.md, step 1, Patrick 2026-10-28).
--
-- A class is a TAG saying where a requirement can be done: M Troop meeting, C Campout, O Outdoor event, A Aquatics,
-- S Service project, H Home / independent, E Expert / external visit, L Leadership / administrative. A requirement
-- carries any number of tags, or none — no precedence, no "most limiting" rule (Patrick: groupings and class
-- assignments stay dynamic and flexible). Suggestions lists a requirement when one of its tags fits the gathering;
-- an empty list inherits the parent's tags, and empty all the way up reads as M.
--
-- Backfill keeps today's planner exactly: every venue = 'outing' row gets one or more of C/O/A/S (never M), and every
-- key in lib/rank-calculus NOT_PLANNABLE gets L. Everything else starts untagged (= M, today's 'either'). venue and
-- NOT_PLANNABLE are retired in step 3, once the engine reads the tags.
--
-- Codes can't be changed (tags are stored by code), so the tags are a char(1)[] with a trigger instead of a join
-- table. A class in use can't be deleted (retire it instead). Retired-ness is the server action's check: a retired
-- tag already on a requirement survives a merit badge editor save.
--
-- Posture (D-051 / D-239): RLS on, no policies (service role only); functions invoker, search_path pinned, EXECUTE
-- revoked from public/anon/authenticated. Additive: DEPLOY ORDER DB-first, then the code.

create table public.requirement_classes (
  code char(1) primary key check (code ~ '^[A-Z]$'),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  sort_order int not null default 0,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.requirement_classes enable row level security;

insert into public.requirement_classes (code, name, description, sort_order) values
  ('M', 'Troop meeting', 'Can normally be completed in a 90-minute meeting with appropriate materials and instruction.', 10),
  ('C', 'Campout', 'Requires an overnight campout, or is explicitly tied to campout activities.', 20),
  ('O', 'Outdoor event', 'Requires a hike, nature activity, field exercise, or outdoor location but not necessarily overnight camping.', 30),
  ('A', 'Aquatics', 'Requires water, a pool, or appropriately supervised aquatic facilities.', 40),
  ('S', 'Service project', 'Requires actual participation in qualifying service, often with minimum hours.', 50),
  ('H', 'Home / independent', 'Requires family involvement, a personal project, tracking over time, or independent effort.', 60),
  ('E', 'Expert / external visit', 'Requires a meeting with a designated professional, public official, or other approved individual.', 70),
  ('L', 'Leadership / administrative', 'Requires leadership service, elapsed time, or special approval. (Scoutmaster conferences are M: the planner suggests them at 95%.)', 80);

create or replace function public.requirement_classes_guard() returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_used int;
begin
  if tg_op = 'UPDATE' then
    if new.code <> old.code then
      raise exception 'A requirement class code can''t be changed (% → %). Add a new class and retire this one.', old.code, new.code;
    end if;
    return new;
  end if;
  select (select count(*) from rank_requirements where old.code = any(class_codes))
       + (select count(*) from merit_badge_requirements where old.code = any(class_codes))
    into v_used;
  if v_used > 0 then
    raise exception 'Class % is in use by % requirement%. Retire it instead.', old.code, v_used, case when v_used = 1 then '' else 's' end;
  end if;
  return old;
end;
$$;

create trigger requirement_classes_guard
  before update or delete on public.requirement_classes
  for each row execute function public.requirement_classes_guard();

alter table public.rank_requirements add column class_codes char(1)[] not null default '{}';
alter table public.merit_badge_requirements add column class_codes char(1)[] not null default '{}';

create or replace function public.requirement_class_codes_check() returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bad text;
begin
  select c into v_bad
    from unnest(new.class_codes) as c
   where c is null or not exists (select 1 from requirement_classes rc where rc.code = c)
   limit 1;
  if found then
    raise exception 'Unknown requirement class %', coalesce(v_bad, 'null');
  end if;
  if cardinality(new.class_codes) <> (select count(distinct c) from unnest(new.class_codes) as c) then
    raise exception 'A requirement class is listed twice';
  end if;
  return new;
end;
$$;

create trigger rank_requirements_class_codes_check
  before insert or update of class_codes on public.rank_requirements
  for each row execute function public.requirement_class_codes_check();
create trigger merit_badge_requirements_class_codes_check
  before insert or update of class_codes on public.merit_badge_requirements
  for each row execute function public.requirement_class_codes_check();

-- ── backfill: venue = 'outing' (curated in 20260711000000) ────────────────
update public.rank_requirements set class_codes = '{C}'
  where venue = 'outing' and (rank_id, code) in (
    ('tenderfoot', '1a'), ('tenderfoot', '1b'), ('tenderfoot', '2a'), ('tenderfoot', '2b'), ('tenderfoot', '2c'),
    ('second-class', '1c'), ('second-class', '2e'), ('first-class', '2e'));
update public.rank_requirements set class_codes = '{C,O}'
  where venue = 'outing' and (rank_id, code) in (
    ('tenderfoot', '1c'), ('tenderfoot', '5a'), ('second-class', '1a'), ('first-class', '1a'));
update public.rank_requirements set class_codes = '{O}'
  where venue = 'outing' and (rank_id, code) in (('second-class', '3b'), ('first-class', '4a'), ('first-class', '4b'));
update public.rank_requirements set class_codes = '{A}'
  where venue = 'outing' and (rank_id, code) in (
    ('second-class', '5b'), ('second-class', '5c'), ('second-class', '5d'),
    ('first-class', '6a'), ('first-class', '6d'), ('first-class', '6e'));
update public.rank_requirements set class_codes = '{S}'
  where venue = 'outing' and (rank_id, code) in (
    ('tenderfoot', '7b'), ('second-class', '8e'), ('first-class', '9d'), ('star', '4'), ('life', '4'));

update public.merit_badge_requirements set class_codes = '{C}'
  where venue = 'outing' and mb_id = 'camping' and code in ('9', '9a', '9b(5)');
update public.merit_badge_requirements set class_codes = '{O}'
  where venue = 'outing' and mb_id = 'camping' and code in ('9b', '9b(1)', '9b(2)', '9b(3)', '9b(6)');
update public.merit_badge_requirements set class_codes = '{A,O}'
  where venue = 'outing' and mb_id = 'camping' and code = '9b(4)';
update public.merit_badge_requirements set class_codes = '{S,O}'
  where venue = 'outing' and mb_id = 'camping' and code = '9c';
update public.merit_badge_requirements set class_codes = '{O}'
  where venue = 'outing' and mb_id = 'environmental-science' and code in ('2a', '2b');

-- Any outing row the lists above missed (a later curation) still leaves the meeting: Outdoor event.
update public.rank_requirements set class_codes = '{O}' where venue = 'outing' and class_codes = '{}';
update public.merit_badge_requirements set class_codes = '{O}' where venue = 'outing' and class_codes = '{}';

-- ── backfill: lib/rank-calculus NOT_PLANNABLE → L ─────────────────────────
update public.rank_requirements set class_codes = '{L}'
  where (rank_id, code) in (
    ('scout', '1b'), ('tenderfoot', '9'), ('second-class', '10'), ('first-class', '11'),
    ('star', '1'), ('star', '2'), ('star', '3'), ('star', '5'),
    ('life', '1'), ('life', '2'), ('life', '3'), ('life', '5'), ('life', '6'),
    ('eagle', '1'), ('eagle', '2'), ('eagle', '3'), ('eagle', '4'), ('eagle', '5'));

-- ── the Merit Badge Catalog save carries the tags through its rewrite ─────
create or replace function public._insert_merit_badge_requirement_nodes(
  p_mb_id text,
  p_nodes jsonb,
  p_parent bigint,
  p_kept jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_node jsonb;
  v_code text;
  v_label text;
  v_rule text;
  v_carry jsonb;
  v_id bigint;
  v_sort integer := 0;
begin
  if p_nodes is null or jsonb_typeof(p_nodes) <> 'array' then
    return;
  end if;
  for v_node in select value from jsonb_array_elements(p_nodes) loop
    v_code := btrim(coalesce(v_node->>'code', ''));
    v_label := btrim(coalesce(v_node->>'label', ''));
    continue when v_code = '' or v_label = '';
    v_rule := coalesce(v_node->>'complete_rule', 'all');
    v_carry := p_kept -> btrim(coalesce(v_node->>'originalCode', v_node->>'code'));

    insert into merit_badge_requirements (mb_id, parent_id, code, label, complete_rule, complete_n, sort_order)
    values (
      p_mb_id,
      p_parent,
      v_code,
      v_label,
      v_rule,
      case when v_rule = 'n-of' then (v_node->>'complete_n')::integer end,
      v_sort
    )
    returning id into v_id;

    if v_carry is not null then
      update merit_badge_requirements
         set teach_minutes = (v_carry->>'teach_minutes')::smallint,
             venue = v_carry->>'venue',
             class_codes = coalesce(array(select jsonb_array_elements_text(v_carry->'class_codes'))::char(1)[], '{}')
       where id = v_id;
    end if;

    v_sort := v_sort + 1;
    perform public._insert_merit_badge_requirement_nodes(p_mb_id, v_node->'children', v_id, p_kept);
  end loop;
end;
$$;

create or replace function public.replace_merit_badge_requirements(p_mb_id text, p_tree jsonb) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_kept jsonb;
begin
  if p_tree is null or jsonb_typeof(p_tree) <> 'array' then
    raise exception 'requirement tree must be a JSON array';
  end if;

  select coalesce(jsonb_object_agg(code, jsonb_build_object('teach_minutes', teach_minutes, 'venue', venue, 'class_codes', to_jsonb(class_codes))), '{}'::jsonb)
    into v_kept
    from merit_badge_requirements
   where mb_id = p_mb_id;

  delete from merit_badge_requirements where mb_id = p_mb_id;

  perform public._insert_merit_badge_requirement_nodes(p_mb_id, p_tree, null, v_kept);
end;
$$;

revoke all on function public.requirement_classes_guard() from public, anon, authenticated;
revoke all on function public.requirement_class_codes_check() from public, anon, authenticated;
revoke all on function public._insert_merit_badge_requirement_nodes(text, jsonb, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.replace_merit_badge_requirements(text, jsonb) from public, anon, authenticated;
grant execute on function public._insert_merit_badge_requirement_nodes(text, jsonb, bigint, jsonb) to service_role;
grant execute on function public.replace_merit_badge_requirements(text, jsonb) to service_role;
