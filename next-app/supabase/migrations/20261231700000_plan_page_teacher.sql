-- Meeting Planner III, F5 (Plans/Meeting-Planner-III-Family.md): teacher cards on the family link, /i/plan/<token>.
--
-- 1. meeting_plan_pages.as_teacher: the link also lets its recipient answer for THEMSELF as a teacher on that meeting
--    (TeacherCard). Minted true only for someone loadTeacherPeople admits on the meeting date (an adult, or the Junior
--    Leader's own address). A link may now carry no scouts at all, but only when it is a teacher link.
-- 2. _meeting_plan_page_open: the shared head of every claim (lock the page, refuse anything not open, re-check the
--    recipient's active + session_epoch, the 200-write limit, count the write). The count is rolled back with the
--    rest of the transaction when the caller's scope check then refuses.
-- 3. meeting_plan_page_claim: re-bodied on the helper. Same signature, grants and refusals.
-- 4. meeting_plan_page_claim_teacher: the sibling for a teacher write; refuses 'scope' unless as_teacher.
--
-- DEPLOY ORDER: DB-first (additive column with a default, a looser check, a new function; the code that mints and
-- claims teacher links ships after). Posture (D-051 / D-239): invoker, search_path pinned, EXECUTE to service_role only.

alter table public.meeting_plan_pages add column if not exists as_teacher boolean not null default false;

alter table public.meeting_plan_pages drop constraint if exists meeting_plan_pages_scout_person_ids_check;
alter table public.meeting_plan_pages add constraint meeting_plan_pages_scout_person_ids_check
  check (cardinality(scout_person_ids) <= 12 and (cardinality(scout_person_ids) >= 1 or as_teacher));

-- The head of a claim: the page locked and open, its recipient current, the write counted. Raises the same readable
-- exceptions as before ('unknown', 'closed', 'expired', 'limit').
create or replace function public._meeting_plan_page_open(p_token_hash text)
returns public.meeting_plan_pages
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
  if r.write_count >= 200 then raise exception 'limit'; end if;
  update meeting_plan_pages set write_count = write_count + 1 where id = r.id;
  return r;
end;
$$;

-- One write on a family link for one scout. The output columns share names with table columns; the body reads only
-- the row variable r (never a bare column), so nothing is ambiguous.
create or replace function public.meeting_plan_page_claim(p_token_hash text, p_scout bigint)
returns table (page_id bigint, calendar_entry_id bigint, recipient_person_id bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r meeting_plan_pages%rowtype;
begin
  r := public._meeting_plan_page_open(p_token_hash);
  -- Scope: one of the link's scouts AND still someone the recipient may answer for (the household rule, today).
  if not (p_scout = any (r.scout_person_ids)) or not public._meeting_may_act_for(r.recipient_person_id, p_scout, false) then
    raise exception 'scope';
  end if;
  return query select r.id, r.calendar_entry_id, r.recipient_person_id;
end;
$$;

-- One teacher write on a family link: the recipient answering for themself. Only a link minted as_teacher.
create or replace function public.meeting_plan_page_claim_teacher(p_token_hash text)
returns table (page_id bigint, calendar_entry_id bigint, recipient_person_id bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r meeting_plan_pages%rowtype;
begin
  r := public._meeting_plan_page_open(p_token_hash);
  if not r.as_teacher then raise exception 'scope'; end if;
  return query select r.id, r.calendar_entry_id, r.recipient_person_id;
end;
$$;

revoke all on function public._meeting_plan_page_open(text) from public, anon, authenticated;
grant execute on function public._meeting_plan_page_open(text) to service_role;
revoke all on function public.meeting_plan_page_claim(text, bigint) from public, anon, authenticated;
grant execute on function public.meeting_plan_page_claim(text, bigint) to service_role;
revoke all on function public.meeting_plan_page_claim_teacher(text) from public, anon, authenticated;
grant execute on function public.meeting_plan_page_claim_teacher(text) to service_role;
