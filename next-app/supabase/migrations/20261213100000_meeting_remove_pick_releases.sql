-- meeting_remove_pick releases a for_picks Assign itself (2026-10-22, planner speed; Plans/Meeting-Planner-II.md D-424).
--
-- D-424: a teacher signed up by the planner's Assign (meeting_topic_teachers.for_picks = true) comes off the topic once
-- no scout picks it any more, carried picks included; a self sign-up stays. Until now the app did that after the RPC
-- (lib/meeting-board releaseAssignmentsNobodyPicks): a select, then a whole-board reload, then a delete — up to seven
-- round trips per untick, and a read-then-delete race with another editor's pick.
--
-- Now, inside the same transaction as the delete:
--   1. no for_picks teacher on this key → nothing to do;
--   2. an active scout's OWN pick on this board still holds the key → the Assign stays;
--   3. otherwise, scouts with no list on this board whose last earlier list holds the key may still carry it. Whether a
--      carried pick is finished is the ledger's call (rank-requirement trees, lib/meeting-board-picklist isPickFinished),
--      which lives in the app, so those scouts are RETURNED and the app checks only them;
--   4. no such scout → the for_picks rows are deleted here.
-- Returns the person ids of step 3 (empty when the RPC settled it). Rule unchanged.
--
-- Re-created from the current definition (pg_get_functiondef, 20261115100000) with the release added. The return type
-- changes (void → bigint[]), so it is dropped and created, and its grants restated: security invoker, search_path
-- pinned, EXECUTE for service_role only.

drop function if exists public.meeting_remove_pick(bigint, bigint, bigint, boolean, text, jsonb);

create function public.meeting_remove_pick(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_carry jsonb)
 returns bigint[]
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_date date;
  v_carriers bigint[];
begin
  perform public._meeting_pick_guard(p_entry, p_person, p_actor, p_leader, p_carry, 'edit');
  delete from meeting_topic_picks p using meeting_topics t
   where t.id = p.topic_id and t.calendar_entry_id = p_entry and t.topic_key = p_topic_key and p.person_id = p_person;
  update meeting_topic_picks p set priority = o.n, updated_at = now()
    from (
      select topic_id, row_number() over (order by priority, topic_id) as n
        from meeting_topic_picks where calendar_entry_id = p_entry and person_id = p_person and priority is not null
    ) o
   where p.topic_id = o.topic_id and p.person_id = p_person and p.priority is distinct from o.n;

  -- 1. An Assign made for the picks on this key?
  if not exists (
    select 1 from meeting_topic_teachers tt join meeting_topics t on t.id = tt.topic_id
     where tt.calendar_entry_id = p_entry and tt.for_picks and t.topic_key = p_topic_key
  ) then
    return '{}'::bigint[];
  end if;

  -- 2. An active scout's own list on this board still picks it.
  if exists (
    select 1 from meeting_topic_picks p
      join meeting_topics t on t.id = p.topic_id
      join meeting_pick_lists l on l.calendar_entry_id = p.calendar_entry_id and l.person_id = p.person_id
      join scouts s on s.person_id = p.person_id and s.active
     where p.calendar_entry_id = p_entry and t.topic_key = p_topic_key
  ) then
    return '{}'::bigint[];
  end if;

  -- 3. Active scouts with no list here whose last earlier list (by date, then entry id) picked it.
  select entry_date into v_date from calendar_entries where id = p_entry;
  select coalesce(array_agg(distinct last.person_id), '{}') into v_carriers
    from (
      select distinct on (l.person_id) l.person_id, l.calendar_entry_id
        from meeting_pick_lists l
        join calendar_entries e on e.id = l.calendar_entry_id
        join scouts s on s.person_id = l.person_id and s.active
       where l.calendar_entry_id <> p_entry and e.entry_date <= v_date
         and not exists (select 1 from meeting_pick_lists h where h.calendar_entry_id = p_entry and h.person_id = l.person_id)
       order by l.person_id, e.entry_date desc, l.calendar_entry_id desc
    ) last
    join meeting_topic_picks p on p.calendar_entry_id = last.calendar_entry_id and p.person_id = last.person_id
    join meeting_topics t on t.id = p.topic_id and t.topic_key = p_topic_key;
  if cardinality(v_carriers) > 0 then
    return v_carriers;
  end if;

  -- 4. Nobody picks it any more.
  delete from meeting_topic_teachers tt using meeting_topics t
   where t.id = tt.topic_id and tt.calendar_entry_id = p_entry and tt.for_picks and t.topic_key = p_topic_key;
  return '{}'::bigint[];
end;
$function$;

revoke all on function public.meeting_remove_pick(bigint, bigint, bigint, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.meeting_remove_pick(bigint, bigint, bigint, boolean, text, jsonb) to service_role;
