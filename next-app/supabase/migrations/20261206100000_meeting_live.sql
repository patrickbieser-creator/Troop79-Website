-- Meeting Planner II, P4 (Meeting Live): the saved placement (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8c, 8d,
-- 9; the tech-lead's P4 spec sections 1, 2 and 6). Built in slice P4a, designed for all of P4 so P4b (editing) and
-- P4c (attendance and visitors) need no schema rework.
--
-- 1. meeting_boards learns Live: live_started_at (set by the first Live write; from then on the saved placement is the
--    truth for that meeting and the matcher no longer applies), live_version (bumped by every Live RPC; part of the
--    board stamp, so a delete or a rotation-only edit is seen by every poller) and attendance_seeded_at (P4c: the
--    one-time "placed scouts and teachers are here" seed on the meeting day).
-- 2. meeting_rotations: a meeting's rotations (1..99, open-ended), each with an optional location.
-- 3. meeting_classes: a card on Meeting Live. One topic (a requirement, a focus group, a freeform title), an optional
--    rotation (null = Not scheduled) and teacher, a title snapshot for merged sibling picks, the matcher session it was
--    copied from (source_key) and a per-card version (P4b's compare-and-set). NO unique (entry, topic): a class may
--    repeat in several rotations (8a). The topic must belong to the same meeting (composite FK on the new
--    meeting_topics (calendar_entry_id, id) key) and is never deleted from under a class (NO ACTION, checked at the end
--    of the statement, so deleting the whole meeting still cascades cleanly).
-- 4. meeting_class_members: who is in a class. No present flag: event_attendance is the only presence truth (P4c).
--    "Coming, nothing assigned" is derived (coming ∪ attended − placed).
-- 5. meeting_live_start(entry, actor, snapshot): the first Live write copies the matcher's output into 2–4, under the
--    meeting's Live lock. Idempotent: once started it changes nothing and returns false.
-- 6. meeting_unseed_topic / meeting_unteach_topic keep a topic a class still holds (P3's unseed, v1's freeform cleanup).
-- 7. meeting_board_stamp: + live_version.
-- 8. merge_people: + class teachers, class members, and who entered them.
--
-- The legacy published-agenda table meeting_sessions (the `meetings` agenda) is NOT reused or touched; matcher
-- sessions were never stored. "Session"/"Block" becomes "Rotation" in UI words only.
--
-- DEPLOY ORDER: DB-first (additive tables, columns and functions; the two topic cleanups only keep more), then the
-- code. Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker
-- with search_path pinned and EXECUTE revoked from public/anon/authenticated (merge_people keeps its definer posture).

-- ── 1. meeting_boards ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.meeting_boards
  add column if not exists live_started_at timestamptz,
  add column if not exists live_version bigint not null default 0,
  add column if not exists attendance_seeded_at timestamptz;

-- ── 2. meeting_rotations ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_rotations (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  number smallint not null check (number between 1 and 99),
  location text check (location is null or (btrim(location) <> '' and char_length(location) <= 40)),
  updated_at timestamptz not null default now(),
  primary key (calendar_entry_id, number)
);
alter table public.meeting_rotations enable row level security;
revoke all on public.meeting_rotations from anon, authenticated;

-- ── 3. meeting_classes ────────────────────────────────────────────────────────────────────────────────────────────
-- A composite FK target, so a class's topic is always on the class's own meeting.
alter table public.meeting_topics drop constraint if exists meeting_topics_entry_id_key;
alter table public.meeting_topics add constraint meeting_topics_entry_id_key unique (calendar_entry_id, id);

create table if not exists public.meeting_classes (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  topic_id bigint not null,
  rotation smallint,
  teacher_person_id bigint references public.people(id) on delete set null,
  title text check (title is null or (btrim(title) <> '' and char_length(title) <= 120)),
  source_key text check (source_key is null or char_length(source_key) <= 200),
  position integer not null default 0,
  version integer not null default 1,
  entered_by_person_id bigint references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint meeting_classes_topic_fkey foreign key (calendar_entry_id, topic_id)
    references public.meeting_topics (calendar_entry_id, id),
  constraint meeting_classes_rotation_fkey foreign key (calendar_entry_id, rotation)
    references public.meeting_rotations (calendar_entry_id, number)
);
create unique index if not exists meeting_classes_source_key on public.meeting_classes (calendar_entry_id, source_key) where source_key is not null;
create index if not exists meeting_classes_entry_idx on public.meeting_classes (calendar_entry_id, rotation, position);
create index if not exists meeting_classes_topic_idx on public.meeting_classes (topic_id);
create index if not exists meeting_classes_teacher_idx on public.meeting_classes (teacher_person_id) where teacher_person_id is not null;
create index if not exists meeting_classes_entered_by_idx on public.meeting_classes (entered_by_person_id) where entered_by_person_id is not null;
alter table public.meeting_classes enable row level security;
revoke all on public.meeting_classes from anon, authenticated;

-- ── 4. meeting_class_members ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_class_members (
  class_id bigint not null references public.meeting_classes(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  entered_by_person_id bigint references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (class_id, person_id)
);
create index if not exists meeting_class_members_person_idx on public.meeting_class_members (person_id);
create index if not exists meeting_class_members_entered_by_idx on public.meeting_class_members (entered_by_person_id) where entered_by_person_id is not null;
alter table public.meeting_class_members enable row level security;
revoke all on public.meeting_class_members from anon, authenticated;

-- ── 5. meeting_live_start ─────────────────────────────────────────────────────────────────────────────────────────
-- The meeting's Live lock: every Live RPC (this one now, P4b's edits and P4c's attendance later) takes it first.
create or replace function public._meeting_live_lock(p_entry bigint) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtext('meeting_live:' || p_entry));
$$;

-- Copy the matcher's output into the saved placement. p_snapshot:
--   { "rotations": [{ "number": 1, "location": null }, …],
--     "classes": [{ "source_key": "12:tenderfoot-4a", "topic_key": "tenderfoot-4a", "title": null, "rotation": 1,
--                   "teacher_person_id": 12, "position": 0, "members": [101, 102] }, …] }
-- Rotations 1 and 2 always exist (most meetings use two). A class whose topic no longer resolves on this meeting is
-- left out. Returns true when this call started Meeting Live, false when it had already started (nothing changes).
create or replace function public.meeting_live_start(p_entry bigint, p_actor bigint, p_snapshot jsonb) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
  -- The board row keeps the mode the meeting already had (a derived 'rank' stays 'rank').
  insert into meeting_boards (calendar_entry_id, board_mode)
  values (p_entry, public.meeting_board_mode(p_entry))
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
$$;

-- ── 6. topic cleanups keep a topic a class still holds ────────────────────────────────────────────────────────────
-- P3's unseed (body from 20261204100000 with only the meeting_classes clause added).
create or replace function public.meeting_unseed_topic(p_entry bigint, p_key text) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
     and not exists (select 1 from meeting_stations x where x.topic_id = t.id)
     and not exists (select 1 from meeting_classes x where x.topic_id = t.id);
  if found then return; end if;
  update meeting_topics set seeded_by_person_id = null, seeded_at = null where id = v_topic;
end;
$$;

-- v1's take-back (body from 20261116100000, as production has it) with only the meeting_classes clause added.
create or replace function public.meeting_unteach_topic(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id)
     and not exists (select 1 from meeting_classes x where x.topic_id = t.id);
end;
$$;

-- ── 7. meeting_board_stamp: + live_version ────────────────────────────────────────────────────────────────────────
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
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_stations where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_rotation_placements where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

revoke all on function public._meeting_live_lock(bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_start(bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.meeting_unseed_topic(bigint, text) from public, anon, authenticated;
revoke all on function public.meeting_unteach_topic(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public._meeting_live_lock(bigint) to service_role;
grant execute on function public.meeting_live_start(bigint, bigint, jsonb) to service_role;
grant execute on function public.meeting_unseed_topic(bigint, text) to service_role;
grant execute on function public.meeting_unteach_topic(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 8. merge_people: + class teachers, class members, who entered them ────────────────────────────────────────────
-- Body is 20261204100000's (identical to production's) with only the Meeting Live lines added after P3's.
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
