-- Meeting board, Phase 3b (Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 10, "Merit badge meeting mode"):
-- stations, teachers per station, and the leader's rotation arrangement.
--
-- 1. meeting_stations: a merit badge night's 2-6 stations. A station IS a meeting_topics row of kind 'mb_req' (the
--    existing CHECK: topic_key '<mbId>-<code>', its lead requirement), so teachers commit through the same
--    meeting_teach_topic and meeting_topic_teachers as everything else. This side table holds what a topic row can't:
--    the leader's order (position), the station's name, an optional place ("back room") and every top-level
--    requirement it covers (req_codes; the lead one is the first in catalog order). The topic row is kept across
--    edits (its key moves with the lead requirement), so a teacher stays with their station when it is renamed or its
--    requirements change.
-- 2. meeting_rotation_placements: the leader's SAVED ARRANGEMENT, keyed to the scout's PERSON: a rotation group
--    (group_index, 0-based: Group A = 0), a helper at a station (helper_topic_id, for a scout who has the badge), or
--    other work. The rotation draft (lib/meeting-board-rotations) keeps every saved scout where the leader put them and
--    drafts late sign-ups around them; nothing here is computed. Empty = the matcher's draft.
-- 3. meeting_set_stations(entry, mb, stations): sets the board to that merit badge (through meeting_set_board, so its
--    checks apply) and replaces the stations in one transaction. Refuses fewer than 2 or more than 6, a station with no
--    name or no requirement, a requirement that isn't one of the badge's top-level ones, and a requirement in two
--    stations. A removed station takes its teacher sign-ups and helper placements with it. Changing how many stations
--    there are starts the groups over from the draft (the group placements go; badge-holder placements stay).
-- 4. meeting_save_rotations(entry, actor, placements): replaces the arrangement (an empty list = "Start over from the
--    draft"). Merit badge nights only, not past ones; scouts only; a helper's station must be on this board. Placing
--    a scout who never answered records them as Coming, entered by the leader (they're here).
-- 5. meeting_set_board: leaving merit badge mode, or changing the badge, drops the stations (their teacher sign-ups
--    go with them) and the arrangement: they belong to that badge's night. Otherwise unchanged from 20261117100000.
-- 6. Teaching on a merit badge night: meeting_teach_topic accepts a STATION of that board (the guard's new
--    'add_station' op); anything else on a merit badge night is refused as before, and so is a Junior Leader (on a
--    merit badge night a scout is in a rotation or placed as a helper by a leader). Unchanged otherwise.
-- 7. meeting_board_stamp: + stations and placements, so an open This Sunday tab refreshes on either.
-- 8. merge_people: + meeting_rotation_placements (the survivor keeps a placement either side had; entered_by
--    re-points). Production's body was diffed identical to 20261116100000's first (2026-10-19).
--
-- Additive: two tables, two functions, five function bodies. DEPLOY ORDER: DB-first, then the code.
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker (the
-- callers are service role) with search_path pinned and EXECUTE revoked from public/anon/authenticated. The capability
-- check (meeting_plan.use, an adult) is the server action's.

-- ── 1. meeting_stations ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_stations (
  topic_id bigint primary key references public.meeting_topics(id) on delete cascade,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  position smallint not null check (position between 1 and 6),
  title text not null check (btrim(title) <> '' and char_length(title) <= 80),
  location text check (location is null or (btrim(location) <> '' and char_length(location) <= 60)),
  req_codes text[] not null check (cardinality(req_codes) >= 1),
  updated_at timestamptz not null default now(),
  constraint meeting_stations_entry_position unique (calendar_entry_id, position)
);
alter table public.meeting_stations enable row level security;
revoke all on public.meeting_stations from anon, authenticated;

-- ── 2. meeting_rotation_placements ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_rotation_placements (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  group_index smallint check (group_index between 0 and 25),
  helper_topic_id bigint references public.meeting_topics(id) on delete cascade,
  other_work boolean not null default false,
  entered_by_person_id bigint references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id),
  constraint meeting_rotation_placements_one_place check (num_nonnulls(group_index, helper_topic_id, nullif(other_work, false)) = 1)
);
create index if not exists meeting_rotation_placements_person_idx on public.meeting_rotation_placements (person_id);
create index if not exists meeting_rotation_placements_helper_idx on public.meeting_rotation_placements (helper_topic_id);
alter table public.meeting_rotation_placements enable row level security;
revoke all on public.meeting_rotation_placements from anon, authenticated;

-- ── 5. meeting_set_board: leaving merit badge mode (or changing the badge) drops that night's stations ──────────
create or replace function public.meeting_set_board(p_entry bigint, p_mode text, p_mb_id text, p_block_count integer)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_blocks smallint;
  v_old_mb text;
begin
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting isn’t on the calendar.';
  end if;
  -- Same day rule as the pick and answer RPCs: a meeting whose day has passed (Central) is history.
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  -- Boards belong to troop meetings (category behavior 'meeting', the rule meeting_board_mode() defaults by).
  if not exists (
    select 1 from calendar_entries c join calendar_categories k on k.label = c.category
    where c.id = p_entry and k.behavior = 'meeting'
  ) then
    raise exception 'Only troop meetings have a board.';
  end if;
  if p_mode is null or p_mode not in ('rank', 'merit_badge', 'closed') then
    raise exception 'Choose rank, merit badge or closed.';
  end if;

  if p_mode = 'rank' then
    if p_block_count is null or p_block_count not between 1 and 3 then
      raise exception 'Teaching blocks are 1, 2 or 3.';
    end if;
    v_blocks := p_block_count;
  else
    v_blocks := coalesce((select block_count from meeting_boards where calendar_entry_id = p_entry), 2);
  end if;

  if p_mode = 'merit_badge' then
    if p_mb_id is null or btrim(p_mb_id) = '' then
      raise exception 'Choose the badge for this night.';
    end if;
    if not exists (select 1 from merit_badges where id = p_mb_id) then
      raise exception 'That badge isn’t in the catalog.';
    end if;
    if not exists (select 1 from merit_badge_requirements where mb_id = p_mb_id) then
      raise exception 'That badge has no requirements entered yet, so there is nothing to build stations from.';
    end if;
  end if;

  -- Phase 3b: stations and the arrangement belong to one badge's night.
  select board_mb_id into v_old_mb from meeting_boards where calendar_entry_id = p_entry;
  if p_mode <> 'merit_badge' or v_old_mb is distinct from p_mb_id then
    delete from meeting_topics t using meeting_stations s where s.topic_id = t.id and t.calendar_entry_id = p_entry;
    delete from meeting_rotation_placements where calendar_entry_id = p_entry;
  end if;

  insert into meeting_boards (calendar_entry_id, board_mode, board_mb_id, block_count, updated_at)
  values (p_entry, p_mode, case when p_mode = 'merit_badge' then p_mb_id end, v_blocks, now())
  on conflict (calendar_entry_id) do update
    set board_mode = excluded.board_mode,
        board_mb_id = excluded.board_mb_id,
        block_count = excluded.block_count,
        updated_at = now();
end;
$$;

-- ── 3. meeting_set_stations ───────────────────────────────────────────────────────────────────────────────────────
-- p_stations: [{ "topic_id": <a saved station's topic, or null for a new one>, "title", "location", "codes": [...] }],
-- in the leader's order.
create or replace function public.meeting_set_stations(p_entry bigint, p_mb_id text, p_stations jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  s jsonb;
  v_n int := 0;
  v_old int;
  v_pos int := 0;
  v_title text;
  v_loc text;
  v_codes text[];
  v_all text[] := '{}';
  v_topic bigint;
  v_kept bigint[] := '{}';
  v_lead text;
begin
  -- The board itself: entry, day, troop meeting, a badge with requirements. Drops the stations if the badge changed.
  perform public.meeting_set_board(p_entry, 'merit_badge', p_mb_id, null);
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_stations:%s', p_entry), 0));

  if p_stations is null or jsonb_typeof(p_stations) <> 'array' then
    raise exception 'Add at least 2 stations so groups have somewhere to rotate.';
  end if;
  v_n := jsonb_array_length(p_stations);
  if v_n < 2 then raise exception 'Add at least 2 stations so groups have somewhere to rotate.'; end if;
  if v_n > 6 then raise exception 'Six stations is the most a meeting can rotate through.'; end if;

  -- Check everything before writing anything.
  for s in select * from jsonb_array_elements(p_stations) loop
    v_pos := v_pos + 1;
    v_title := btrim(coalesce(s->>'title', ''));
    if v_title = '' then raise exception 'Station % needs a name.', v_pos; end if;
    if char_length(v_title) > 80 then raise exception 'Station %’s name is too long (80 characters at most).', v_pos; end if;
    if char_length(btrim(coalesce(s->>'location', ''))) > 60 then raise exception 'Station %’s place is too long (60 characters at most).', v_pos; end if;
    v_codes := array(select distinct btrim(c) from jsonb_array_elements_text(coalesce(s->'codes', '[]'::jsonb)) c where btrim(c) <> '');
    if cardinality(v_codes) = 0 then raise exception 'Station % needs at least one requirement.', v_pos; end if;
    if exists (
      select 1 from unnest(v_codes) c
       where not exists (select 1 from merit_badge_requirements q where q.mb_id = p_mb_id and q.parent_id is null and q.code = c)
    ) then
      raise exception 'Station % lists a requirement that isn’t one of this badge’s.', v_pos;
    end if;
    if v_all && v_codes then raise exception 'A requirement can be in only one station.'; end if;
    v_all := v_all || v_codes;
    if nullif(s->>'topic_id', '') is not null then
      if not exists (
        select 1 from meeting_stations st join meeting_topics t on t.id = st.topic_id
         where st.topic_id = (s->>'topic_id')::bigint and t.calendar_entry_id = p_entry and t.mb_id = p_mb_id
      ) then
        raise exception 'The stations changed. Reload the page and try again.';
      end if;
      v_kept := v_kept || (s->>'topic_id')::bigint;
    end if;
  end loop;

  v_old := (select count(*) from meeting_stations where calendar_entry_id = p_entry);
  -- A station left out goes, with its teacher sign-ups and helper placements.
  delete from meeting_topics t using meeting_stations st
   where st.topic_id = t.id and t.calendar_entry_id = p_entry and not (t.id = any (v_kept));
  -- Free the kept stations' keys first, so two stations can trade lead requirements.
  update meeting_topics set req_code = '~' || id, topic_key = mb_id || '-~' || id where id = any (v_kept);
  delete from meeting_stations where calendar_entry_id = p_entry;

  v_pos := 0;
  for s in select * from jsonb_array_elements(p_stations) loop
    v_pos := v_pos + 1;
    v_title := btrim(s->>'title');
    v_loc := nullif(btrim(coalesce(s->>'location', '')), '');
    v_codes := array(
      select c from (select distinct btrim(x) c from jsonb_array_elements_text(s->'codes') x where btrim(x) <> '') u
        join merit_badge_requirements q on q.mb_id = p_mb_id and q.parent_id is null and q.code = u.c
       order by q.sort_order, q.code
    );
    v_lead := v_codes[1];
    v_topic := nullif(s->>'topic_id', '')::bigint;
    if v_topic is null then
      insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id, req_code)
      values (p_entry, p_mb_id || '-' || v_lead, 'mb_req', p_mb_id, v_lead)
      returning id into v_topic;
    else
      update meeting_topics set req_code = v_lead, topic_key = p_mb_id || '-' || v_lead where id = v_topic;
    end if;
    insert into meeting_stations (topic_id, calendar_entry_id, position, title, location, req_codes, updated_at)
    values (v_topic, p_entry, v_pos, v_title, v_loc, v_codes, now());
  end loop;

  -- A different number of stations is a different set of groups: they start over from the draft.
  if v_old <> v_n then
    delete from meeting_rotation_placements where calendar_entry_id = p_entry and group_index is not null;
  end if;
  update meeting_boards set updated_at = now() where calendar_entry_id = p_entry;
end;
$$;

-- ── 4. meeting_save_rotations ─────────────────────────────────────────────────────────────────────────────────────
-- p_placements: [{ "person_id", "group": 0-25 } | { "person_id", "helper_topic_id" } | { "person_id", "other": true }].
create or replace function public.meeting_save_rotations(p_entry bigint, p_actor bigint, p_placements jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p jsonb;
  v_person bigint;
  v_group int;
  v_helper bigint;
  v_other boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_stations:%s', p_entry), 0));
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting isn’t on the calendar.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if public.meeting_board_mode(p_entry) <> 'merit_badge' then
    raise exception 'This meeting isn’t a merit badge night.';
  end if;
  if not exists (select 1 from meeting_stations where calendar_entry_id = p_entry) then
    raise exception 'Set the stations first.';
  end if;
  if p_placements is null or jsonb_typeof(p_placements) <> 'array' then
    raise exception 'Malformed arrangement.';
  end if;

  delete from meeting_rotation_placements where calendar_entry_id = p_entry;
  for p in select * from jsonb_array_elements(p_placements) loop
    v_person := nullif(p->>'person_id', '')::bigint;
    v_group := nullif(p->>'group', '')::int;
    v_helper := nullif(p->>'helper_topic_id', '')::bigint;
    v_other := coalesce((p->>'other')::boolean, false);
    if v_person is null or not exists (select 1 from scouts where person_id = v_person and active) then
      raise exception 'Only scouts go in rotations.';
    end if;
    if num_nonnulls(v_group, v_helper, nullif(v_other, false)) <> 1 then
      raise exception 'Each scout goes in one place.';
    end if;
    if v_group is not null and v_group not between 0 and 25 then
      raise exception 'That group doesn’t exist.';
    end if;
    if v_helper is not null and not exists (
      select 1 from meeting_stations st join meeting_topics t on t.id = st.topic_id where st.topic_id = v_helper and t.calendar_entry_id = p_entry
    ) then
      raise exception 'The stations changed. Reload the page and try again.';
    end if;
    begin
      insert into meeting_rotation_placements (calendar_entry_id, person_id, group_index, helper_topic_id, other_work, entered_by_person_id, updated_at)
      values (p_entry, v_person, v_group, v_helper, v_other, p_actor, now());
    exception when unique_violation then
      raise exception 'Each scout goes in one place.';
    end;
    -- A scout the leader placed who never answered is here: Coming, as entered by the leader.
    insert into meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id)
    values (p_entry, v_person, 'coming', p_actor)
    on conflict (calendar_entry_id, person_id) do nothing;
  end loop;
  update meeting_boards set updated_at = now() where calendar_entry_id = p_entry;
end;
$$;

-- ── 6. Teaching a station ─────────────────────────────────────────────────────────────────────────────────────────
-- The guard, unchanged but for 'add_station': a station on a merit badge night, adults only.
create or replace function public._meeting_teach_guard(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_op text
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
  if v_kind is null and p_op in ('add', 'add_station') then
    raise exception 'Teaching is for adults and Junior Leaders.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There’s no teaching sign-up for this meeting.';
  end if;
  if p_op = 'add_station' then
    if public.meeting_board_mode(p_entry) <> 'merit_badge' then
      raise exception 'There’s no teaching sign-up for this meeting.';
    end if;
    if v_kind = 'junior' then
      raise exception 'On a merit badge night, a leader places Junior Leaders.';
    end if;
  end if;
  return v_kind;
end;
$$;

-- "I'll teach this" (unchanged from 20261116100000) plus: on a merit badge night the key must be one of that board's
-- stations, and goes through the guard's 'add_station'.
create or replace function public.meeting_teach_topic(
  p_entries bigint[], p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_title text, p_note text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_entries bigint[] := array(select distinct e from unnest(coalesce(p_entries, '{}'::bigint[])) e where e is not null order by 1);
  v_entry bigint;
  v_kind text;
  v_topic bigint;
  v_topics bigint[] := '{}';
  v_full text[] := '{}';
  v_skill text;
  v_station boolean;
begin
  if cardinality(v_entries) = 0 then raise exception 'Pick at least one date.'; end if;
  foreach v_entry in array v_entries loop
    v_station := p_topic_key is not null and exists (
      select 1 from meeting_stations st join meeting_topics t on t.id = st.topic_id
       where t.calendar_entry_id = v_entry and t.topic_key = p_topic_key
    );
    v_kind := public._meeting_teach_guard(v_entry, p_person, p_actor, p_leader, case when v_station then 'add_station' else 'add' end);
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
    if not exists (select 1 from meeting_topic_teachers where topic_id = v_topic and person_id = p_person)
       and public._meeting_teach_count(v_entry, p_person) >= 2 then
      v_full := v_full || to_char((select entry_date from calendar_entries where id = v_entry), 'FMMon FMDD');
    end if;
  end loop;
  if cardinality(v_full) > 0 then
    if cardinality(v_entries) = 1 then
      raise exception 'You’re teaching 2. Remove one to add another.';
    end if;
    raise exception 'You’re teaching 2 on %. Remove one there, or pick other dates.', array_to_string(v_full, ', ');
  end if;
  for i in 1 .. cardinality(v_entries) loop
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id)
    values (v_topics[i], v_entries[i], p_person, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    on conflict (topic_id, person_id) do nothing;
  end loop;
end;
$$;

-- ── 7. meeting_board_stamp: + stations and placements ─────────────────────────────────────────────────────────────
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
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_stations where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_rotation_placements where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

revoke all on function public.meeting_set_board(bigint, text, text, integer) from public, anon, authenticated;
revoke all on function public.meeting_set_stations(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.meeting_save_rotations(bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function public._meeting_teach_guard(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_teach_topic(bigint[], bigint, bigint, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_set_board(bigint, text, text, integer) to service_role;
grant execute on function public.meeting_set_stations(bigint, text, jsonb) to service_role;
grant execute on function public.meeting_save_rotations(bigint, bigint, jsonb) to service_role;
grant execute on function public._meeting_teach_guard(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_teach_topic(bigint[], bigint, bigint, boolean, text, text, text) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 8. merge_people: + meeting_rotation_placements ────────────────────────────────────────────────────────────────
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
  insert into public.meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id, created_at, updated_at)
  select t.topic_id, t.calendar_entry_id, p_survivor, t.note, t.entered_by_person_id, t.created_at, t.updated_at
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

  update merge_suggestions m set person_id = p_survivor
  where m.person_id = p_loser
    and not exists (
      select 1 from merge_suggestions m2
      where m2.import_row_id = m.import_row_id and m2.person_id = p_survivor
    );
  delete from merge_suggestions where person_id = p_loser and status = 'pending';

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
