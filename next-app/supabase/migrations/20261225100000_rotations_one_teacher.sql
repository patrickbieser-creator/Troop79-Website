-- Rotations L2 (Plans/Build-A-Plan.md, "Rotations: one arrangement over the live plan", Decisions 1 and 4): on a
-- meeting with an arrangement, every offering on the plan has a class, and a class and the plan share one teacher.
--
-- 1. Columns:
--    - meeting_classes.auto: made by reconcile, not by a hand. An auto class left empty whose topic leaves the plan goes
--      away by itself; a class a planner made, moved, repeated or gave a teacher stays (Needs attention calls it "no
--      longer on the plan", L0).
--    - meeting_classes.teacher_override: this class keeps its own teacher. True for the repeats of a class (Decision 4:
--      "only a repeat of a class can carry its own override") and for a class whose teacher already differed from the
--      plan's at this deploy. A single class without it mirrors the plan.
--    - meeting_topics.class_set_aside_at: a planner removed the topic's last class by hand. No class is made for it
--      again automatically until it is added to the plan again (seeded after this) or a class is made for it by hand.
--    - meeting_topic_teachers.lead: the topic's lead teacher, chosen on a card (qa-lead, L2). Choosing never deletes
--      anyone's sign-up: the others stay on the plan as co-teachers, so a volunteer who said Yes is never lost.
-- 2. "On the plan" (_meeting_topic_on_plan): seeded (Build a Plan), a teacher signed up who hasn't said Can't make it, or
--    a current pick of a Coming active scout (L1's own Coming rule: said Coming, or picked with no answer).
-- 3. _meeting_reconcile_core gains three steps around L1's two (leave, land):
--      a. leave (L1);
--      b. auto classes that are empty and off the plan go, and their topic row with them when nothing else holds it (no
--         pick of any kind, no teacher, no other class, not seeded), as meeting_unseed_topic did before every offering
--         had a class;
--      c. every topic on the plan with no class (and not set aside) gets one in Not scheduled, auto, no teacher yet;
--      d. land (L1);
--      e. one teacher: a single class without an override takes the plan's teacher (the lead, else the first to sign
--         up, of those who haven't said Can't make it; none = no teacher), bumping the card's version so a stale card write is refused. A single
--         class whose override already agrees with the plan drops the override.
-- 4. Live edits by hand:
--    - meeting_live_set_teacher: on a single class it WRITES THE PLAN: the chosen teacher signs up for the topic (if
--      they hadn't) and becomes its lead; nobody else's sign-up is touched. Clearing a card ("No teacher yet") is that
--      class only (override; Needs attention then offers the plan's teacher). On a repeat it sets that repeat's own
--      teacher (override). Someone who said Can't make it is refused. The class stops being auto.
--    - meeting_live_move_class: the class stops being auto.
--    - meeting_live_repeat_class: every class of the topic keeps its own teacher from now on (override); none is auto.
--    - meeting_live_remove_class: removing a topic's last class sets the topic aside.
--    - meeting_live_add_class ("+ Add an offer", Make a class): the topic is no longer set aside; with a second class
--      for the topic, each keeps its own teacher.
--    - meeting_live_discard: + no topic stays set aside.
-- 5. Triggers: deferred constraint triggers on meeting_topic_teachers (every sign-up, take-back, Assign, answer page)
--    and meeting_topics (a seed or unseed: insert, delete, update of seeded_at) reconcile at commit, like L1's on picks
--    and answers.
-- 6. Lock order (as L1's section 8b): every writer of topics and teachers takes the Live lock up front when the meeting
--    has an arrangement: _meeting_seed_guard (seed_many, seed_topic, seed_focus_set, new_mix, edit_mix),
--    meeting_unseed_topic and _meeting_teach_guard (teach, unteach, answer pages through teach). Bodies are
--    pg_get_functiondef's with only the marked line added. meeting_live_start also signs the matcher's teachers up for
--    their topics and makes each the lead of its single class (6b), so the matcher's choice stands; a topic the matcher
--    split into repeats starts with each repeat's own teacher. Known, accepted (as L1): merge_people rewrites teacher
--    rows without the Live lock and reconciles at commit; a Live edit on one of the two merged people in that instant
--    could deadlock (Postgres fails one). A merge carries a sign-up but not its lead mark.
-- 7. Data: classes of a topic with two or more classes, and single classes with a teacher who isn't the plan's, get
--    teacher_override (nobody's teacher changes at deploy). Then every upcoming meeting with an arrangement reconciles
--    once, so its offerings show their classes now rather than at the next sign-up.
--
-- DEPLOY ORDER: DB-first. Production's L1 code reads classes the same way; the new classes are ordinary Not scheduled
-- cards with no teacher yet, which its Live screen already draws. Its "Use <class teacher>" fix still works (teach,
-- then unteach the others: the class then mirrors the plan).
-- Posture (D-051 / D-239): functions invoker, search_path pinned, EXECUTE only to service_role.

-- ── 1. columns ────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.meeting_classes
  add column if not exists auto boolean not null default false,
  add column if not exists teacher_override boolean not null default false;
alter table public.meeting_topics add column if not exists class_set_aside_at timestamptz;
alter table public.meeting_topic_teachers add column if not exists lead boolean not null default false;

-- ── 2. on the plan ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._meeting_topic_on_plan(p_entry bigint, p_topic bigint) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from meeting_topics t where t.id = p_topic and t.seeded_at is not null)
      or exists (
        select 1 from meeting_topic_teachers x
         where x.topic_id = p_topic
           and not exists (select 1 from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = x.person_id and i.intent = 'not_coming')
      )
      or exists (
        select 1 from meeting_topic_picks k
          join scouts s on s.person_id = k.person_id and s.active
          left join meeting_intents i on i.calendar_entry_id = p_entry and i.person_id = k.person_id
         where k.topic_id = p_topic and not k.later and coalesce(i.intent, 'coming') = 'coming'
      );
$$;

-- The plan's teacher for a topic: the lead, else the first to sign up, of those who haven't said Can't make it.
create or replace function public._meeting_plan_teacher(p_entry bigint, p_topic bigint) returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select x.person_id
    from meeting_topic_teachers x
   where x.topic_id = p_topic
     and not exists (select 1 from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = x.person_id and i.intent = 'not_coming')
   order by x.lead desc, x.created_at, x.person_id
   limit 1;
$$;

-- ── 3. reconcile ──────────────────────────────────────────────────────────────────────────────────────────────────
-- L1's body (20261224100000) with steps b, c and e added.
create or replace function public._meeting_reconcile_core(p_entry bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_changed integer := 0;
  v_n integer;
  r record;
  v_target bigint;
begin
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null then
    return 0;
  end if;
  -- A meeting that has passed is the attendance checklist's now: nothing moves under it.
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    return 0;
  end if;

  -- a. Unpinned scouts leave on their own.
  delete from meeting_class_members m
   using meeting_classes c
   where c.id = m.class_id
     and c.calendar_entry_id = p_entry
     and not m.pinned
     and exists (select 1 from scouts s where s.person_id = m.person_id and s.active)
     and (
       exists (select 1 from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = m.person_id and i.intent = 'not_coming')
       or (
         c.title is null
         and exists (select 1 from meeting_pick_lists l where l.calendar_entry_id = p_entry and l.person_id = m.person_id)
         and not exists (
           select 1 from meeting_topic_picks k
            where k.calendar_entry_id = p_entry and k.person_id = m.person_id and k.topic_id = c.topic_id and not k.later
         )
         and (
           exists (select 1 from meeting_topic_picks k where k.calendar_entry_id = p_entry and k.person_id = m.person_id and not k.later)
           or (select i.intent from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = m.person_id) is distinct from 'undecided'
         )
       )
     );
  get diagnostics v_n = row_count;
  v_changed := v_changed + v_n;

  -- b. An auto class left empty whose topic is off the plan goes, and the topic row with it when nothing holds it.
  for r in
    delete from meeting_classes c
     where c.calendar_entry_id = p_entry
       and c.auto
       and not exists (select 1 from meeting_class_members m where m.class_id = c.id)
       and not public._meeting_topic_on_plan(p_entry, c.topic_id)
    returning c.topic_id
  loop
    v_changed := v_changed + 1;
    delete from meeting_topics t
     where t.id = r.topic_id
       and t.seeded_at is null
       and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id)
       and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id)
       and not exists (select 1 from meeting_classes x where x.topic_id = t.id);
  end loop;

  -- c. Every topic on the plan has a class: a new one waits in Not scheduled.
  for r in
    select t.id
      from meeting_topics t
     where t.calendar_entry_id = p_entry
       and not exists (select 1 from meeting_classes c where c.topic_id = t.id)
       and (t.class_set_aside_at is null or (t.seeded_at is not null and t.seeded_at > t.class_set_aside_at))
       and public._meeting_topic_on_plan(p_entry, t.id)
     order by t.id
  loop
    insert into meeting_classes (calendar_entry_id, topic_id, rotation, position, auto)
    values (p_entry, r.id, null,
            coalesce((select max(position) + 1 from meeting_classes x where x.calendar_entry_id = p_entry and x.rotation is null), 0),
            true);
    update meeting_topics set class_set_aside_at = null where id = r.id and class_set_aside_at is not null;
    v_changed := v_changed + 1;
  end loop;

  -- d. Late picks land in their class.
  for r in
    select k.person_id, k.topic_id
      from meeting_topic_picks k
      join scouts s on s.person_id = k.person_id and s.active
      left join meeting_intents i on i.calendar_entry_id = p_entry and i.person_id = k.person_id
     where k.calendar_entry_id = p_entry
       and not k.later
       and coalesce(i.intent, 'coming') = 'coming'
       and exists (select 1 from meeting_classes c where c.calendar_entry_id = p_entry and c.topic_id = k.topic_id)
       and not exists (
         select 1 from meeting_class_members m join meeting_classes c on c.id = m.class_id
          where c.calendar_entry_id = p_entry and c.topic_id = k.topic_id and m.person_id = k.person_id
       )
       and not exists (select 1 from meeting_live_holds h where h.calendar_entry_id = p_entry and h.person_id = k.person_id and h.topic_id = k.topic_id)
       and not exists (select 1 from meeting_classes c where c.calendar_entry_id = p_entry and c.teacher_person_id = k.person_id)
     order by k.person_id, k.priority nulls last, k.first_asked_on, k.topic_id
  loop
    if (select count(*) from meeting_class_members m join meeting_classes c on c.id = m.class_id
         where c.calendar_entry_id = p_entry and m.person_id = r.person_id) >= 2 then
      continue;
    end if;
    select c.id into v_target
      from meeting_classes c
      left join lateral (select count(*) as n from meeting_class_members m where m.class_id = c.id) sz on true
     where c.calendar_entry_id = p_entry
       and c.topic_id = r.topic_id
       and sz.n < 8
       and (
         c.rotation is null
         or not exists (
           select 1 from meeting_class_members m join meeting_classes o on o.id = m.class_id
            where o.calendar_entry_id = p_entry and o.rotation = c.rotation and m.person_id = r.person_id
         )
       )
     order by sz.n, c.rotation nulls last, c.position, c.id
     limit 1;
    if v_target is null then continue; end if;
    insert into meeting_class_members (class_id, person_id, pinned, is_new)
    values (v_target, r.person_id, false, true)
    on conflict (class_id, person_id) do nothing;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
    v_target := null;
  end loop;

  -- e. One teacher: a single class without an override mirrors the plan's teacher.
  update meeting_classes c
     set teacher_override = false, updated_at = now()
   where c.calendar_entry_id = p_entry
     and c.teacher_override
     and (select count(*) from meeting_classes o where o.topic_id = c.topic_id) = 1
     and c.teacher_person_id is not distinct from public._meeting_plan_teacher(p_entry, c.topic_id);
  get diagnostics v_n = row_count;
  v_changed := v_changed + v_n;
  update meeting_classes c
     set teacher_person_id = public._meeting_plan_teacher(p_entry, c.topic_id), version = c.version + 1, updated_at = now()
   where c.calendar_entry_id = p_entry
     and not c.teacher_override
     and (select count(*) from meeting_classes o where o.topic_id = c.topic_id) = 1
     and c.teacher_person_id is distinct from public._meeting_plan_teacher(p_entry, c.topic_id);
  get diagnostics v_n = row_count;
  v_changed := v_changed + v_n;
  return v_changed;
end;
$$;

-- ── 4. Live edits by hand ─────────────────────────────────────────────────────────────────────────────────────────
-- A card's teacher. On a single class it is the plan's teacher too (Decision 4); on a repeat, that repeat's own.
create or replace function public.meeting_live_set_teacher(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer, p_teacher bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
  v_topic bigint;
  v_single boolean;
begin
  perform public._meeting_live_edit(p_entry);
  -- Someone who said Can't make it isn't this meeting's teacher (the plan's rule would take them straight off).
  if p_teacher is not null and exists (
    select 1 from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = p_teacher and i.intent = 'not_coming'
  ) then
    raise exception 'That teacher said they can’t make it.';
  end if;
  select topic_id into v_topic from meeting_classes where id = p_class and calendar_entry_id = p_entry;
  if v_topic is null then raise exception 'STALE'; end if;
  v_single := (select count(*) from meeting_classes where topic_id = v_topic) = 1;
  update meeting_classes
     set teacher_person_id = p_teacher, teacher_override = (not v_single) or p_teacher is null, auto = false,
         version = version + 1, entered_by_person_id = p_actor, updated_at = now()
   where id = p_class and calendar_entry_id = p_entry and version = p_expected
  returning version into v_version;
  if v_version is null then raise exception 'STALE'; end if;
  if v_single and p_teacher is not null then
    -- The plan's teacher: signed up (if they weren't) and the topic's lead. Nobody else's sign-up is touched.
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, entered_by_person_id)
    values (v_topic, p_entry, p_teacher, p_actor)
    on conflict (topic_id, person_id) do nothing;
    update meeting_topic_teachers set lead = (person_id = p_teacher), updated_at = now()
     where topic_id = v_topic and lead is distinct from (person_id = p_teacher);
  end if;
  perform public._meeting_live_bump(p_entry);
  return (select version from meeting_classes where id = p_class);
end;
$$;

create or replace function public.meeting_live_move_class(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer, p_rotation smallint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
begin
  perform public._meeting_live_edit(p_entry);
  if p_rotation is not null and not exists (select 1 from meeting_rotations where calendar_entry_id = p_entry and number = p_rotation) then
    raise exception 'STALE';
  end if;
  update meeting_classes
     set rotation = p_rotation,
         position = coalesce((select max(position) + 1 from meeting_classes x
                               where x.calendar_entry_id = p_entry and x.rotation is not distinct from p_rotation and x.id <> p_class), 0),
         auto = false,
         version = version + 1, entered_by_person_id = p_actor, updated_at = now()
   where id = p_class and calendar_entry_id = p_entry and version = p_expected
  returning version into v_version;
  if v_version is null then raise exception 'STALE'; end if;
  perform public._meeting_live_bump(p_entry);
  return (select version from meeting_classes where id = p_class);
end;
$$;

create or replace function public.meeting_live_repeat_class(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer, p_rotation smallint) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_topic bigint;
begin
  perform public._meeting_live_edit(p_entry);
  select topic_id into v_topic from meeting_classes where id = p_class and calendar_entry_id = p_entry and version = p_expected;
  if v_topic is null then
    raise exception 'STALE';
  end if;
  if p_rotation is not null and not exists (select 1 from meeting_rotations where calendar_entry_id = p_entry and number = p_rotation) then
    raise exception 'STALE';
  end if;
  insert into meeting_classes (calendar_entry_id, topic_id, rotation, title, position, entered_by_person_id, teacher_override)
  select c.calendar_entry_id, c.topic_id, p_rotation, c.title,
         coalesce((select max(position) + 1 from meeting_classes x where x.calendar_entry_id = p_entry and x.rotation is not distinct from p_rotation), 0),
         p_actor, true
    from meeting_classes c where c.id = p_class
  returning id into v_id;
  -- Repeats each keep their own teacher (Decision 4); none of them is reconcile's to remove.
  update meeting_classes set teacher_override = true, auto = false, updated_at = now()
   where topic_id = v_topic and (not teacher_override or auto);
  perform public._meeting_live_bump(p_entry);
  return v_id;
end;
$$;

create or replace function public.meeting_live_remove_class(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
begin
  perform public._meeting_live_edit(p_entry);
  delete from meeting_classes where id = p_class and calendar_entry_id = p_entry and version = p_expected
  returning topic_id into v_topic;
  if v_topic is null then raise exception 'STALE'; end if;
  -- The topic's last class, removed by hand: reconcile doesn't make another until a planner asks for one.
  if not exists (select 1 from meeting_classes where topic_id = v_topic) then
    update meeting_topics set class_set_aside_at = now() where id = v_topic;
  end if;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- Body from 20261207100000 with the set-aside and override lines added.
create or replace function public.meeting_live_add_class(
  p_entry bigint, p_actor bigint, p_topic_key text, p_title text, p_teacher bigint, p_rotation smallint
) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
  v_id bigint;
begin
  perform public._meeting_live_edit(p_entry);
  if nullif(btrim(coalesce(p_topic_key, '')), '') is not null then
    v_topic := public._meeting_topic_id(p_entry, p_topic_key);
  else
    v_topic := public._meeting_freeform_topic_id(p_entry, p_title);
  end if;
  if v_topic is null then raise exception 'That isn’t something you can teach at this meeting.'; end if;
  if p_rotation is not null and not exists (select 1 from meeting_rotations where calendar_entry_id = p_entry and number = p_rotation) then
    raise exception 'STALE';
  end if;
  insert into meeting_classes (calendar_entry_id, topic_id, rotation, teacher_person_id, position, entered_by_person_id)
  values (p_entry, v_topic, p_rotation, p_teacher,
          coalesce((select max(position) + 1 from meeting_classes x where x.calendar_entry_id = p_entry and x.rotation is not distinct from p_rotation), 0),
          p_actor)
  returning id into v_id;
  update meeting_topics set class_set_aside_at = null where id = v_topic and class_set_aside_at is not null;
  -- A second class for the topic: from now on each keeps its own teacher (Decision 4).
  if (select count(*) from meeting_classes where topic_id = v_topic) > 1 then
    update meeting_classes set teacher_override = true, auto = false, updated_at = now() where topic_id = v_topic and (not teacher_override or auto);
  end if;
  if p_teacher is not null then
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, entered_by_person_id)
    values (v_topic, p_entry, p_teacher, p_actor)
    on conflict (topic_id, person_id) do nothing;
  end if;
  perform public._meeting_live_bump(p_entry);
  return v_id;
end;
$$;

-- Body from 20261224100000 with the set-aside line added.
create or replace function public.meeting_live_discard(p_entry bigint, p_actor bigint) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_had boolean;
begin
  perform public._meeting_live_lock(p_entry);
  v_had := (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is not null
           or exists (select 1 from meeting_classes where calendar_entry_id = p_entry);
  -- Classes first: members cascade with them, and nothing then holds a rotation or a topic.
  delete from meeting_classes where calendar_entry_id = p_entry;
  delete from meeting_rotations where calendar_entry_id = p_entry;
  delete from meeting_live_holds where calendar_entry_id = p_entry;
  update meeting_topics set class_set_aside_at = null where calendar_entry_id = p_entry and class_set_aside_at is not null;
  -- Draft ticks go; a visitor's row stays, so they are still this meeting's visitor.
  delete from meeting_live_presence lp
   where lp.calendar_entry_id = p_entry
     and not exists (
       select 1 from people p join households h on h.id = p.guest_host_household_id
        where p.id = lp.person_id and h.system_key = 'meeting-visitors'
     );
  update meeting_boards set live_started_at = null where calendar_entry_id = p_entry;
  perform public._meeting_live_bump(p_entry);
  return v_had;
end;
$$;

-- ── 5. triggers ───────────────────────────────────────────────────────────────────────────────────────────────────
drop trigger if exists meeting_topic_teachers_reconcile on public.meeting_topic_teachers;
create constraint trigger meeting_topic_teachers_reconcile
  after insert or update or delete on public.meeting_topic_teachers
  deferrable initially deferred
  for each row execute function public._meeting_reconcile_trigger();

drop trigger if exists meeting_topics_reconcile on public.meeting_topics;
create constraint trigger meeting_topics_reconcile
  after insert or delete or update of seeded_at on public.meeting_topics
  deferrable initially deferred
  for each row execute function public._meeting_reconcile_trigger();

revoke all on function public._meeting_topic_on_plan(bigint, bigint) from public, anon, authenticated;
revoke all on function public._meeting_plan_teacher(bigint, bigint) from public, anon, authenticated;
revoke all on function public._meeting_reconcile_core(bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_set_teacher(bigint, bigint, bigint, integer, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_move_class(bigint, bigint, bigint, integer, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_repeat_class(bigint, bigint, bigint, integer, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_remove_class(bigint, bigint, bigint, integer) from public, anon, authenticated;
revoke all on function public.meeting_live_add_class(bigint, bigint, text, text, bigint, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_discard(bigint, bigint) from public, anon, authenticated;
grant execute on function public._meeting_topic_on_plan(bigint, bigint) to service_role;
grant execute on function public._meeting_plan_teacher(bigint, bigint) to service_role;
grant execute on function public._meeting_reconcile_core(bigint) to service_role;
grant execute on function public.meeting_live_set_teacher(bigint, bigint, bigint, integer, bigint) to service_role;
grant execute on function public.meeting_live_move_class(bigint, bigint, bigint, integer, smallint) to service_role;
grant execute on function public.meeting_live_repeat_class(bigint, bigint, bigint, integer, smallint) to service_role;
grant execute on function public.meeting_live_remove_class(bigint, bigint, bigint, integer) to service_role;
grant execute on function public.meeting_live_add_class(bigint, bigint, text, text, bigint, smallint) to service_role;
grant execute on function public.meeting_live_discard(bigint, bigint) to service_role;

-- ── 6. lock order: topic and teacher writers take the Live lock up front ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._meeting_seed_guard(p_entry bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_seed:%s', p_entry), 0));
  -- Rotations L2: the Live lock next, before any row is written (see L1's section 8b).
  perform public._meeting_live_lock_if_started(p_entry);
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if public.meeting_board_mode(p_entry) = 'closed' then
    raise exception 'That meeting isn’t taking sign-ups.';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meeting_unseed_topic(p_entry bigint, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_topic bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_seed:%s', p_entry), 0));
  -- Rotations L2: the Live lock next, before any row is written (see L1's section 8b).
  perform public._meeting_live_lock_if_started(p_entry);
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key and seeded_at is not null;
  if v_topic is null then return; end if;
  -- Lock the topic first (waits out a pick or a teacher being added to it), so the check below sees it.
  perform 1 from meeting_topics where id = v_topic for update;
  delete from meeting_topics t
   where t.id = v_topic
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id)
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id)
     and not exists (select 1 from meeting_classes x where x.topic_id = t.id);
  if found then return; end if;
  update meeting_topics set seeded_by_person_id = null, seeded_at = null where id = v_topic;
end;
$function$;

CREATE OR REPLACE FUNCTION public._meeting_teach_guard(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_op text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  -- Rotations L2: the Live lock next, before any row is written (see L1's section 8b).
  perform public._meeting_live_lock_if_started(p_entry);
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if p_actor is null or not (coalesce(p_leader, false) or p_actor = p_person) then
    raise exception 'You can only sign up to teach for yourself.';
  end if;
  v_kind := public._meeting_teacher_kind(p_person);
  if v_kind is null and p_op = 'add' then
    raise exception 'That person can’t teach at troop meetings.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There’s no teaching sign-up for this meeting.';
  end if;
  return v_kind;
end;
$function$;

-- ── 6b. meeting_live_start: the matcher's teachers reach the plan ─────────────────────────────────────────────────
-- pg_get_functiondef's body with only the marked lines added. Without them, a class taught through a skill offer (no
-- topic sign-up) would lose its teacher to step e.
CREATE OR REPLACE FUNCTION public.meeting_live_start(p_entry bigint, p_actor bigint, p_snapshot jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c jsonb;
  v_topic bigint;
  v_class bigint;
  v_rot smallint;
begin
  perform public._meeting_live_lock(p_entry);
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is not null then
    return false;
  end if;
  if public.meeting_board_mode(p_entry) = 'closed' then
    raise exception 'That meeting isn’t taking sign-ups.';
  end if;
  insert into meeting_boards (calendar_entry_id)
  values (p_entry)
  on conflict (calendar_entry_id) do nothing;

  insert into meeting_rotations (calendar_entry_id, number) values (p_entry, 1), (p_entry, 2) on conflict do nothing;
  insert into meeting_rotations (calendar_entry_id, number, location)
  select p_entry, (r->>'number')::smallint, nullif(btrim(coalesce(r->>'location', '')), '')
    from jsonb_array_elements(coalesce(p_snapshot->'rotations', '[]'::jsonb)) r
   where (r->>'number') is not null
  on conflict (calendar_entry_id, number) do update set location = coalesce(excluded.location, meeting_rotations.location);

  for c in select * from jsonb_array_elements(coalesce(p_snapshot->'classes', '[]'::jsonb)) loop
    v_topic := public._meeting_topic_id(p_entry, c->>'topic_key');
    if v_topic is null then continue; end if;
    v_rot := nullif(c->>'rotation', '')::smallint;
    if v_rot is not null then
      insert into meeting_rotations (calendar_entry_id, number) values (p_entry, v_rot) on conflict do nothing;
    end if;
    insert into meeting_classes (calendar_entry_id, topic_id, rotation, teacher_person_id, title, source_key, position, entered_by_person_id)
    values (
      p_entry, v_topic, v_rot, nullif(c->>'teacher_person_id', '')::bigint,
      nullif(btrim(coalesce(c->>'title', '')), ''), nullif(c->>'source_key', ''),
      coalesce(nullif(c->>'position', '')::int, 0), p_actor
    )
    returning id into v_class;
    -- Rotations L2: one teacher. The matcher's teacher (a skill offer, say) signs up for the topic, so the plan and the
    -- class agree from the start.
    if nullif(c->>'teacher_person_id', '') is not null then
      insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, entered_by_person_id)
      values (v_topic, p_entry, (c->>'teacher_person_id')::bigint, p_actor)
      on conflict (topic_id, person_id) do nothing;
    end if;
    insert into meeting_class_members (class_id, person_id, entered_by_person_id)
    select v_class, m::bigint, p_actor from jsonb_array_elements_text(coalesce(c->'members', '[]'::jsonb)) m
    on conflict do nothing;
  end loop;

  -- Rotations L2: the matcher's choice stands. A single class's teacher is its topic's lead; a topic the matcher split
  -- into repeats keeps each repeat's own teacher.
  update meeting_topic_teachers x
     set lead = (x.person_id = c.teacher_person_id), updated_at = now()
    from meeting_classes c
   where c.calendar_entry_id = p_entry and c.teacher_person_id is not null
     and x.topic_id = c.topic_id
     and (select count(*) from meeting_classes o where o.topic_id = c.topic_id) = 1
     and x.lead is distinct from (x.person_id = c.teacher_person_id);
  update meeting_classes c set teacher_override = true
   where c.calendar_entry_id = p_entry
     and (select count(*) from meeting_classes o where o.topic_id = c.topic_id) > 1;
  update meeting_boards set live_started_at = now(), live_version = live_version + 1, updated_at = now()
   where calendar_entry_id = p_entry;
  return true;
end;
$function$;

-- ── 7. data ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Nobody's teacher changes at deploy: repeats and single classes that differ from the plan keep their own.
update public.meeting_classes c
   set teacher_override = true
 where (select count(*) from public.meeting_classes o where o.topic_id = c.topic_id) > 1
    or (c.teacher_person_id is not null and c.teacher_person_id is distinct from public._meeting_plan_teacher(c.calendar_entry_id, c.topic_id));

-- Every upcoming meeting with an arrangement shows its offerings' classes now.
select public.meeting_reconcile(b.calendar_entry_id)
  from public.meeting_boards b
  join public.calendar_entries e on e.id = b.calendar_entry_id
 where b.live_started_at is not null
   and e.entry_date >= (now() at time zone 'America/Chicago')::date;
