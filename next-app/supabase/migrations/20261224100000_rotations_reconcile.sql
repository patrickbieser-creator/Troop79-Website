-- Rotations L1 (Plans/Build-A-Plan.md, "Rotations: one arrangement over the live plan", Decisions 2 and 3): once a
-- meeting has an arrangement (meeting_boards.live_started_at), the arrangement follows the plan on its own, and a
-- planner's hand is never overruled.
--
-- 1. meeting_class_members.pinned: placed by hand (a planner moved or added them). A pinned scout is never moved or
--    removed automatically; if they say Can't make it or drop the pick they are FLAGGED (the Live screen's Needs
--    attention strip, L0) with a Remove. Unpinned members were placed by the matcher's snapshot or by reconcile.
--    Every member that exists before this migration (entry 133's arrangement, Oct 25) is pinned: nobody is moved by
--    the deploy itself.
--    meeting_class_members.is_new: placed automatically after the arrangement existed, until a planner dismisses it
--    (the chip says New).
-- 2. meeting_live_holds: "a planner took this scout out of this topic's class by hand": reconcile never puts them back
--    in a class of that topic. Placing them back in one by hand clears it; Discard clears all of a meeting's.
-- 3. _meeting_reconcile_core(entry): under the Live lock (the caller holds it), on an upcoming or today's meeting with an
--    arrangement. Scouts only (an active scouts row); adults and visitors are never touched.
--      a. Unpinned scouts leave: said Can't make it; or, in a class that isn't a merged sibling class (title null), with
--         their own saved list on this board (meeting_pick_lists: carried picks are the loader's, not the database's)
--         and no current pick of the class's topic, unless they are "Not sure yet" with no picks at all (the matcher
--         places those by the engine's rule).
--      b. Late picks land: a Coming scout (said Coming, or picked with no answer) with a current pick whose topic has a
--         class, in no class of that topic, not held out of it, teaching no class here, and in fewer than 2 classes
--         (MAX_TOPICS_PER_SCOUT). The class: a repeat in a rotation they're free in (or Not scheduled) with fewer than 8
--         (SESSION_CAP), fewest members first, then rotation and position. None fits = they wait in "Not in a class
--         yet". Picks in the scout's own order (ranked first, then first asked). Lands unpinned and New.
--    Returns how many rows changed.
-- 4. meeting_reconcile(entry): the lock, then the core; bumps live_version when anything changed.
-- 5. Called from every write that can change it:
--      - every Live edit, through _meeting_live_bump (now plpgsql: reconcile, then bump), so a class made by hand fills
--        with its pickers and a removed class's unpinned scouts go to another repeat;
--      - every pick and answer, through deferred constraint triggers on meeting_topic_picks and meeting_intents (at
--        commit, so merge_people and a carried-picks copy are reconciled once they are whole);
--      - the server's Start (the TS calls meeting_reconcile after meeting_live_start).
--    Lock order: a pick or answer write takes its per-scout board lock, then the Live lock (section 8b), then writes;
--    a Live edit takes the Live lock and never a board lock. So the two never wait on each other in opposite order.
-- 6. meeting_live_move_scout (redefined): a move by hand pins the scout in the class they land in and clears New;
--    taking them out of a class (to the pool or another topic) holds them out of that topic; placing them in a topic
--    clears its hold.
-- 7. meeting_live_dismiss_new(entry, actor, class, person): "New" goes; class and person null = every New chip on the
--    meeting. Under the Live lock; bumps live_version.
-- 8. meeting_live_discard (redefined): + the meeting's holds go too.
-- 9. merge_people: the class-member move keeps pinned / is_new (the survivor's row wins a class both were in), and the
--    loser's holds become the survivor's.
--
-- DEPLOY ORDER: DB-first. The new columns default to what the code in production expects (it never reads them); the
-- triggers and the bump only act on a meeting with an arrangement, which production's Live screen already treats as
-- the truth, and they never write a pick or an answer. Production's Make a class places pickers by hand after its add:
-- with reconcile those moves find the pickers already placed and the RPC says STALE, which that code already skips.
-- Posture (D-051 / D-239): RLS on, no policies; functions invoker, search_path pinned, EXECUTE only to service_role
-- (merge_people keeps its definer posture).

-- ── 1. meeting_class_members: pinned, is_new ──────────────────────────────────────────────────────────────────────
alter table public.meeting_class_members
  add column if not exists pinned boolean not null default true,
  add column if not exists is_new boolean not null default false;
-- Existing rows took true above (nobody moves at deploy); from now on a member is unpinned unless a hand placed them.
alter table public.meeting_class_members alter column pinned set default false;

-- ── 2. meeting_live_holds ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_live_holds (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  topic_id bigint not null references public.meeting_topics(id) on delete cascade,
  entered_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id, topic_id)
);
create index if not exists meeting_live_holds_person_idx on public.meeting_live_holds (person_id);
create index if not exists meeting_live_holds_topic_idx on public.meeting_live_holds (topic_id);
create index if not exists meeting_live_holds_entered_by_idx on public.meeting_live_holds (entered_by_person_id) where entered_by_person_id is not null;
alter table public.meeting_live_holds enable row level security;
revoke all on public.meeting_live_holds from anon, authenticated;

-- ── 3. _meeting_reconcile_core ────────────────────────────────────────────────────────────────────────────────────
create or replace function public._meeting_reconcile_core(p_entry bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_changed integer := 0;
  v_n integer;
  r record;
  v_target bigint;
begin
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null then
    return 0;
  end if;
  -- A meeting that has passed is the attendance checklist's now: nothing moves under it.
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    return 0;
  end if;

  -- a. Unpinned scouts leave on their own.
  delete from meeting_class_members m
   using meeting_classes c
   where c.id = m.class_id
     and c.calendar_entry_id = p_entry
     and not m.pinned
     and exists (select 1 from scouts s where s.person_id = m.person_id and s.active)
     and (
       exists (select 1 from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = m.person_id and i.intent = 'not_coming')
       or (
         c.title is null
         and exists (select 1 from meeting_pick_lists l where l.calendar_entry_id = p_entry and l.person_id = m.person_id)
         and not exists (
           select 1 from meeting_topic_picks k
            where k.calendar_entry_id = p_entry and k.person_id = m.person_id and k.topic_id = c.topic_id and not k.later
         )
         and (
           exists (select 1 from meeting_topic_picks k where k.calendar_entry_id = p_entry and k.person_id = m.person_id and not k.later)
           or (select i.intent from meeting_intents i where i.calendar_entry_id = p_entry and i.person_id = m.person_id) is distinct from 'undecided'
         )
       )
     );
  get diagnostics v_n = row_count;
  v_changed := v_changed + v_n;

  -- b. Late picks land in their class.
  for r in
    select k.person_id, k.topic_id
      from meeting_topic_picks k
      join scouts s on s.person_id = k.person_id and s.active
      left join meeting_intents i on i.calendar_entry_id = p_entry and i.person_id = k.person_id
     where k.calendar_entry_id = p_entry
       and not k.later
       and coalesce(i.intent, 'coming') = 'coming'
       and exists (select 1 from meeting_classes c where c.calendar_entry_id = p_entry and c.topic_id = k.topic_id)
       and not exists (
         select 1 from meeting_class_members m join meeting_classes c on c.id = m.class_id
          where c.calendar_entry_id = p_entry and c.topic_id = k.topic_id and m.person_id = k.person_id
       )
       and not exists (select 1 from meeting_live_holds h where h.calendar_entry_id = p_entry and h.person_id = k.person_id and h.topic_id = k.topic_id)
       and not exists (select 1 from meeting_classes c where c.calendar_entry_id = p_entry and c.teacher_person_id = k.person_id)
     order by k.person_id, k.priority nulls last, k.first_asked_on, k.topic_id
  loop
    if (select count(*) from meeting_class_members m join meeting_classes c on c.id = m.class_id
         where c.calendar_entry_id = p_entry and m.person_id = r.person_id) >= 2 then
      continue;
    end if;
    select c.id into v_target
      from meeting_classes c
      left join lateral (select count(*) as n from meeting_class_members m where m.class_id = c.id) sz on true
     where c.calendar_entry_id = p_entry
       and c.topic_id = r.topic_id
       and sz.n < 8
       and (
         c.rotation is null
         or not exists (
           select 1 from meeting_class_members m join meeting_classes o on o.id = m.class_id
            where o.calendar_entry_id = p_entry and o.rotation = c.rotation and m.person_id = r.person_id
         )
       )
     order by sz.n, c.rotation nulls last, c.position, c.id
     limit 1;
    if v_target is null then continue; end if;
    insert into meeting_class_members (class_id, person_id, pinned, is_new)
    values (v_target, r.person_id, false, true)
    on conflict (class_id, person_id) do nothing;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
    v_target := null;
  end loop;
  return v_changed;
end;
$$;

-- ── 4. meeting_reconcile ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.meeting_reconcile(p_entry bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_changed integer;
begin
  -- Cheap test before the lock: most writes are on meetings without an arrangement.
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is null then
    return 0;
  end if;
  perform public._meeting_live_lock(p_entry);
  v_changed := public._meeting_reconcile_core(p_entry);
  if v_changed > 0 then
    update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
  end if;
  return v_changed;
end;
$$;

-- ── 5. who calls it ───────────────────────────────────────────────────────────────────────────────────────────────
-- Every Live edit ends here (the caller holds the Live lock).
create or replace function public._meeting_live_bump(p_entry bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_reconcile_core(p_entry);
  update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
end;
$$;

create or replace function public._meeting_reconcile_trigger() returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.meeting_reconcile(case when tg_op = 'DELETE' then old.calendar_entry_id else new.calendar_entry_id end);
  return null;
end;
$$;

drop trigger if exists meeting_topic_picks_reconcile on public.meeting_topic_picks;
create constraint trigger meeting_topic_picks_reconcile
  after insert or update or delete on public.meeting_topic_picks
  deferrable initially deferred
  for each row execute function public._meeting_reconcile_trigger();

drop trigger if exists meeting_intents_reconcile on public.meeting_intents;
create constraint trigger meeting_intents_reconcile
  after insert or update or delete on public.meeting_intents
  deferrable initially deferred
  for each row execute function public._meeting_reconcile_trigger();

-- ── 6. meeting_live_move_scout: a hand pins, and holds out ────────────────────────────────────────────────────────
create or replace function public.meeting_live_move_scout(p_entry bigint, p_actor bigint, p_person bigint, p_from bigint, p_to bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_from_topic bigint;
  v_to_topic bigint;
begin
  perform public._meeting_live_edit(p_entry);
  if p_to is not null then
    select topic_id into v_to_topic from meeting_classes where id = p_to and calendar_entry_id = p_entry;
  end if;
  if p_from is not null then
    select c.topic_id into v_from_topic
      from meeting_class_members m join meeting_classes c on c.id = m.class_id
     where m.class_id = p_from and m.person_id = p_person and c.calendar_entry_id = p_entry;
    delete from meeting_class_members m using meeting_classes c
     where m.class_id = p_from and m.person_id = p_person and c.id = m.class_id and c.calendar_entry_id = p_entry;
    if not found then raise exception 'STALE'; end if;
  elsif p_to is not null and exists (
    select 1 from meeting_class_members m join meeting_classes c on c.id = m.class_id
     where m.person_id = p_person and c.calendar_entry_id = p_entry
  ) then
    -- Placing a scout from "nothing assigned" is compare-and-set too: someone placed them first (qa-lead, P4b).
    raise exception 'STALE';
  end if;
  if p_to is not null then
    if v_to_topic is null then raise exception 'STALE'; end if;
    insert into meeting_class_members (class_id, person_id, entered_by_person_id, pinned, is_new)
    values (p_to, p_person, p_actor, true, false)
    on conflict (class_id, person_id) do update
      set entered_by_person_id = excluded.entered_by_person_id, pinned = true, is_new = false, updated_at = now();
    delete from meeting_live_holds where calendar_entry_id = p_entry and person_id = p_person and topic_id = v_to_topic;
  end if;
  -- Out of a topic by hand: reconcile never puts them back in it.
  if v_from_topic is not null and v_from_topic is distinct from v_to_topic then
    insert into meeting_live_holds (calendar_entry_id, person_id, topic_id, entered_by_person_id)
    values (p_entry, p_person, v_from_topic, p_actor)
    on conflict do nothing;
  end if;
  perform public._meeting_live_bump(p_entry);
end;
$$;

-- ── 7. meeting_live_dismiss_new ───────────────────────────────────────────────────────────────────────────────────
-- One chip (class + person), or every New chip on the meeting (both null). Returns how many it cleared.
create or replace function public.meeting_live_dismiss_new(p_entry bigint, p_actor bigint, p_class bigint, p_person bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  perform public._meeting_live_edit(p_entry);
  update meeting_class_members m
     set is_new = false, updated_at = now()
    from meeting_classes c
   where c.id = m.class_id and c.calendar_entry_id = p_entry and m.is_new
     and (p_class is null or m.class_id = p_class)
     and (p_person is null or m.person_id = p_person);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update meeting_boards set live_version = live_version + 1, updated_at = now() where calendar_entry_id = p_entry;
  end if;
  return v_n;
end;
$$;

-- ── 8. meeting_live_discard: + holds ──────────────────────────────────────────────────────────────────────────────
-- Body from 20261218100000 with only the holds line added.
create or replace function public.meeting_live_discard(p_entry bigint, p_actor bigint) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_had boolean;
begin
  perform public._meeting_live_lock(p_entry);
  v_had := (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is not null
           or exists (select 1 from meeting_classes where calendar_entry_id = p_entry);
  -- Classes first: members cascade with them, and nothing then holds a rotation or a topic.
  delete from meeting_classes where calendar_entry_id = p_entry;
  delete from meeting_rotations where calendar_entry_id = p_entry;
  delete from meeting_live_holds where calendar_entry_id = p_entry;
  -- Draft ticks go; a visitor's row stays, so they are still this meeting's visitor.
  delete from meeting_live_presence lp
   where lp.calendar_entry_id = p_entry
     and not exists (
       select 1 from people p join households h on h.id = p.guest_host_household_id
        where p.id = lp.person_id and h.system_key = 'meeting-visitors'
     );
  update meeting_boards set live_started_at = null where calendar_entry_id = p_entry;
  perform public._meeting_live_bump(p_entry);
  return v_had;
end;
$$;

revoke all on function public._meeting_reconcile_core(bigint) from public, anon, authenticated;
revoke all on function public.meeting_reconcile(bigint) from public, anon, authenticated;
revoke all on function public._meeting_live_bump(bigint) from public, anon, authenticated;
revoke all on function public._meeting_reconcile_trigger() from public, anon, authenticated;
revoke all on function public.meeting_live_move_scout(bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_dismiss_new(bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.meeting_live_discard(bigint, bigint) from public, anon, authenticated;
grant execute on function public._meeting_reconcile_core(bigint) to service_role;
grant execute on function public.meeting_reconcile(bigint) to service_role;
grant execute on function public._meeting_live_bump(bigint) to service_role;
grant execute on function public.meeting_live_move_scout(bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.meeting_live_dismiss_new(bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.meeting_live_discard(bigint, bigint) to service_role;

-- ── 8b. lock order: pick and answer writes take the Live lock up front (qa-lead, L1) ─────────────────────────────
-- The deferred triggers reconcile at commit, under the Live lock. Without this, a pick that inserted a new topic would
-- wait at commit for the Live lock while a Live edit holding it waited on that topic's uncommitted key: a deadlock
-- Postgres breaks by failing one of them. Every pick write starts in _meeting_pick_guard and every answer in
-- meeting_set_intent (meeting_answer_pick_invite goes through meeting_add_pick); both now take the per-scout board
-- lock, then the Live lock when the meeting has an arrangement, then write. A Live edit never takes a board lock, so
-- the order is always board → Live → rows. Bodies are pg_get_functiondef's, with only the marked lines added.
-- Known, accepted: merge_people locks both people rows first and reconciles at commit; a Live edit placing one of
-- those two people in that same instant could deadlock (Postgres fails one; the merge or the move is retried).
create or replace function public._meeting_live_lock_if_started(p_entry bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (select live_started_at from meeting_boards where calendar_entry_id = p_entry) is not null then
    perform public._meeting_live_lock(p_entry);
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public._meeting_pick_guard(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_carry jsonb, p_op text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c jsonb;
  v_topic bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  -- Rotations L1: the Live lock next, before any row is written, so this write's reconcile (at commit) never waits
  -- on a Live edit that is waiting on this write's rows.
  perform public._meeting_live_lock_if_started(p_entry);
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if not exists (select 1 from scouts where person_id = p_person and active) then
    raise exception 'Picks are for scouts.';
  end if;
  if not public._meeting_may_act_for(p_actor, p_person, p_leader) then
    raise exception 'You can only pick for yourself or the scouts in your household.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There are no picks for this meeting.';
  end if;
  if exists (select 1 from meeting_pick_lists where calendar_entry_id = p_entry and person_id = p_person) then
    return;
  end if;
  insert into meeting_pick_lists (calendar_entry_id, person_id) values (p_entry, p_person);
  for c in select * from jsonb_array_elements(coalesce(p_carry, '[]'::jsonb)) loop
    exit when (select count(*) from meeting_topic_picks where calendar_entry_id = p_entry and person_id = p_person) >= 5;
    v_topic := public._meeting_topic_id(p_entry, c->>'topic_key');
    continue when v_topic is null;
    insert into meeting_topic_picks (topic_id, calendar_entry_id, person_id, priority, first_asked_on, note, later, entered_by_person_id)
    values (
      v_topic, p_entry, p_person,
      nullif(c->>'priority', '')::smallint,
      coalesce(nullif(c->>'first_asked_on', '')::date, (now() at time zone 'America/Chicago')::date),
      nullif(left(btrim(coalesce(c->>'note', '')), 200), ''),
      false,
      nullif(c->>'entered_by_person_id', '')::bigint
    )
    on conflict (topic_id, person_id) do nothing;
  end loop;
  -- A carried order with gaps (a finished pick dropped off) renumbers 1..n; an unranked list stays unranked.
  update meeting_topic_picks p set priority = o.n
    from (
      select topic_id, row_number() over (order by priority, topic_id) as n
        from meeting_topic_picks where calendar_entry_id = p_entry and person_id = p_person and priority is not null
    ) o
   where p.topic_id = o.topic_id and p.person_id = p_person;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meeting_set_intent(p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_intent text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  -- Rotations L1: the Live lock next, before any row is written, so this write's reconcile (at commit) never waits
  -- on a Live edit that is waiting on this write's rows.
  perform public._meeting_live_lock_if_started(p_entry);
  if p_intent not in ('coming', 'undecided', 'not_coming') then raise exception 'Unknown answer %', p_intent; end if;
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if not public._meeting_may_act_for(p_actor, p_person, p_leader) then
    raise exception 'You can only answer for yourself or the scouts in your household.';
  end if;
  if public.meeting_board_mode(p_entry) = 'closed' then
    raise exception 'There are no sign-ups for this meeting.';
  end if;
  insert into meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id)
  values (p_entry, p_person, p_intent, p_actor)
  on conflict (calendar_entry_id, person_id)
  do update set intent = excluded.intent, entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
end;
$function$;

revoke all on function public._meeting_live_lock_if_started(bigint) from public, anon, authenticated;
grant execute on function public._meeting_live_lock_if_started(bigint) to service_role;

-- ── 9. merge_people: pinned / is_new and holds ────────────────────────────────────────────────────────────────────
-- Re-created from 20261223100000 (the current definition); the only changes are the class-member insert (+ pinned,
-- is_new) and the holds block after it.
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
  insert into public.meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id, created_at, updated_at, for_picks)
  select t.topic_id, t.calendar_entry_id, p_survivor, t.note, t.entered_by_person_id, t.created_at, t.updated_at, t.for_picks
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
  -- Wreath sale (W-1): the survivor becomes the last editor of any order note the loser saved.
  update public.wreath_orders set order_note_updated_by_person_id = p_survivor where order_note_updated_by_person_id = p_loser;
  -- Meeting Planner P3: the survivor becomes whoever seeded a topic or created a focus set the loser did.
  update public.meeting_topics set seeded_by_person_id = p_survivor where seeded_by_person_id = p_loser;
  update public.focus_sets set created_by_person_id = p_survivor where created_by_person_id = p_loser;
  -- Meeting Live (P4): the survivor teaches the loser's classes, sits in the loser's classes (a class both were in
  -- keeps one row), and becomes whoever entered the loser's classes and members.
  update public.meeting_classes set teacher_person_id = p_survivor where teacher_person_id = p_loser;
  update public.meeting_classes set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  insert into public.meeting_class_members (class_id, person_id, entered_by_person_id, updated_at, pinned, is_new)
  select m.class_id, p_survivor, m.entered_by_person_id, m.updated_at, m.pinned, m.is_new from public.meeting_class_members m where m.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_class_members where person_id = p_loser;
  update public.meeting_class_members set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Rotations L1: the loser's holds (taken out of a topic by hand) become the survivor's.
  insert into public.meeting_live_holds (calendar_entry_id, person_id, topic_id, entered_by_person_id, created_at)
  select h.calendar_entry_id, p_survivor, h.topic_id, h.entered_by_person_id, h.created_at from public.meeting_live_holds h where h.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_live_holds where person_id = p_loser;
  update public.meeting_live_holds set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Meeting Live attendance (P4c): the survivor keeps every event either side attended (an event both attended keeps
  -- the survivor's row). Ledger credit is keyed by scout and needs no move.
  insert into public.event_attendance (calendar_entry_id, person_id, qty, source, note, recorded_by, recorded_at)
  select a.calendar_entry_id, p_survivor, a.qty, a.source, a.note, a.recorded_by, a.recorded_at
    from public.event_attendance a where a.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.event_attendance where person_id = p_loser;
  -- Meeting Live draft presence (B8): the survivor keeps every draft tick either side had (a meeting both were ticked
  -- at keeps the survivor's row), and becomes whoever entered the loser's ticks.
  insert into public.meeting_live_presence (calendar_entry_id, person_id, present, entered_by_person_id, updated_at)
  select lp.calendar_entry_id, p_survivor, lp.present, lp.entered_by_person_id, lp.updated_at
    from public.meeting_live_presence lp where lp.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_live_presence where person_id = p_loser;
  update public.meeting_live_presence set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Talent discovery (B10c): the survivor keeps every active interest either side had. A key both hold keeps the
  -- survivor's row; the loser's duplicate is dropped. Removed rows (history) move as they are.
  delete from public.teaching_interests l
   where l.person_id = p_loser and l.removed_at is null
     and exists (select 1 from public.teaching_interests s where s.person_id = p_survivor and s.topic_key = l.topic_key and s.removed_at is null);
  update public.teaching_interests set person_id = p_survivor where person_id = p_loser;
  -- Teacher answer pages (B10b): the loser's pages and the teach rows on them become the survivor's. A page still
  -- open takes the survivor's session_epoch, so the link already in the (now the survivor's) inbox keeps working;
  -- a page already voided by a sign-out-everywhere stays void (its open rows were consumed then).
  update public.meeting_invite_pages pg
     set recipient_person_id = p_survivor,
         recipient_epoch = case when pg.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else pg.recipient_epoch end
   where pg.recipient_person_id = p_loser;
  update public.meeting_invites mi
     set invitee_person_id = case when mi.invitee_person_id = p_loser then p_survivor else mi.invitee_person_id end,
         recipient_person_id = case when mi.recipient_person_id = p_loser then p_survivor else mi.recipient_person_id end,
         invitee_epoch = case when mi.invitee_person_id = p_loser and mi.invitee_epoch = v_loser.session_epoch then v_survivor.session_epoch else mi.invitee_epoch end,
         recipient_epoch = case when mi.recipient_person_id = p_loser and mi.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else mi.recipient_epoch end
   where mi.page_id is not null and (mi.invitee_person_id = p_loser or mi.recipient_person_id = p_loser);
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
$function$;

revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;
