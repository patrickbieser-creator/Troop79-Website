-- Build a Plan B5b (Plans/Build-A-Plan.md): editing a mix on a plan changes THIS meeting's copy only.
--
-- meeting_edit_mix gains p_update_set boolean DEFAULT false:
--   false  writes only this meeting's class (its meeting_topics title and meeting_topic_members). The focus set and its
--          items are untouched. (B2's version, 20261215100000, always rewrote the focus set too.)
--   true   "Also update the focus set": the focus set (labels kept) AND this meeting's copy, in the same transaction.
-- Either way other meetings the set is already on keep the copy they were seeded with (meeting_topic_members is a
-- snapshot, 20261204100000). The class's seeded_at moves to now (meeting_board_stamp only sees seeded_at, so other
-- planners' pollers pick the edit up), unless it was unseeded.
--
-- One function with a flag, not two: the dirty-draft confirm saves the copy and the set in ONE call, under ONE seed
-- lock, all-or-nothing (no double save, no half-applied pair), and the meeting-copy write stays in one place.
-- The meeting-only path validates exactly as focus_set_save does (name, requirement keys, 300 cap) and dedupes keys
-- keeping first position, so both paths store the same copy for the same input.
--
-- DEPLOY ORDER: DB-first. The old five-argument function is dropped and re-created with the defaulted sixth argument,
-- so there is ONE meeting_edit_mix (no PostgREST overload ambiguity) and the old code's named five-argument call still
-- resolves to it. Between DB and code deploys an old-code Save changes the meeting copy only (the safer direction).
-- Posture (D-051 / D-239): security invoker, search_path pinned, EXECUTE for service_role only.

drop function if exists public.meeting_edit_mix(bigint, bigint, text, text[], bigint);

create function public.meeting_edit_mix(p_entry bigint, p_set bigint, p_name text, p_items text[], p_actor bigint, p_update_set boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
  v_labels text[];
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  v_bad text;
begin
  if cardinality(coalesce(p_items, '{}'::text[])) = 0 then
    raise exception 'Tick at least one requirement.';
  end if;
  perform public._meeting_seed_guard(p_entry);
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = 'fg:' || p_set;
  if v_topic is null then raise exception 'That set isn’t on this meeting.'; end if;
  if coalesce(p_update_set, false) then
    select coalesce(array_agg(label order by label), '{}'::text[]) into v_labels from focus_set_labels where set_id = p_set;
    perform public.focus_set_save(p_actor, p_set, p_name, v_labels, p_items);
  else
    if v_name = '' then raise exception 'Give the set a name.'; end if;
    if cardinality(p_items) > 300 then raise exception 'Keep a set to 300 requirements.'; end if;
    select k into v_bad from unnest(p_items) k where not public._focus_item_valid(k) limit 1;
    if v_bad is not null then raise exception 'That isn’t a requirement: %', v_bad; end if;
  end if;
  update meeting_topics set title = v_name, seeded_at = case when seeded_at is null then null else now() end
   where id = v_topic;
  delete from meeting_topic_members where topic_id = v_topic;
  insert into meeting_topic_members (topic_id, item_key, position)
  select v_topic, k, min(o)::smallint - 1 from unnest(p_items) with ordinality u(k, o) group by k
  on conflict do nothing;
  return (select count(*)::int from meeting_topic_members where topic_id = v_topic);
end;
$$;

revoke all on function public.meeting_edit_mix(bigint, bigint, text, text[], bigint, boolean) from public, anon, authenticated;
grant execute on function public.meeting_edit_mix(bigint, bigint, text, text[], bigint, boolean) to service_role;
