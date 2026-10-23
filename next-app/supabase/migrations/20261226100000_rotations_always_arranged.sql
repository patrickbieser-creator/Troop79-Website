-- Rotations L3 (Plans/Build-A-Plan.md, "Rotations", Decision 1 and "L3 design"; D-437 amends D-426, D-429 and
-- Decision 8): there is one arrangement from planning time on. The one-way Start retires.
--
-- 1. _meeting_live_begin(entry): an empty arrangement (rotations 1 and 2, live_started_at now). The caller holds the
--    Live lock.
-- 2. meeting_reconcile: a meeting without an arrangement BEGINS one as soon as anything is on its plan, when it is an
--    upcoming, published meeting that takes sign-ups. Every pick, answer, seed and teacher write reaches this (L1/L2's
--    deferred triggers), so Build a Plan's first offering makes the arrangement and its class. The matcher no longer
--    decides anything by itself; it is "Suggest an arrangement" (4).
-- 3. meeting_live_reset(entry, actor): "Reset to match picks". Discard (what it drops and keeps is unchanged: B8), then
--    begin again from the plan when it has anything: every offering gets a Not scheduled class and scouts land by their
--    picks. Returns true when there was an arrangement to reset.
-- 4. meeting_live_suggest(entry, actor, snapshot): "Suggest an arrangement". Discard, then meeting_live_start with the
--    matcher's snapshot (the server builds it, as Start did), then reconcile: offerings the matcher left out get their
--    classes and late picks land.
-- 5. Data: upcoming meetings with something on their plan and no arrangement begin one now.
--
-- Lock order is L1/L2's: these take the Live lock first. The deferred triggers may now take the Live lock at commit on a
-- meeting that had no arrangement when the write began (its writer took no Live lock); a Live edit on that same meeting
-- in that same instant could deadlock (Postgres fails one). That window is a meeting's very first write; accepted.
-- DEPLOY ORDER: DB-first. Production's L2 code reads a begun arrangement like any started one (its Live screen shows
-- the cards and no Start button once started) and its Discard still works (a plan's next write begins it again).
-- Posture (D-051 / D-239): functions invoker, search_path pinned, EXECUTE only to service_role.

-- ── 1. _meeting_live_begin ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._meeting_live_begin(p_entry bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into meeting_boards (calendar_entry_id) values (p_entry) on conflict (calendar_entry_id) do nothing;
  insert into meeting_rotations (calendar_entry_id, number) values (p_entry, 1), (p_entry, 2) on conflict do nothing;
  update meeting_boards set live_started_at = now(), live_version = live_version + 1, updated_at = now()
   where calendar_entry_id = p_entry and live_started_at is null;
end;
$$;

-- Whether a meeting without an arrangement should have one: upcoming, published, taking sign-ups, something planned.
create or replace function public._meeting_should_arrange(p_entry bigint) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from calendar_entries e
     where e.id = p_entry
       and e.status = 'published'
       and e.entry_date >= (now() at time zone 'America/Chicago')::date
  )
  and public.meeting_board_mode(p_entry) <> 'closed'
  and exists (select 1 from meeting_topics t where t.calendar_entry_id = p_entry and public._meeting_topic_on_plan(p_entry, t.id));
$$;

-- ── 2. meeting_reconcile: begins an arrangement ───────────────────────────────────────────────────────────────────
create or replace function public.meeting_reconcile(p_entry bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_changed integer;
begin
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null then
    -- Cheap test before the lock: a meeting with nothing planned (or past, or closed) stays as it is.
    if not public._meeting_should_arrange(p_entry) then
      return 0;
    end if;
    perform public._meeting_live_lock(p_entry);
    if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null then
      perform public._meeting_live_begin(p_entry);
    end if;
  else
    perform public._meeting_live_lock(p_entry);
  end if;
  v_changed := public._meeting_reconcile_core(p_entry);
  if v_changed > 0 then
    update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
  end if;
  return v_changed;
end;
$$;

-- ── 3. meeting_live_reset ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_live_reset(p_entry bigint, p_actor bigint) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_had boolean;
begin
  perform public._meeting_live_lock(p_entry);
  v_had := public.meeting_live_discard(p_entry, p_actor);
  if public._meeting_should_arrange(p_entry) then
    perform public._meeting_live_begin(p_entry);
    perform public._meeting_reconcile_core(p_entry);
    update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
  end if;
  return v_had;
end;
$$;

-- ── 4. meeting_live_suggest ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_live_suggest(p_entry bigint, p_actor bigint, p_snapshot jsonb) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_live_lock(p_entry);
  perform public.meeting_live_discard(p_entry, p_actor);
  perform public.meeting_live_start(p_entry, p_actor, p_snapshot);
  perform public._meeting_reconcile_core(p_entry);
  update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
end;
$$;

revoke all on function public._meeting_live_begin(bigint) from public, anon, authenticated;
revoke all on function public._meeting_should_arrange(bigint) from public, anon, authenticated;
revoke all on function public.meeting_reconcile(bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_reset(bigint, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_suggest(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public._meeting_live_begin(bigint) to service_role;
grant execute on function public._meeting_should_arrange(bigint) to service_role;
grant execute on function public.meeting_reconcile(bigint) to service_role;
grant execute on function public.meeting_live_reset(bigint, bigint) to service_role;
grant execute on function public.meeting_live_suggest(bigint, bigint, jsonb) to service_role;

-- ── 5. data ───────────────────────────────────────────────────────────────────────────────────────────────────────
select public.meeting_reconcile(e.id)
  from public.calendar_entries e
  left join public.meeting_boards b on b.calendar_entry_id = e.id
 where b.live_started_at is null
   and e.entry_date >= (now() at time zone 'America/Chicago')::date
   and exists (select 1 from public.meeting_topics t where t.calendar_entry_id = e.id);
