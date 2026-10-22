-- Build a Plan B8 (Plans/Build-A-Plan.md "B8: Meeting Live is reversible; attendance is approved, never automatic";
-- D-429, amending Meeting Planner II Decision 9 and D-426). Patrick: "Nothing should happen automatically."
--
-- 1. meeting_live_presence: Meeting Live's DRAFT presence. A tap on Live ("Mark here" / "Mark not present") is stored
--    here and never touches event_attendance or the ledger. One row per (meeting, person): present true or false; no
--    row = no tap. Attendance is recorded after the meeting, through an approval checklist, by the app (Roll Call's
--    cascade in lib/attendance-admin, ledger credit included). Not a column on meeting_class_members: people in the
--    pool (here, nothing assigned) and visitors are in no class, and Discard deletes the classes.
-- 2. meeting_live_set_presence(entry, actor, person, present): one draft tap, under the meeting's Live lock; bumps
--    live_version (the pollers' signal), creating the meeting_boards row when Live hasn't started.
-- 3. meeting_live_add_visitor_draft(entry, actor, name, to): "+ Add as visitor" without attendance. The guest person
--    (hosted by the 'meeting-visitors' system household, D-427) gets a draft presence row instead of an
--    event_attendance row. meeting_live_add_visitor (20261208100000) is left exactly as it is, for the code in
--    production until this deploy's code replaces it.
-- 4. meeting_live_discard(entry, actor): "Discard Live arrangement", under the Live lock. Deletes the classes FIRST
--    (their members cascade; the class→topic FK is NO ACTION, so topics are never touched), then the rotations, then the
--    draft ticks of everyone who is not a visitor; clears live_started_at and bumps live_version, so the matcher view
--    returns and new picks flow again. KEEPS event_attendance (recorded attendance), visitors (guest people, and their
--    draft row so they stay on this meeting), meeting_topics (offerings) and meeting_topic_teachers (teacher sign-ups).
--    Returns true when there was an arrangement to discard.
--
-- 5. merge_people moves meeting_live_presence (B8 qa; see section 5). No other existing function or table changes.
-- meeting_live_claim_seed and meeting_live_add_visitor stay for the code in
-- production; the new code no longer calls either (the day-of auto-seed is gone).
--
-- DEPLOY ORDER: DB-first. Everything here is additive (a new table, new functions, and merge_people with one more
-- move), so the code in production
-- (main = bb45acc7) runs unchanged against it: it still seeds and writes attendance from Live until the new code ships,
-- and it never reads the presence table. Then the code. A draft tick made in the window between deploys is in the
-- table the new code reads, and attendance the old code wrote stays recorded.
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker with
-- search_path pinned and EXECUTE only to service_role.

-- ── 1. meeting_live_presence ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_live_presence (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  present boolean not null,
  entered_by_person_id bigint references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id)
);
create index if not exists meeting_live_presence_person_idx on public.meeting_live_presence (person_id);
create index if not exists meeting_live_presence_entered_by_idx on public.meeting_live_presence (entered_by_person_id) where entered_by_person_id is not null;
alter table public.meeting_live_presence enable row level security;
revoke all on public.meeting_live_presence from anon, authenticated;

-- ── 2. meeting_live_set_presence ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_live_set_presence(p_entry bigint, p_actor bigint, p_person bigint, p_present boolean) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_lock(p_entry);
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  insert into meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id)
  values (p_entry, p_person, coalesce(p_present, false), p_actor)
  on conflict (calendar_entry_id, person_id) do update
    set present = excluded.present, entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
  insert into meeting_boards (calendar_entry_id) values (p_entry) on conflict (calendar_entry_id) do nothing;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- ── 3. meeting_live_add_visitor_draft ─────────────────────────────────────────────────────────────────────────────
-- A visitor by name (2–80 characters): a guest person hosted by the 'meeting-visitors' household, ticked here in the
-- draft, and in class p_to when given (Live must have started; a class from another meeting = 'STALE'). No attendance.
-- Returns the person's id.
create or replace function public.meeting_live_add_visitor_draft(p_entry bigint, p_actor bigint, p_name text, p_to bigint) returns bigint
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
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
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
  insert into meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id)
  values (p_entry, v_person, true, p_actor);
  if p_to is not null then
    insert into meeting_class_members (class_id, person_id, entered_by_person_id) values (p_to, v_person, p_actor);
  end if;
  insert into meeting_boards (calendar_entry_id) values (p_entry) on conflict (calendar_entry_id) do nothing;
  perform public._meeting_live_bump(p_entry);
  return v_person;
end;
$$;

-- ── 4. meeting_live_discard ───────────────────────────────────────────────────────────────────────────────────────
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

revoke all on function public.meeting_live_set_presence(bigint, bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public.meeting_live_add_visitor_draft(bigint, bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_discard(bigint, bigint) from public, anon, authenticated;
grant execute on function public.meeting_live_set_presence(bigint, bigint, bigint, boolean) to service_role;
grant execute on function public.meeting_live_add_visitor_draft(bigint, bigint, text, bigint) to service_role;
grant execute on function public.meeting_live_discard(bigint, bigint) to service_role;

-- ── 5. merge_people moves the draft (B8 qa) ──────────────────────────────────────────────────────────────────────
-- merge_people re-created from its current definition (pg_get_functiondef), changed only to move
-- meeting_live_presence: the loser's rows go to the survivor (on conflict do nothing: the survivor's row wins), the
-- loser's are deleted, and entered_by_person_id is repointed. Posture unchanged: SECURITY DEFINER, search_path=public,
-- EXECUTE only to service_role. Replacing it is safe for the code in production (same signature, same behavior plus
-- the move of a table the old code never writes).
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
  -- Meeting Live draft presence (B8): the survivor keeps every draft tick either side had (a meeting both were ticked
  -- at keeps the survivor's row), and becomes whoever entered the loser's ticks.
  insert into public.meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id, updated_at)
  select lp.calendar_entry_id, p_survivor, lp.present, lp.entered_by_person_id, lp.updated_at
    from public.meeting_live_presence lp where lp.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_live_presence where person_id = p_loser;
  update public.meeting_live_presence set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
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

revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;
