-- Meeting Requests & Teaching Offers, Phase 0b (Plans/Meeting-Requests-And-Teaching-Offers.md): "What I can teach"
-- self-service, with admin review and undo.
--
-- 1. teaching_skill_changes: every add or remove of a teaching skill, from the member page, from Admin › Lookups, or
--    from an undo. reviewed_at null = counts toward the admin-home alert; only member changes start unreviewed.
--    reverted_at marks a change an undo reversed. An undo is an ordinary row (source 'undo'), with no chain.
-- 2. set_teaching_skills: ONE diffing writer for both surfaces. Skills and log rows change in one transaction, so a
--    failure part-way can't leave skills without their log. Refuses a merged-away person, an unknown skill, and an
--    adults-only skill for an active scout (the youth guard, also checked by the engine at read time).
-- 3. undo_teaching_skill_change: reverses one change if it still holds, logs the undo, marks the change reverted.
--
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker and
-- not executable by anon/authenticated (service role only).

create table if not exists public.teaching_skill_changes (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  skill_id text not null references public.skills(id) on delete cascade,
  action text not null check (action in ('added', 'removed')),
  source text not null check (source in ('member', 'admin', 'undo')),
  changed_by_person_id bigint references public.people(id) on delete set null,
  changed_by_label text,
  changed_at timestamptz not null default now(),
  reverted_at timestamptz,
  reviewed_at timestamptz
);
create index if not exists teaching_skill_changes_recent_idx on public.teaching_skill_changes (changed_at desc);
create index if not exists teaching_skill_changes_unreviewed_idx on public.teaching_skill_changes (changed_at)
  where reviewed_at is null;
create index if not exists teaching_skill_changes_person_idx on public.teaching_skill_changes (person_id);
alter table public.teaching_skill_changes enable row level security;
revoke all on public.teaching_skill_changes from anon, authenticated;

-- Returns {"added": [...], "removed": [...]} or raises with a message the screens show as-is.
create or replace function public.set_teaching_skills(
  p_person_id bigint,
  p_skill_ids text[],
  p_source text,
  p_changed_by_person_id bigint,
  p_changed_by_label text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_merged bigint;
  v_wanted text[] := array(select distinct w from unnest(coalesce(p_skill_ids, '{}')) w order by w);
  v_unknown text[];
  v_adult_only text[];
  v_added text[];
  v_removed text[];
begin
  if p_source not in ('member', 'admin') then
    raise exception 'Unknown source %', p_source;
  end if;
  select merged_into_person_id into v_merged from people where id = p_person_id for update;
  if not found then raise exception 'That person no longer exists.'; end if;
  if v_merged is not null then
    raise exception 'That person was merged into another record. Edit the one they were merged into.';
  end if;

  v_unknown := array(select w from unnest(v_wanted) w where not exists (select 1 from skills s where s.id = w));
  if cardinality(v_unknown) > 0 then
    raise exception 'Unknown skill: %', array_to_string(v_unknown, ', ');
  end if;
  if exists (select 1 from scouts where person_id = p_person_id and active) then
    v_adult_only := array(
      select s.name from skills s where s.id = any (v_wanted) and not s.youth_teachable order by s.sort_order
    );
    if cardinality(v_adult_only) > 0 then
      raise exception 'Adults only, so a scout can''t teach it: %', array_to_string(v_adult_only, ', ');
    end if;
  end if;

  v_removed := array(
    select t.skill_id from teaching_skills t where t.person_id = p_person_id and not (t.skill_id = any (v_wanted)) order by 1
  );
  v_added := array(
    select w from unnest(v_wanted) w
     where not exists (select 1 from teaching_skills t where t.person_id = p_person_id and t.skill_id = w)
     order by w
  );

  delete from teaching_skills where person_id = p_person_id and skill_id = any (v_removed);
  insert into teaching_skills (person_id, skill_id, authorized_by)
  select p_person_id, a, case when p_source = 'member' then 'self' else p_changed_by_label end from unnest(v_added) a;

  insert into teaching_skill_changes (person_id, skill_id, action, source, changed_by_person_id, changed_by_label, reviewed_at)
  select p_person_id, x.skill_id, x.action, p_source, p_changed_by_person_id, p_changed_by_label,
         case when p_source = 'member' then null else now() end
    from (
      select a as skill_id, 'added' as action from unnest(v_added) a
      union all
      select r, 'removed' from unnest(v_removed) r
    ) x;

  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$$;

-- 'ok' | 'missing' | 'already' (reverted before, or an undo row) | 'superseded' (the skill already changed back).
create or replace function public.undo_teaching_skill_change(
  p_change_id bigint,
  p_changed_by_person_id bigint,
  p_changed_by_label text
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c teaching_skill_changes%rowtype;
  v_held boolean;
begin
  select * into c from teaching_skill_changes where id = p_change_id for update;
  if not found then return 'missing'; end if;
  if c.reverted_at is not null or c.source = 'undo' then return 'already'; end if;
  if exists (select 1 from people where id = c.person_id and merged_into_person_id is not null) then
    raise exception 'That person was merged into another record. Edit the one they were merged into.';
  end if;
  perform 1 from people where id = c.person_id for update;

  v_held := exists (select 1 from teaching_skills where person_id = c.person_id and skill_id = c.skill_id);
  -- Undoing an add removes the skill; undoing a remove restores it. If the skill already changed back, or a later
  -- change touched the same skill (only the latest one is reversible, so an old undo can't flip today's state), there
  -- is nothing to reverse: mark it reviewed and say so rather than logging a no-op.
  if (c.action = 'added' and not v_held) or (c.action = 'removed' and v_held)
     or exists (select 1 from teaching_skill_changes x where x.person_id = c.person_id and x.skill_id = c.skill_id and x.id > c.id) then
    update teaching_skill_changes set reviewed_at = coalesce(reviewed_at, now()) where id = c.id;
    return 'superseded';
  end if;
  if c.action = 'removed'
     and exists (select 1 from scouts where person_id = c.person_id and active)
     and exists (select 1 from skills where id = c.skill_id and not youth_teachable) then
    raise exception 'Adults only, so a scout can''t teach it.';
  end if;

  if c.action = 'added' then
    delete from teaching_skills where person_id = c.person_id and skill_id = c.skill_id;
  else
    insert into teaching_skills (person_id, skill_id, authorized_by) values (c.person_id, c.skill_id, p_changed_by_label);
  end if;
  insert into teaching_skill_changes (person_id, skill_id, action, source, changed_by_person_id, changed_by_label, reviewed_at)
  values (c.person_id, c.skill_id, case when c.action = 'added' then 'removed' else 'added' end, 'undo',
          p_changed_by_person_id, p_changed_by_label, now());
  update teaching_skill_changes set reverted_at = now(), reviewed_at = coalesce(reviewed_at, now()) where id = c.id;
  return 'ok';
end;
$$;

revoke all on function public.set_teaching_skills(bigint, text[], text, bigint, text) from public, anon, authenticated;
revoke all on function public.undo_teaching_skill_change(bigint, bigint, text) from public, anon, authenticated;
