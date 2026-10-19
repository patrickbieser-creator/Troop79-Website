-- Meeting board, Phase 3b follow-up (qa-lead review of 20261118100000, Plans/Meeting-Requests-And-Teaching-Offers.md):
--
-- 1. Lock order: meeting_set_stations now takes the night's advisory lock BEFORE it touches the board row (it called
--    meeting_set_board first), and meeting_save_rotations takes the board row right after the same advisory lock. Both
--    now lock advisory-then-board, like the rest of the board's RPCs.
-- 2. meeting_save_rotations refuses to place a scout whose answer is Can't make it, naming them. Their answer wins over
--    a leader's screen that was open before they changed it; a scout with no answer is still recorded Coming.
--
-- Function bodies only (create or replace). DEPLOY ORDER: with 20261118100000, DB-first, then the code.
-- Posture unchanged: invoker, search_path pinned, EXECUTE revoked from public/anon/authenticated, granted to service_role.

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
  -- Lock order, as everywhere on a night's stations: the advisory lock first, then the board row (meeting_set_board's
  -- upsert), so this and meeting_save_rotations can't wait on each other in opposite orders.
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_stations:%s', p_entry), 0));
  -- The board itself: entry, day, troop meeting, a badge with requirements. Drops the stations if the badge changed.
  perform public.meeting_set_board(p_entry, 'merit_badge', p_mb_id, null);

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
  -- Then the board row, the same order as meeting_set_stations.
  perform 1 from meeting_boards where calendar_entry_id = p_entry for update;
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
    -- A scout who said they can't make it keeps that answer: the leader's screen was out of date.
    if exists (select 1 from meeting_intents where calendar_entry_id = p_entry and person_id = v_person and intent = 'not_coming') then
      raise exception '% said they can’t make it. Reload the page to see the latest.', (select display_name from people where id = v_person);
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

revoke all on function public.meeting_set_stations(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.meeting_save_rotations(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_set_stations(bigint, text, jsonb) to service_role;
grant execute on function public.meeting_save_rotations(bigint, bigint, jsonb) to service_role;
