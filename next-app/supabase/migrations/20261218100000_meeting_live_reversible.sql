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
-- No existing function or table changes. meeting_live_claim_seed and meeting_live_add_visitor stay for the code in
-- production; the new code no longer calls either (the day-of auto-seed is gone).
--
-- DEPLOY ORDER: DB-first. Everything here is additive (a new table and new functions), so the code in production
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
