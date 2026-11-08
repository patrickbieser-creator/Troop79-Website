-- Station rotations step 3 (Plans/Planner-Station-Rotations.md): a meeting's Stations mode and its station order.
--
-- 1. meeting_rotations: one row per meeting that has ever used Stations; stations_on is the switch. Turning it off
--    keeps the stations (and, in step 4, the hand moves) so turning it on again brings them back (decision 10).
-- 2. meeting_rotation_stations: the meeting's stations in order, each a seeded focus set topic ('fg:<setId>', the
--    per-night snapshot of the set). A topic deleted with its set goes with it (cascade); unseeding drops it too (5).
--    Named apart from the retired Build-a-Plan meeting_stations (dropped 20261210100000) on purpose.
-- 3. meeting_set_rotation(entry, on): the switch, under the meeting's seed lock. Turning on with no stations yet
--    makes every seeded focus set a station, in the order they were added.
-- 4. meeting_order_stations(entry, keys): replaces the station list with these focus set topics, in this order.
-- 5. meeting_unseed_topic: drops the topic's station row first (20261229100000's body otherwise).
-- 6. meeting_board_stamp: + both tables (count and max(updated_at)) so the poller refreshes on a change.
--
-- No person columns, so merge_people is unchanged. No date/timestamp column needing a _from_1900 CHECK beyond the
-- updated_at defaults (now()), which carry theirs below.
-- DEPLOY ORDER: DB-first (additive tables and functions). Posture (D-051 / D-239): RLS on, no policies, nothing
-- granted to anon or authenticated; functions invoker with search_path pinned, EXECUTE to service_role only.

-- ── 1–2. tables ───────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_rotations (
  calendar_entry_id bigint primary key references public.calendar_entries(id) on delete cascade,
  stations_on boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint updated_at_from_1900 check (updated_at >= '1900-01-01')
);
alter table public.meeting_rotations enable row level security;
revoke all on public.meeting_rotations from anon, authenticated;

create table if not exists public.meeting_rotation_stations (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  topic_id bigint not null references public.meeting_topics(id) on delete cascade,
  position smallint not null check (position between 1 and 50),
  updated_at timestamptz not null default now(),
  primary key (calendar_entry_id, topic_id),
  constraint meeting_rotation_stations_position_unique unique (calendar_entry_id, position),
  constraint updated_at_from_1900 check (updated_at >= '1900-01-01')
);
create index if not exists meeting_rotation_stations_topic_idx on public.meeting_rotation_stations (topic_id);
alter table public.meeting_rotation_stations enable row level security;
revoke all on public.meeting_rotation_stations from anon, authenticated;

-- ── 3. the switch ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_set_rotation(p_entry bigint, p_on boolean) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_seed_guard(p_entry);
  if p_on is null then raise exception 'Malformed request'; end if;
  insert into meeting_rotations (calendar_entry_id, stations_on, updated_at)
  values (p_entry, p_on, now())
  on conflict (calendar_entry_id) do update set stations_on = excluded.stations_on, updated_at = now();
  if p_on and not exists (select 1 from meeting_rotation_stations where calendar_entry_id = p_entry) then
    insert into meeting_rotation_stations (calendar_entry_id, topic_id, position, updated_at)
    select p_entry, t.id, (row_number() over (order by t.seeded_at, t.id))::smallint, now()
      from meeting_topics t
     where t.calendar_entry_id = p_entry and t.kind = 'focus_group' and t.seeded_at is not null
     order by t.seeded_at, t.id
     limit 50;
  end if;
end;
$$;

-- ── 4. the order ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_order_stations(p_entry bigint, p_keys text[]) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[] := '{}';
  v_id bigint;
  k text;
begin
  perform public._meeting_seed_guard(p_entry);
  if p_keys is null or cardinality(p_keys) > 50 then raise exception 'Malformed request'; end if;
  if (select count(distinct x) from unnest(p_keys) x) <> cardinality(p_keys) then raise exception 'A station is listed twice.'; end if;
  foreach k in array p_keys loop
    select t.id into v_id from meeting_topics t
     where t.calendar_entry_id = p_entry and t.topic_key = k and t.kind = 'focus_group' and t.seeded_at is not null;
    if v_id is null then raise exception 'Only a focus set on this meeting can be a station.'; end if;
    v_ids := v_ids || v_id;
  end loop;
  delete from meeting_rotation_stations where calendar_entry_id = p_entry;
  insert into meeting_rotation_stations (calendar_entry_id, topic_id, position, updated_at)
  select p_entry, id, o::smallint, now() from unnest(v_ids) with ordinality u(id, o);
  -- An order change counts as a change of the switch row too (the stamp's max(updated_at) sees an emptied list); a
  -- first-ever order leaves Stations off (the switch alone turns it on).
  insert into meeting_rotations (calendar_entry_id, stations_on, updated_at) values (p_entry, false, now())
  on conflict (calendar_entry_id) do update set updated_at = now();
end;
$$;

-- ── 5. unseeding drops the station ────────────────────────────────────────────────────────────────────────────────
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
  -- Station rotations: a focus set off the night is no longer a station, even when picks or teachers keep its row.
  delete from meeting_rotation_stations where topic_id = v_topic;
  if found then
    update meeting_rotations set updated_at = now() where calendar_entry_id = p_entry;
  end if;
  delete from meeting_topics t
   where t.id = v_topic
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id)
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id);
  if found then return; end if;
  update meeting_topics set seeded_by_person_id = null, seeded_at = null where id = v_topic;
end;
$function$;

revoke all on function public.meeting_set_rotation(bigint, boolean) from public, anon, authenticated;
revoke all on function public.meeting_order_stations(bigint, text[]) from public, anon, authenticated;
revoke all on function public.meeting_unseed_topic(bigint, text) from public, anon, authenticated;
grant execute on function public.meeting_set_rotation(bigint, boolean) to service_role;
grant execute on function public.meeting_order_stations(bigint, text[]) to service_role;
grant execute on function public.meeting_unseed_topic(bigint, text) to service_role;

-- ── 6. meeting_board_stamp: + stations ────────────────────────────────────────────────────────────────────────────
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
    (select count(*) from meeting_live_presence where calendar_entry_id = p_entry and present),
    (select count(*) from meeting_scout_exclusions where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_suggestions where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_helpers where calendar_entry_id = p_entry),
    (select count(*) from meeting_emails where calendar_entry_id = p_entry and status = 'sent'),
    (select count(*) from meeting_group_splits where calendar_entry_id = p_entry and merged_at is null),
    (select count(*) from meeting_teacher_answers where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_answers where calendar_entry_id = p_entry),
    (select count(*) from meeting_rotation_stations where calendar_entry_id = p_entry),
    (select count(*) from meeting_rotations where calendar_entry_id = p_entry and stations_on),
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
        (select max(updated_at) from meeting_live_presence where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_exclusions where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_scout_suggestions where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_helpers where calendar_entry_id = p_entry),
        (select max(sent_at) from meeting_emails where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_group_splits where calendar_entry_id = p_entry),
        (select max(answered_at) from meeting_teacher_answers where calendar_entry_id = p_entry),
        (select max(answered_at) from meeting_scout_answers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_rotation_stations where calendar_entry_id = p_entry),
        (select updated_at from meeting_rotations where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_board_stamp(bigint) to service_role;
