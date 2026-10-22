-- Meeting Planner II, P4c: attendance and visitors on Meeting Live (Plans/Meeting-Planner-II.md Decision 9; the
-- tech-lead's P4 spec section 4). event_attendance stays the one presence truth (Roll Call reads it); the attendance
-- writes themselves go through lib/attendance-admin (recordAttendance / removeAttendance) so a scout's meeting credit
-- still cascades to the ledger. This migration adds what the database must own:
--
-- 1. households.system_key: a household the system keeps for itself, never a family. 'meeting-visitors' hosts every
--    Meeting Live visitor (a guest person needs a host household: Plans/Guests-As-People.md). Every household list
--    leaves system households out (.is('system_key', null)).
-- 2. meeting_live_add_visitor: under the meeting's Live lock, get-or-create the visitors household, then the guest
--    person, their attendance row and (optionally) their seat in a class. A visitor is not a scout: no ledger credit.
-- 3. meeting_live_claim_seed: the one-time "placed scouts and teachers are here" seed on the meeting day, claimed under
--    the lock through meeting_boards.attendance_seeded_at (P4a's column), so two leaders opening Live at once seed once.
-- 4. meeting_live_touch: bump live_version after an attendance write (the pollers' signal).
-- 5. meeting_board_stamp: + this meeting's attendance (count and latest write), so the board sees it too.
-- 6. merge_people: + event_attendance (a meeting both attended keeps the survivor's row). It never moved before.
--
-- DEPLOY ORDER: DB-first (an additive column, new functions, a stamp that only adds terms), then the code.
-- Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE revoked from public/anon/authenticated
-- (merge_people keeps its definer posture).

-- ── 1. households.system_key ──────────────────────────────────────────────────────────────────────────────────────
alter table public.households add column if not exists system_key text;
alter table public.households drop constraint if exists households_system_key_check;
alter table public.households add constraint households_system_key_check check (system_key is null or system_key ~ '^[a-z][a-z-]{0,39}$');
create unique index if not exists households_system_key on public.households (system_key) where system_key is not null;

-- ── 2. meeting_live_add_visitor ───────────────────────────────────────────────────────────────────────────────────
-- A visitor by name (2–80 characters): a guest person hosted by the 'meeting-visitors' household, marked here, and in
-- class p_to when given (Live must have started; a class from another meeting = 'STALE'). Returns the person's id.
create or replace function public.meeting_live_add_visitor(
  p_entry bigint, p_actor bigint, p_by text, p_name text, p_to bigint, p_qty numeric
) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  v_household bigint;
  v_person bigint;
  v_first text;
  v_last text;
begin
  perform public._meeting_live_lock(p_entry);
  if char_length(v_name) < 2 then raise exception 'Give the visitor a name.'; end if;
  if p_to is not null then
    if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null
       or not exists (select 1 from meeting_classes where id = p_to and calendar_entry_id = p_entry) then
      raise exception 'STALE';
    end if;
  end if;
  insert into households (label, system_key) values ('Meeting visitors', 'meeting-visitors')
  on conflict (system_key) where system_key is not null do nothing;
  select id into v_household from households where system_key = 'meeting-visitors';
  v_first := split_part(v_name, ' ', 1);
  v_last := nullif(btrim(substr(v_name, char_length(v_first) + 1)), '');
  insert into people (display_name, first_name, last_name, guest_host_household_id)
  values (v_name, v_first, v_last, v_household)
  returning id into v_person;
  insert into event_attendance (calendar_entry_id, person_id, qty, source, recorded_by)
  values (p_entry, v_person, p_qty, 'manual', p_by);
  if p_to is not null then
    insert into meeting_class_members (class_id, person_id, entered_by_person_id) values (p_to, v_person, p_actor);
  end if;
  update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
  return v_person;
end;
$$;

-- ── 3. meeting_live_claim_seed ────────────────────────────────────────────────────────────────────────────────────
-- True exactly once per meeting, and only once Live has started: the caller then seeds attendance.
create or replace function public.meeting_live_claim_seed(p_entry bigint) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_lock(p_entry);
  update meeting_boards set attendance_seeded_at = now()
   where calendar_entry_id = p_entry and live_started_at is not null and attendance_seeded_at is null;
  return found;
end;
$$;

-- ── 4. meeting_live_touch ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_live_touch(p_entry bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_lock(p_entry);
  update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
end;
$$;

-- ── 5. meeting_board_stamp: + attendance ──────────────────────────────────────────────────────────────────────────
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
    (select count(*) from meeting_stations where calendar_entry_id = p_entry),
    (select count(*) from meeting_rotation_placements where calendar_entry_id = p_entry),
    (select count(*) from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null),
    (select coalesce(live_version, 0) from meeting_boards where calendar_entry_id = p_entry),
    (select count(*) from event_attendance where calendar_entry_id = p_entry),
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_stations where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_rotation_placements where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select max(recorded_at) from event_attendance where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

revoke all on function public.meeting_live_add_visitor(bigint, bigint, text, text, bigint, numeric) from public, anon, authenticated;
revoke all on function public.meeting_live_claim_seed(bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_touch(bigint) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_live_add_visitor(bigint, bigint, text, text, bigint, numeric) to service_role;
grant execute on function public.meeting_live_claim_seed(bigint) to service_role;
grant execute on function public.meeting_live_touch(bigint) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 6. merge_people: + event_attendance ───────────────────────────────────────────────────────────────────────────
-- Body is 20261206100000's (identical to production's) with only the attendance lines added after Meeting Live's.
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
  -- Meeting board (Phase 3b): the survivor keeps a rotation placement either side had (a night both were placed on
  -- keeps the survivor's), and becomes whoever entered the loser's.
  insert into public.meeting_rotation_placements (calendar_entry_id, person_id, group_index, helper_topic_id, other_work, entered_by_person_id, updated_at)
  select r.calendar_entry_id, p_survivor, r.group_index, r.helper_topic_id, r.other_work, r.entered_by_person_id, r.updated_at
    from public.meeting_rotation_placements r where r.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_rotation_placements where person_id = p_loser;
  update public.meeting_rotation_placements set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Wreath sale (W-1): the survivor becomes the last editor of any order note the loser saved.
  update public.wreath_orders set order_note_updated_by_person_id = p_survivor where order_note_updated_by_person_id = p_loser;
  -- Meeting Planner P3: the survivor becomes whoever seeded a topic or created a focus set the loser did.
  update public.meeting_topics set seeded_by_person_id = p_survivor where seeded_by_person_id = p_loser;
  update public.focus_sets set created_by_person_id = p_survivor where created_by_person_id = p_loser;
  -- Meeting Live (P4): the survivor teaches the loser's classes, sits in the loser's classes (a class both were in
  -- keeps one row), and becomes whoever entered the loser's classes and members.
  update public.meeting_classes set teacher_person_id = p_survivor where teacher_person_id = p_loser;
  update public.meeting_classes set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  insert into public.meeting_class_members (class_id, person_id, entered_by_person_id, updated_at)
  select m.class_id, p_survivor, m.entered_by_person_id, m.updated_at from public.meeting_class_members m where m.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_class_members where person_id = p_loser;
  update public.meeting_class_members set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Meeting Live attendance (P4c): the survivor keeps every event either side attended (an event both attended keeps
  -- the survivor's row). Ledger credit is keyed by scout and needs no move.
  insert into public.event_attendance (calendar_entry_id, person_id, qty, source, note, recorded_by, recorded_at)
  select a.calendar_entry_id, p_survivor, a.qty, a.source, a.note, a.recorded_by, a.recorded_at
    from public.event_attendance a where a.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.event_attendance where person_id = p_loser;
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
$function$

;
