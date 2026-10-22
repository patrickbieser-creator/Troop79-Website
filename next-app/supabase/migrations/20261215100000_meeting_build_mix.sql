-- Build a Plan B2 (Plans/Build-A-Plan.md): a planner's new mix, and editing a mix on a meeting.
--
-- 1. meeting_new_mix: save a new focus set AND seed it on the meeting as one class, in ONE transaction, so a failure
--    never leaves an unseeded orphan set behind (a new mix is always a focus set: one concept). Returns the set's id.
-- 2. meeting_edit_mix: change a focus group's requirements (and name) on a meeting. It edits the focus set itself
--    (labels kept) and re-snapshots THIS meeting's class to match; other meetings the set is already on keep the copy
--    they were seeded with (meeting_topic_members is a snapshot, 20261204100000). The class's seeded_at moves to now
--    (the stamp only sees seeded_at), unless it was unseeded. Returns how many requirements the class now holds.
-- Both take the meeting's seed lock (_meeting_seed_guard): the meeting must still be ahead and taking sign-ups. Who may
-- call them (meeting_planner.seed) is checked by the server action first; p_actor records who did it.
--
-- DEPLOY ORDER: DB-first (new functions only), then the code.
-- Posture (D-051 / D-239): security invoker, search_path pinned, EXECUTE for service_role only.

create or replace function public.meeting_new_mix(p_entry bigint, p_name text, p_items text[], p_actor bigint)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_set bigint;
begin
  if cardinality(coalesce(p_items, '{}'::text[])) = 0 then
    raise exception 'Tick at least one requirement.';
  end if;
  perform public._meeting_seed_guard(p_entry);
  v_set := public.focus_set_save(p_actor, null, p_name, '{}'::text[], p_items);
  perform public.meeting_seed_focus_set(p_entry, v_set, p_actor);
  return v_set;
end;
$$;

create or replace function public.meeting_edit_mix(p_entry bigint, p_set bigint, p_name text, p_items text[], p_actor bigint)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
  v_labels text[];
begin
  if cardinality(coalesce(p_items, '{}'::text[])) = 0 then
    raise exception 'Tick at least one requirement.';
  end if;
  perform public._meeting_seed_guard(p_entry);
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = 'fg:' || p_set;
  if v_topic is null then raise exception 'That set isn’t on this meeting.'; end if;
  select coalesce(array_agg(label order by label), '{}'::text[]) into v_labels from focus_set_labels where set_id = p_set;
  perform public.focus_set_save(p_actor, p_set, p_name, v_labels, p_items);
  -- seeded_at moves too, so meeting_board_stamp changes and other planners' pages pick up the new name and parts.
  update meeting_topics set title = (select name from focus_sets where id = p_set), seeded_at = case when seeded_at is null then null else now() end
   where id = v_topic;
  delete from meeting_topic_members where topic_id = v_topic;
  insert into meeting_topic_members (topic_id, item_key, position)
  select v_topic, i.topic_key, i.position from focus_set_items i where i.set_id = p_set;
  return (select count(*)::int from meeting_topic_members where topic_id = v_topic);
end;
$$;

revoke all on function public.meeting_new_mix(bigint, text, text[], bigint) from public, anon, authenticated;
grant execute on function public.meeting_new_mix(bigint, text, text[], bigint) to service_role;
revoke all on function public.meeting_edit_mix(bigint, bigint, text, text[], bigint) from public, anon, authenticated;
grant execute on function public.meeting_edit_mix(bigint, bigint, text, text[], bigint) to service_role;
