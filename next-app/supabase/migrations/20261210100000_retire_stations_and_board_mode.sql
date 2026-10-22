-- Meeting Planner II, P5c: retire the stations, the rotation arrangement and the stored board mode
-- (2026-10-21, Plans/Meeting-Planner-II.md Decisions 1 and 10).
--
-- A merit badge night is just a meeting (Decision 10): no separate mode, no whole-badge pick, no stations screen.
-- Admin's This Sunday tab, its board settings and its rotations editor are gone (Decision 1); the planner at /planner
-- and Meeting Live replace them. This migration removes what only they used:
--
--   functions  meeting_set_board, meeting_set_stations, meeting_save_rotations
--   tables     meeting_rotation_placements, meeting_stations (v1 test data only; not migrated, per Decision 10)
--   columns    meeting_boards.board_mode, board_mb_id, block_count (+ their checks, incl. meeting_boards_mb_only_in_mb_mode)
--
-- and re-creates, from the current definitions with ONLY the station/mode branches removed (D-418 precedent):
--
--   meeting_board_mode     derived from the calendar only ('rank' for an open troop meeting, else 'closed'). Kept, not
--                          dropped: _meeting_pick_guard, meeting_set_intent, _meeting_seed_guard, _meeting_teach_guard
--                          and meeting_live_start all ask it, and their bodies need no change once it is derived.
--   meeting_board_stamp    loses the two station/placement counts and timestamps
--   merge_people           loses the rotation-placement block (stays SECURITY DEFINER, search_path public, as before)
--   _meeting_teach_guard   loses the 'add_station' op
--   meeting_teach_topic    loses the station lookup (always op 'add')
--   meeting_unseed_topic   loses the meeting_stations "still in use" check (found by the pg_proc scan; not in the spec)
--   meeting_live_start     inserts the board row by calendar_entry_id only
--
-- Guard first: if either retired table holds a row, nothing runs (production has none; the scan was run 2026-10-21).
--
-- DEPLOY ORDER: code-first (the P5c code reads none of this), wait for Vercel Ready, THEN `supabase db push`.
-- Posture unchanged (D-051 / D-239): the meeting functions are invoker with search_path pinned; EXECUTE is revoked
-- from public/anon/authenticated and granted to service_role. meeting_boards keeps RLS on, no policies.

do $$
begin
  if exists (select 1 from public.meeting_stations) or exists (select 1 from public.meeting_rotation_placements) then
    raise exception 'meeting_stations or meeting_rotation_placements still has rows; P5c retires them only when empty.';
  end if;
  -- A stored merit badge or closed override would vanish silently with the column; the calendar decides from here on.
  if exists (select 1 from public.meeting_boards where board_mode <> 'rank') then
    raise exception 'meeting_boards has a non-rank board_mode; P5c drops the column only when every board is rank.';
  end if;
end;
$$;

drop function if exists public.meeting_set_board(bigint, text, text, integer);
drop function if exists public.meeting_set_stations(bigint, text, jsonb);
drop function if exists public.meeting_save_rotations(bigint, bigint, jsonb);

-- ── the board's mode: the calendar alone decides ──
CREATE OR REPLACE FUNCTION public.meeting_board_mode(p_entry bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select case
              when k.behavior = 'meeting' and c.title !~* '^\s*no\s+troop\s+meeting' then 'rank'
              else 'closed'
            end
       from calendar_entries c left join calendar_categories k on k.label = c.category
      where c.id = p_entry),
    'closed'
  );
$function$;

