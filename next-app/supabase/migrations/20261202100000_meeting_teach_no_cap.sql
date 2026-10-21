-- No teaching cap for adults (Plans/Meeting-Planner-II.md, Decision 7; Patrick 2026-10-21: "Adults have enough wisdom
-- to not over-assign themselves").
--
-- Re-creates the two RPCs that refused a third commitment, copied from production's pg_get_functiondef (identical to
-- 20261118100000 / 20261116100000) with ONLY the `_meeting_teach_count(...) >= 2` check and its v_full / exception
-- block removed. Every other guard stays: who may act (_meeting_teach_guard), Junior Leaders and adults-only skills,
-- closed and past boards. CREATE OR REPLACE keeps the existing grants. _meeting_teach_count stays defined, unused.
--
-- Loosens a check only: deploy before the code (D-404).

create or replace function public.meeting_teach_topic(p_entries bigint[], p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_title text, p_note text)
 returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_entries bigint[] := array(select distinct e from unnest(coalesce(p_entries, '{}'::bigint[])) e where e is not null order by 1);
  v_entry bigint;
  v_kind text;
  v_topic bigint;
  v_topics bigint[] := '{}';
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
  end loop;
  for i in 1 .. cardinality(v_entries) loop
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id)
    values (v_topics[i], v_entries[i], p_person, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    on conflict (topic_id, person_id) do nothing;
  end loop;
end;
$function$;

create or replace function public.meeting_offer_skill(p_entries bigint[], p_person bigint, p_actor bigint, p_leader boolean, p_skill_id text, p_note text)
 returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_entries bigint[] := array(select distinct e from unnest(coalesce(p_entries, '{}'::bigint[])) e where e is not null order by 1);
  v_entry bigint;
  v_kind text;
begin
  if cardinality(v_entries) = 0 then raise exception 'Pick at least one date.'; end if;
  if not exists (select 1 from skills where id = p_skill_id) then raise exception 'Unknown skill %', p_skill_id; end if;
  foreach v_entry in array v_entries loop
    v_kind := public._meeting_teach_guard(v_entry, p_person, p_actor, p_leader, 'add');
    if v_kind = 'junior' and not (select youth_teachable from skills where id = p_skill_id) then
      raise exception 'Junior Leaders can’t teach that: it’s adults only.';
    end if;
  end loop;
  foreach v_entry in array v_entries loop
    insert into meeting_teaching_offers (calendar_entry_id, person_id, skill_id, note, entered_by_person_id)
    values (v_entry, p_person, p_skill_id, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    on conflict (calendar_entry_id, person_id, skill_id)
    do update set note = excluded.note, entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
  end loop;
end;
$function$;
