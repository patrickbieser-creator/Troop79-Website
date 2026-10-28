-- Meeting Planner III, P6: retire Rotations and the matcher (Plans/Meeting-Planner-III.md, Decision 10; tech-lead
-- 2026-10-28). Live at the meeting is This week's own view, derived from the plan, so the arrangement engine goes.
--
-- DEPLOY ORDER: CODE-FIRST. Push only after the release that stopped reading Rotations is live: production's earlier
-- code reads meeting_boards.live_started_at on /member/meeting and calls meeting_live_* RPCs. Take a manual backup
-- (scripts/backup-prod.mts) right before: the dropped tables' rows are not kept anywhere else (D-432: meeting_plans
-- goes too).
-- After it applies, this sweep must return no rows:
--   select proname from pg_proc where prosrc ~ '_meeting_live_(lock|edit|bump|begin)|_meeting_reconcile|
--     _meeting_should_arrange|_meeting_topic_on_plan|_meeting_plan_teacher|meeting_reconcile\(|live_started_at|
--     class_set_aside_at|meeting_(classes|rotations|plans)';
-- Posture (D-051 / D-239) unchanged: invoker functions, search_path pinned, EXECUTE to service_role only.

-- ── 1. retire Rotations (Decision 10: Live at the meeting is This week's own view, derived from the plan) ───────
-- The arrangement engine goes: its triggers on picks, intents, topics and teachers; the reconcile and every
-- meeting_live_* RPC but the presence draft; the tables meeting_rotations, meeting_classes, meeting_class_members and
-- meeting_live_holds; meeting_boards' live_* and attendance_seeded_at columns; meeting_topics.class_set_aside_at.
-- The retired Build a Plan snapshot table meeting_plans goes too (D-432). The six functions that took the Live lock
-- are redefined without it (production's bodies, only those lines removed). Presence taps stay a draft.
drop trigger if exists meeting_intents_reconcile on public.meeting_intents;
drop trigger if exists meeting_topic_picks_reconcile on public.meeting_topic_picks;
drop trigger if exists meeting_topic_teachers_reconcile on public.meeting_topic_teachers;
drop trigger if exists meeting_topics_reconcile on public.meeting_topics;

CREATE OR REPLACE FUNCTION public._meeting_pick_guard(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_carry jsonb, p_op text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c jsonb;
  v_topic bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if not exists (select 1 from scouts where person_id = p_person and active) then
    raise exception 'Picks are for scouts.';
  end if;
  if not public._meeting_may_act_for(p_actor, p_person, p_leader) then
    raise exception 'You can only pick for yourself or the scouts in your household.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There are no picks for this meeting.';
  end if;
  if exists (select 1 from meeting_pick_lists where calendar_entry_id = p_entry and person_id = p_person) then
    return;
  end if;
  insert into meeting_pick_lists (calendar_entry_id, person_id) values (p_entry, p_person);
  for c in select * from jsonb_array_elements(coalesce(p_carry, '[]'::jsonb)) loop
    exit when (select count(*) from meeting_topic_picks where calendar_entry_id = p_entry and person_id = p_person) >= 5;
    v_topic := public._meeting_topic_id(p_entry, c->>'topic_key');
    continue when v_topic is null;
    insert into meeting_topic_picks (topic_id, calendar_entry_id, person_id, priority, first_asked_on, note, later, entered_by_person_id)
    values (
      v_topic, p_entry, p_person,
      nullif(c->>'priority', '')::smallint,
      coalesce(nullif(c->>'first_asked_on', '')::date, (now() at time zone 'America/Chicago')::date),
      nullif(left(btrim(coalesce(c->>'note', '')), 200), ''),
      false,
      nullif(c->>'entered_by_person_id', '')::bigint
    )
    on conflict (topic_id, person_id) do nothing;
  end loop;
  -- A carried order with gaps (a finished pick dropped off) renumbers 1..n; an unranked list stays unranked.
  update meeting_topic_picks p set priority = o.n
    from (
      select topic_id, row_number() over (order by priority, topic_id) as n
        from meeting_topic_picks where calendar_entry_id = p_entry and person_id = p_person and priority is not null
    ) o
   where p.topic_id = o.topic_id and p.person_id = p_person;
end;
$function$;

CREATE OR REPLACE FUNCTION public._meeting_seed_guard(p_entry bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_seed:%s', p_entry), 0));
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

CREATE OR REPLACE FUNCTION public._meeting_teach_guard(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_op text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
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

CREATE OR REPLACE FUNCTION public.meeting_set_intent(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_intent text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  if p_intent not in ('coming', 'undecided', 'not_coming') then raise exception 'Unknown answer %', p_intent; end if;
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if not public._meeting_may_act_for(p_actor, p_person, p_leader) then
    raise exception 'You can only answer for yourself or the scouts in your household.';
  end if;
  if public.meeting_board_mode(p_entry) = 'closed' then
    raise exception 'There are no sign-ups for this meeting.';
  end if;
  insert into meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id)
  values (p_entry, p_person, p_intent, p_actor)
  on conflict (calendar_entry_id, person_id)
  do update set intent = excluded.intent, entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
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
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key and seeded_at is not null;
  if v_topic is null then return; end if;
  -- Lock the topic first (waits out a pick or a teacher being added to it), so the check below sees it.
  perform 1 from meeting_topics where id = v_topic for update;
  delete from meeting_topics t
   where t.id = v_topic
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id)
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id);
  if found then return; end if;
  update meeting_topics set seeded_by_person_id = null, seeded_at = null where id = v_topic;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meeting_unteach_topic(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_topic bigint;
begin
  perform public._meeting_teach_guard(p_entry, p_person, p_actor, p_leader, 'edit');
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = p_topic_key;
  if v_topic is null then return; end if;
  delete from meeting_topic_teachers where topic_id = v_topic and person_id = p_person;
  -- Lock the topic first (waits out a scout's pick being added to it), so the check below sees that pick.
  perform 1 from meeting_topics where id = v_topic for update;
  delete from meeting_topics t
   where t.id = v_topic and t.kind = 'freeform'
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id)
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id);
end;
$function$;

create or replace function public.meeting_live_set_presence(p_entry bigint, p_actor bigint, p_person bigint, p_present boolean) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  insert into meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id)
  values (p_entry, p_person, coalesce(p_present, false), p_actor)
  on conflict (calendar_entry_id, person_id) do update
    set present = excluded.present, entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
end;
$$;
revoke all on function public.meeting_live_set_presence(bigint, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.meeting_live_set_presence(bigint, bigint, bigint, boolean) to service_role;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'meeting\_live\_%' or p.proname in ('_meeting_live_begin', '_meeting_live_bump', '_meeting_live_edit', '_meeting_live_lock',
            '_meeting_live_lock_if_started', '_meeting_reconcile_core', '_meeting_reconcile_trigger', '_meeting_should_arrange',
            '_meeting_topic_on_plan', '_meeting_plan_teacher', 'meeting_reconcile'))
       and p.proname <> 'meeting_live_set_presence'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end;
$$;

drop table if exists public.meeting_class_members;
drop table if exists public.meeting_live_holds;
drop table if exists public.meeting_classes;
drop table if exists public.meeting_rotations;
drop table if exists public.meeting_plans;
alter table public.meeting_boards drop column if exists live_started_at, drop column if exists live_version, drop column if exists attendance_seeded_at;
alter table public.meeting_topics drop column if exists class_set_aside_at;

-- ── 2. the board stamp: + roles, night badges, snapshots and presence; − live_version ──────────────────────────────────────────────────────────────────
create or replace function public.meeting_board_stamp(p_entry bigint) returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select concat_ws(':',
    (select count(*) from meeting_topic_picks where calendar_entry_id = p_entry),
    (select count(*) from meeting_intents where calendar_entry_id = p_entry),
    (select count(*) from meeting_pick_lists where calendar_entry_id = p_entry),
    (select count(*) from meeting_topic_teachers where calendar_entry_id = p_entry),
    (select count(*) from meeting_teaching_offers where calendar_entry_id = p_entry),
    (select count(*) from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null),
    (select count(*) from event_attendance where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_roles where calendar_entry_id = p_entry),
    (select count(*) from meeting_night_badges where calendar_entry_id = p_entry),
    (select count(*) from meeting_plan_snapshots where calendar_entry_id = p_entry),
    (select count(*) from meeting_live_presence where calendar_entry_id = p_entry and present),
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select max(recorded_at) from event_attendance where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_roles where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_night_badges where calendar_entry_id = p_entry),
        (select max(published_at) from meeting_plan_snapshots where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_live_presence where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

-- ── 3. merge_people: the Rotations lines removed (20261228100000's body otherwise) ─────────────────────────
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
  -- Phase 3: the leader who left a menu its review note.
  update public.mm_menus set reviewed_by_person_id = p_survivor where reviewed_by_person_id = p_loser;
  -- Planned by: the survivor inherits the loser's planner rows (a menu both planned keeps one).
  update public.mm_menu_planners p set person_id = p_survivor
  where p.person_id = p_loser
    and not exists (select 1 from public.mm_menu_planners x where x.menu_id = p.menu_id and x.person_id = p_survivor);
  delete from public.mm_menu_planners where person_id = p_loser;
  -- Teaching (Phase 0a): the survivor keeps every skill and counselor badge either side had.
  insert into public.teaching_skills (person_id, skill_id, authorized_by, authorized_at)
  select p_survivor, t.skill_id, t.authorized_by, t.authorized_at from public.teaching_skills t where t.person_id = p_loser
  on conflict do nothing;
  delete from public.teaching_skills where person_id = p_loser;
  insert into public.merit_badge_counselors (mb_id, person_id, leader_code, sort_order)
  select m.mb_id, p_survivor, null, m.sort_order from public.merit_badge_counselors m where m.person_id = p_loser
  on conflict do nothing;
  delete from public.merit_badge_counselors where person_id = p_loser;
  -- Meeting board (Phase 1): the survivor keeps every pick, pick list and answer either side had (a board both used
  -- keeps the survivor's), and becomes whoever entered the loser's rows. The survivor may end up over 5 picks on a
  -- board: accepted (rare, harmless; the cap applies to the next add).
  insert into public.meeting_pick_lists (calendar_entry_id, person_id, created_at)
  select l.calendar_entry_id, p_survivor, l.created_at from public.meeting_pick_lists l where l.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_pick_lists where person_id = p_loser;
  insert into public.meeting_topic_picks (topic_id, calendar_entry_id, person_id, priority, first_asked_on, note, later, entered_by_person_id, created_at, updated_at)
  select k.topic_id, k.calendar_entry_id, p_survivor, k.priority, k.first_asked_on, k.note, k.later, k.entered_by_person_id, k.created_at, k.updated_at
    from public.meeting_topic_picks k where k.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_topic_picks where person_id = p_loser;
  insert into public.meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id, updated_at)
  select i.calendar_entry_id, p_survivor, i.intent, i.entered_by_person_id, i.updated_at from public.meeting_intents i where i.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_intents where person_id = p_loser;
  update public.meeting_topic_picks set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  update public.meeting_intents set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Teacher board (Phase 2): the survivor keeps every commitment and skill offer either side had (a topic or skill both
  -- signed up for keeps the survivor's row), and becomes whoever entered the loser's rows. The survivor may end up over
  -- 2 on a meeting: accepted (rare, harmless; the cap applies to the next add).
  insert into public.meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id, created_at, updated_at, for_picks)
  select t.topic_id, t.calendar_entry_id, p_survivor, t.note, t.entered_by_person_id, t.created_at, t.updated_at, t.for_picks
    from public.meeting_topic_teachers t where t.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_topic_teachers where person_id = p_loser;
  insert into public.meeting_teaching_offers (calendar_entry_id, person_id, skill_id, note, entered_by_person_id, created_at, updated_at)
  select o.calendar_entry_id, p_survivor, o.skill_id, o.note, o.entered_by_person_id, o.created_at, o.updated_at
    from public.meeting_teaching_offers o where o.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_teaching_offers where person_id = p_loser;
  update public.meeting_topic_teachers set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  update public.meeting_teaching_offers set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Wreath sale (W-1): the survivor becomes the last editor of any order note the loser saved.
  update public.wreath_orders set order_note_updated_by_person_id = p_survivor where order_note_updated_by_person_id = p_loser;
  -- Meeting Planner P3: the survivor becomes whoever seeded a topic or created a focus set the loser did.
  update public.meeting_topics set seeded_by_person_id = p_survivor where seeded_by_person_id = p_loser;
  update public.focus_sets set created_by_person_id = p_survivor where created_by_person_id = p_loser;
  -- Meeting Live attendance (P4c): the survivor keeps every event either side attended (an event both attended keeps
  -- the survivor's row). Ledger credit is keyed by scout and needs no move.
  insert into public.event_attendance (calendar_entry_id, person_id, qty, source, note, recorded_by, recorded_at)
  select a.calendar_entry_id, p_survivor, a.qty, a.source, a.note, a.recorded_by, a.recorded_at
    from public.event_attendance a where a.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.event_attendance where person_id = p_loser;
  -- Meeting Live draft presence (B8): the survivor keeps every draft tick either side had (a meeting both were ticked
  -- at keeps the survivor's row), and becomes whoever entered the loser's ticks.
  insert into public.meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id, updated_at)
  select lp.calendar_entry_id, p_survivor, lp.present, lp.entered_by_person_id, lp.updated_at
    from public.meeting_live_presence lp where lp.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_live_presence where person_id = p_loser;
  update public.meeting_live_presence set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Talent discovery (B10c): the survivor keeps every active interest either side had. A key both hold keeps the
  -- survivor's row; the loser's duplicate is dropped. Removed rows (history) move as they are.
  delete from public.teaching_interests l
   where l.person_id = p_loser and l.removed_at is null
     and exists (select 1 from public.teaching_interests s where s.person_id = p_survivor and s.topic_key = l.topic_key and s.removed_at is null);
  update public.teaching_interests set person_id = p_survivor where person_id = p_loser;
  -- Meeting Planner III (P2): the loser's hand choices become the survivor's (a meeting both had a choice at keeps the
  -- survivor's), and the survivor becomes whoever set a choice or added a night's badge.
  insert into public.meeting_scout_roles (calendar_entry_id, person_id, role, ref_key, set_by_person_id, set_at)
  select r.calendar_entry_id, p_survivor, r.role, r.ref_key, r.set_by_person_id, r.set_at
    from public.meeting_scout_roles r where r.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_scout_roles where person_id = p_loser;
  update public.meeting_scout_roles set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  update public.meeting_night_badges set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  update public.meeting_plan_snapshots set published_by_person_id = p_survivor where published_by_person_id = p_loser;
  -- A family link keeps working for the survivor only if it was the loser's live epoch; its scouts follow the merge.
  update public.meeting_plan_pages pg
     set recipient_person_id = p_survivor,
         recipient_epoch = case when pg.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else pg.recipient_epoch end
   where pg.recipient_person_id = p_loser;
  update public.meeting_plan_pages
     set scout_person_ids = array(select distinct unnest(array_replace(scout_person_ids, p_loser, p_survivor)))
   where p_loser = any (scout_person_ids);
  -- Teacher answer pages (B10b): the loser's pages and the teach rows on them become the survivor's. A page still
  -- open takes the survivor's session_epoch, so the link already in the (now the survivor's) inbox keeps working;
  -- a page already voided by a sign-out-everywhere stays void (its open rows were consumed then).
  update public.meeting_invite_pages pg
     set recipient_person_id = p_survivor,
         recipient_epoch = case when pg.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else pg.recipient_epoch end
   where pg.recipient_person_id = p_loser;
  update public.meeting_invites mi
     set invitee_person_id = case when mi.invitee_person_id = p_loser then p_survivor else mi.invitee_person_id end,
         recipient_person_id = case when mi.recipient_person_id = p_loser then p_survivor else mi.recipient_person_id end,
         invitee_epoch = case when mi.invitee_person_id = p_loser and mi.invitee_epoch = v_loser.session_epoch then v_survivor.session_epoch else mi.invitee_epoch end,
         recipient_epoch = case when mi.recipient_person_id = p_loser and mi.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else mi.recipient_epoch end
   where mi.page_id is not null and (mi.invitee_person_id = p_loser or mi.recipient_person_id = p_loser);
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

revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_board_stamp(bigint) to service_role;
revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;