CREATE OR REPLACE FUNCTION public.meeting_board_stamp(p_entry bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select concat_ws(':',
    (select count(*) from meeting_topic_picks where calendar_entry_id = p_entry),
    (select count(*) from meeting_intents where calendar_entry_id = p_entry),
    (select count(*) from meeting_pick_lists where calendar_entry_id = p_entry),
    (select count(*) from meeting_topic_teachers where calendar_entry_id = p_entry),
    (select count(*) from meeting_teaching_offers where calendar_entry_id = p_entry),
    (select count(*) from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null),
    (select coalesce(live_version, 0) from meeting_boards where calendar_entry_id = p_entry),
    (select count(*) from event_attendance where calendar_entry_id = p_entry),
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select max(recorded_at) from event_attendance where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
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
    raise exception 'Teaching is for adults and Junior Leaders.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There’s no teaching sign-up for this meeting.';
  end if;
  return v_kind;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meeting_teach_topic(p_entries bigint[], p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_title text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_entries bigint[] := array(select distinct e from unnest(coalesce(p_entries, '{}'::bigint[])) e where e is not null order by 1);
  v_entry bigint;
  v_kind text;
  v_topic bigint;
  v_topics bigint[] := '{}';
  v_skill text;
begin
  if cardinality(v_entries) = 0 then raise exception 'Pick at least one date.'; end if;
  foreach v_entry in array v_entries loop
    v_kind := public._meeting_teach_guard(v_entry, p_person, p_actor, p_leader, 'add');
    if p_topic_key is null then
      v_topic := public._meeting_freeform_topic_id(v_entry, p_title);
    else
      v_topic := public._meeting_topic_id(v_entry, p_topic_key);
    end if;
    if v_topic is null then raise exception 'That isn’t something you can teach at this meeting.'; end if;
    v_skill := null;
    if v_kind = 'junior' then
      select k.id into v_skill
        from meeting_topics t
        join rank_requirements q on q.rank_id = t.rank_id and q.code = t.req_code and q.parent_id is null
        join skills k on k.id = q.skill_id
       where t.id = v_topic and not k.youth_teachable;
      if v_skill is not null then
        raise exception 'Junior Leaders can’t teach that: it’s adults only.';
      end if;
    end if;
    v_topics := v_topics || v_topic;
  end loop;
  for i in 1 .. cardinality(v_entries) loop
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id)
    values (v_topics[i], v_entries[i], p_person, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    on conflict (topic_id, person_id) do nothing;
  end loop;
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
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id)
     and not exists (select 1 from meeting_classes x where x.topic_id = t.id);
  if found then return; end if;
  update meeting_topics set seeded_by_person_id = null, seeded_at = null where id = v_topic;
end;
$function$;

-- merge_people: the current definition minus the rotation-placement block (Phase 3b).
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
    insert into meeting_class_members (class_id, person_id, entered_by_person_id)
    select v_class, m::bigint, p_actor from jsonb_array_elements_text(coalesce(c->'members', '[]'::jsonb)) m
    on conflict do nothing;
  end loop;

  update meeting_boards set live_started_at = now(), live_version = live_version + 1, updated_at = now()
   where calendar_entry_id = p_entry;
  return true;
end;
$function$;

-- ── the retired tables and columns (after every reader above is gone) ──
drop table if exists public.meeting_rotation_placements;
drop table if exists public.meeting_stations;

alter table public.meeting_boards drop constraint if exists meeting_boards_mb_only_in_mb_mode;
alter table public.meeting_boards drop constraint if exists meeting_boards_board_mode_check;
alter table public.meeting_boards drop constraint if exists meeting_boards_block_count_check;
alter table public.meeting_boards drop column if exists board_mb_id;
alter table public.meeting_boards drop column if exists board_mode;
alter table public.meeting_boards drop column if exists block_count;

-- ── posture (CREATE OR REPLACE keeps ACLs; restated so this file stands alone) ──
revoke all on function public.meeting_board_mode(bigint) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public._meeting_teach_guard(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_teach_topic(bigint[], bigint, bigint, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.meeting_unseed_topic(bigint, text) from public, anon, authenticated;
revoke all on function public.meeting_live_start(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_board_mode(bigint) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;
grant execute on function public._meeting_teach_guard(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_teach_topic(bigint[], bigint, bigint, boolean, text, text, text) to service_role;
grant execute on function public.meeting_unseed_topic(bigint, text) to service_role;
grant execute on function public.meeting_live_start(bigint, bigint, jsonb) to service_role;
