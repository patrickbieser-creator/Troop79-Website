-- Meeting Planner II, P4b: editing Meeting Live (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8d, 10a; the
-- tech-lead's P4 spec sections 2 and 5). Builds on 20261206100000_meeting_live.sql (P4a's schema; no table changes).
--
-- Every Live write:
--   - takes the meeting's Live lock (_meeting_live_lock) and refuses a meeting where Live hasn't started (the server
--     action starts it first, on the first edit: copy on first write, Decision 8);
--   - bumps meeting_boards.live_version (part of meeting_board_stamp, so every poller sees deletes and rotation-only
--     edits).
-- Concurrency (two leaders on two phones):
--   - card writes (teacher, rotation, repeat, remove) carry the card's expected version; a mismatch or a card that is
--     gone raises 'STALE' and changes nothing (set teacher and move bump the card's version);
--   - a scout move is compare-and-set: delete (from class, person); no row = 'STALE'; then insert into the target;
--   - add rotation takes the count the client saw (expect_max); if it moved, nothing is added;
--   - only the last rotation drops, only when empty, and never 1 or 2; a location is last-write-wins.
-- "+ Add an offer" on Live (meeting_live_add_class) makes a card from a requirement key or a free-text title; with a
-- teacher it also records them in meeting_topic_teachers, so the board shows the offer too. Nothing here enforces the
-- matcher's caps (8d): a leader may place anyone anywhere.
--
-- Who may call these (meeting_planner.edit, the SPL included) is checked by the server action first; p_actor is
-- recorded as entered_by. DEPLOY ORDER: DB-first (new functions only), then the code.
-- Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE revoked from public/anon/authenticated.

-- The common start of every Live edit: the lock, then Live must have started.
create or replace function public._meeting_live_edit(p_entry bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_lock(p_entry);
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null then
    raise exception 'STALE';
  end if;
end;
$$;

create or replace function public._meeting_live_bump(p_entry bigint) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
$$;

-- Move a scout: from a class (null = Coming, nothing assigned) to a class (null = back to nothing assigned).
create or replace function public.meeting_live_move_scout(p_entry bigint, p_actor bigint, p_person bigint, p_from bigint, p_to bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_edit(p_entry);
  if p_from is not null then
    delete from meeting_class_members m using meeting_classes c
     where m.class_id = p_from and m.person_id = p_person and c.id = m.class_id and c.calendar_entry_id = p_entry;
    if not found then raise exception 'STALE'; end if;
  end if;
  if p_to is not null then
    if not exists (select 1 from meeting_classes where id = p_to and calendar_entry_id = p_entry) then
      raise exception 'STALE';
    end if;
    insert into meeting_class_members (class_id, person_id, entered_by_person_id)
    values (p_to, p_person, p_actor)
    on conflict (class_id, person_id) do update set entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
  end if;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- Set (or clear, p_teacher null) a card's teacher.
create or replace function public.meeting_live_set_teacher(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer, p_teacher bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
begin
  perform public._meeting_live_edit(p_entry);
  update meeting_classes
     set teacher_person_id = p_teacher, version = version + 1, entered_by_person_id = p_actor, updated_at = now()
   where id = p_class and calendar_entry_id = p_entry and version = p_expected
  returning version into v_version;
  if v_version is null then raise exception 'STALE'; end if;
  perform public._meeting_live_bump(p_entry);
  return v_version;
end;
$$;

-- Move a card to a rotation (null = Not scheduled). It goes to the end of that rotation.
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
         version = version + 1, entered_by_person_id = p_actor, updated_at = now()
   where id = p_class and calendar_entry_id = p_entry and version = p_expected
  returning version into v_version;
  if v_version is null then raise exception 'STALE'; end if;
  perform public._meeting_live_bump(p_entry);
  return v_version;
end;
$$;

-- Repeat a card into a rotation: a new card for the same class (its own teacher and scouts, both empty to start), 8a.
-- Returns the new card's id.
create or replace function public.meeting_live_repeat_class(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer, p_rotation smallint) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  perform public._meeting_live_edit(p_entry);
  if not exists (select 1 from meeting_classes where id = p_class and calendar_entry_id = p_entry and version = p_expected) then
    raise exception 'STALE';
  end if;
  if p_rotation is not null and not exists (select 1 from meeting_rotations where calendar_entry_id = p_entry and number = p_rotation) then
    raise exception 'STALE';
  end if;
  insert into meeting_classes (calendar_entry_id, topic_id, rotation, title, position, entered_by_person_id)
  select c.calendar_entry_id, c.topic_id, p_rotation, c.title,
         coalesce((select max(position) + 1 from meeting_classes x where x.calendar_entry_id = p_entry and x.rotation is not distinct from p_rotation), 0),
         p_actor
    from meeting_classes c where c.id = p_class
  returning id into v_id;
  perform public._meeting_live_bump(p_entry);
  return v_id;
end;
$$;

-- Remove a card. Its scouts go back to Coming, nothing assigned (that list is derived).
create or replace function public.meeting_live_remove_class(p_entry bigint, p_actor bigint, p_class bigint, p_expected integer) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_edit(p_entry);
  delete from meeting_classes where id = p_class and calendar_entry_id = p_entry and version = p_expected;
  if not found then raise exception 'STALE'; end if;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- "+ Add rotation": adds max + 1 only when max is still what the client saw. Returns the highest rotation after.
create or replace function public.meeting_live_add_rotation(p_entry bigint, p_actor bigint, p_expect_max smallint) returns smallint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_max smallint;
begin
  perform public._meeting_live_edit(p_entry);
  select coalesce(max(number), 0) into v_max from meeting_rotations where calendar_entry_id = p_entry;
  if v_max <> p_expect_max then return v_max; end if;
  if v_max >= 99 then raise exception 'That’s as many rotations as a meeting can hold.'; end if;
  insert into meeting_rotations (calendar_entry_id, number) values (p_entry, v_max + 1);
  perform public._meeting_live_bump(p_entry);
  return v_max + 1;
end;
$$;

-- Drop a rotation: only the last one, only when no card is in it, never Rotation 1 or 2.
create or replace function public.meeting_live_drop_rotation(p_entry bigint, p_actor bigint, p_number smallint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_edit(p_entry);
  if p_number <= 2 then raise exception 'Rotations 1 and 2 always stay.'; end if;
  if p_number <> (select max(number) from meeting_rotations where calendar_entry_id = p_entry) then
    raise exception 'Only the last rotation can be removed.';
  end if;
  if exists (select 1 from meeting_classes where calendar_entry_id = p_entry and rotation = p_number) then
    raise exception 'Move its classes out first.';
  end if;
  delete from meeting_rotations where calendar_entry_id = p_entry and number = p_number;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- A rotation's location ("Back room"); blank clears it. Last write wins.
create or replace function public.meeting_live_set_location(p_entry bigint, p_actor bigint, p_number smallint, p_location text) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_loc text := nullif(left(regexp_replace(btrim(coalesce(p_location, '')), '\s+', ' ', 'g'), 40), '');
begin
  perform public._meeting_live_edit(p_entry);
  update meeting_rotations set location = v_loc, updated_at = now() where calendar_entry_id = p_entry and number = p_number;
  if not found then raise exception 'STALE'; end if;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- "+ Add an offer" on Live: a card for a requirement (p_topic_key) or a free-text title, with an optional teacher, in a
-- rotation (null = Not scheduled). A named teacher is also signed up for the topic, so the board shows the offer.
-- Returns the new card's id.
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
  if p_teacher is not null then
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, entered_by_person_id)
    values (v_topic, p_entry, p_teacher, p_actor)
    on conflict (topic_id, person_id) do nothing;
  end if;
  perform public._meeting_live_bump(p_entry);
  return v_id;
end;
$$;

revoke all on function public._meeting_live_edit(bigint) from public, anon, authenticated;
revoke all on function public._meeting_live_bump(bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_move_scout(bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_set_teacher(bigint, bigint, bigint, integer, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_move_class(bigint, bigint, bigint, integer, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_repeat_class(bigint, bigint, bigint, integer, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_remove_class(bigint, bigint, bigint, integer) from public, anon, authenticated;
revoke all on function public.meeting_live_add_rotation(bigint, bigint, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_drop_rotation(bigint, bigint, smallint) from public, anon, authenticated;
revoke all on function public.meeting_live_set_location(bigint, bigint, smallint, text) from public, anon, authenticated;
revoke all on function public.meeting_live_add_class(bigint, bigint, text, text, bigint, smallint) from public, anon, authenticated;
grant execute on function public._meeting_live_edit(bigint) to service_role;
grant execute on function public._meeting_live_bump(bigint) to service_role;
grant execute on function public.meeting_live_move_scout(bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.meeting_live_set_teacher(bigint, bigint, bigint, integer, bigint) to service_role;
grant execute on function public.meeting_live_move_class(bigint, bigint, bigint, integer, smallint) to service_role;
grant execute on function public.meeting_live_repeat_class(bigint, bigint, bigint, integer, smallint) to service_role;
grant execute on function public.meeting_live_remove_class(bigint, bigint, bigint, integer) to service_role;
grant execute on function public.meeting_live_add_rotation(bigint, bigint, smallint) to service_role;
grant execute on function public.meeting_live_drop_rotation(bigint, bigint, smallint) to service_role;
grant execute on function public.meeting_live_set_location(bigint, bigint, smallint, text) to service_role;
grant execute on function public.meeting_live_add_class(bigint, bigint, text, text, bigint, smallint) to service_role;
