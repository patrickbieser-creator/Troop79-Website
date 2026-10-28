-- Meeting Planner III, P7: hardening after qa-lead's review (Plans/Completed/Meeting-Planner-III.md, "Shipping record").
--
-- 1. meeting_add_pick_capped: a family's tick, with the "two or three things" cap (PLAN_PICK_CAP) counted under the
--    same per-scout advisory lock the pick writer takes, so two ticks at once can't both pass a count of 2. The lock is
--    reentrant inside the transaction, so meeting_add_pick takes it again without waiting.
-- 2. meeting_plan_page_claim: the family link's scope is re-checked on every write against the household rule
--    (_meeting_may_act_for), not only against the scouts fixed when the link was minted: a scout who left the
--    household drops out at once.
--
-- DEPLOY ORDER: DB-first (a new function and a stricter body for an existing one; the code that calls the new function
-- ships after). Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE to service_role only.

create or replace function public.meeting_add_pick_capped(
  p_entry bigint, p_person bigint, p_actor bigint, p_topic_key text, p_cap integer
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  select count(*) into v_n
    from meeting_topic_picks k
    join meeting_topics t on t.id = k.topic_id
   where k.calendar_entry_id = p_entry and k.person_id = p_person and not k.later and t.topic_key <> p_topic_key;
  if v_n >= p_cap then
    raise exception 'Pick up to % things. Untick one first.', p_cap;
  end if;
  perform public.meeting_add_pick(p_entry, p_person, p_actor, false, p_topic_key, false, true, '[]'::jsonb);
end;
$$;

-- One write on a family link: the page as it stands, or an exception a person can read. Counts the write. The
-- output columns share names with table columns; the body reads only the row variable r (never a bare column), so
-- nothing is ambiguous.
create or replace function public.meeting_plan_page_claim(p_token_hash text, p_scout bigint)
returns table (page_id bigint, calendar_entry_id bigint, recipient_person_id bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r meeting_plan_pages%rowtype;
  v_epoch integer;
  v_active boolean;
begin
  select * into r from meeting_plan_pages where token_hash = p_token_hash for update;
  if not found then raise exception 'unknown'; end if;
  if r.revoked_at is not null or r.superseded_at is not null then raise exception 'closed'; end if;
  if r.expires_at <= now() then raise exception 'expired'; end if;
  select session_epoch, active into v_epoch, v_active from people where id = r.recipient_person_id;
  if not coalesce(v_active, false) or v_epoch is distinct from r.recipient_epoch then raise exception 'closed'; end if;
  -- Scope: one of the link's scouts AND still someone the recipient may answer for (the household rule, today).
  if not (p_scout = any (r.scout_person_ids)) or not public._meeting_may_act_for(r.recipient_person_id, p_scout, false) then
    raise exception 'scope';
  end if;
  if r.write_count >= 200 then raise exception 'limit'; end if;
  update meeting_plan_pages set write_count = write_count + 1 where id = r.id;
  return query select r.id, r.calendar_entry_id, r.recipient_person_id;
end;
$$;

revoke all on function public.meeting_add_pick_capped(bigint, bigint, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.meeting_add_pick_capped(bigint, bigint, bigint, text, integer) to service_role;
revoke all on function public.meeting_plan_page_claim(text, bigint) from public, anon, authenticated;
grant execute on function public.meeting_plan_page_claim(text, bigint) to service_role;
