-- Meeting Requests & Teaching Offers, Phase 1 (Plans/Meeting-Requests-And-Teaching-Offers.md): scout and parent picks,
-- attendance intent, and the leader's demand view.
--
-- 1. meeting_boards: per-meeting board settings (mode rank | merit_badge | closed, the MB for an MB night, the block
--    count). Created now so Phase 3a only adds UI. No row = the default, resolved by meeting_board_mode(): rank for a
--    Troop Meeting entry (category behavior 'meeting'), closed for everything else and for a "No Troop Meeting" week.
--    lib/meeting-board.ts resolveBoardMode() is the same rule in TypeScript; tests hold the two together.
-- 2. meeting_topics: one row per thing on a meeting's board, keyed by topic_key (the ledger composite code
--    'tenderfoot-4a', 'mb:<mbId>', a station '<mbId>-<code>' for Phase 3b, 'ff:<title>' for a teacher's freeform
--    offer in Phase 2), unique per meeting, so a catalog reseed that renumbers requirement ids never strands a pick.
--    A CHECK holds each kind to exactly its own reference columns and makes topic_key agree with them. No 'skill'
--    kind: a broad skill offer is teacher-side (Phase 2), so demand counts stay clean.
-- 3. meeting_pick_lists: "this scout has their own list on this board". Until a scout (or their parent) first changes
--    anything on a board, their picks there are CARRIED from their last board with a list (computed by the loader,
--    lazily); the first write copies the carried picks in under the lock (p_carry). Without the marker, a scout who
--    took every carried pick off would see them all come back.
-- 4. meeting_topic_picks: scout demand, keyed to the scout's PERSON (people spine; merge_people moves them).
--    calendar_entry_id is denormalized for the per-meeting cap. later = a wish for a future meeting, made while "Can't
--    make it": it doesn't count toward this meeting's demand or imply Coming, and carry-forward clears it.
-- 5. meeting_intents: Coming / Not sure yet / Can't make it, for anyone. A soft signal, never attendance. "Implied
--    coming" (a pick with no answer) is a loader rule, never stored.
-- 6. RPCs: meeting_add_pick / meeting_remove_pick / meeting_set_pick_order / meeting_set_pick_note /
--    meeting_set_intent. Each takes an advisory lock per (meeting, person), re-checks who may act (self; a verified
--    adult in the scout's household; or a leader, which the server action has already verified by capability),
--    refuses a meeting whose day has passed, and records entered_by. Adding a pick needs a rank board; removing,
--    reordering and notes work on any board so stale picks can be cleared; an answer is refused only on a closed one. The cap: at most 5 picks per scout per meeting,
--    LATER PICKS INCLUDED, because later picks carry forward as ordinary picks and would otherwise overflow the next
--    board. The 5:30 pm soft close is display-only: nothing here refuses a late write.
-- 7. meeting_board_stamp: the version stamp the admin tab polls (counts + latest change).
-- 8. merge_people: picks, pick lists and intents follow the survivor; entered_by re-points. Production's body was
--    diffed identical to 20261113100000's first (2026-10-18).
--
-- DEPLOY ORDER: DB-first (additive tables and functions; merge_people body only), then the code.
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker (the
-- callers are service role) with search_path pinned and EXECUTE revoked from public/anon/authenticated.

-- ── 1. meeting_boards ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_boards (
  calendar_entry_id bigint primary key references public.calendar_entries(id) on delete cascade,
  board_mode text not null default 'rank' check (board_mode in ('rank', 'merit_badge', 'closed')),
  board_mb_id text references public.merit_badges(id) on delete set null,
  block_count smallint not null default 2 check (block_count between 1 and 4),
  updated_at timestamptz not null default now(),
  constraint meeting_boards_mb_only_in_mb_mode check (board_mode = 'merit_badge' or board_mb_id is null)
);
alter table public.meeting_boards enable row level security;
revoke all on public.meeting_boards from anon, authenticated;

create or replace function public.meeting_board_mode(p_entry bigint) returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.board_mode from meeting_boards b where b.calendar_entry_id = p_entry),
    (select case
              when k.behavior = 'meeting' and c.title !~* '^\s*no\s+troop\s+meeting' then 'rank'
              else 'closed'
            end
       from calendar_entries c left join calendar_categories k on k.label = c.category
      where c.id = p_entry),
    'closed'
  );
$$;

-- ── 2. meeting_topics ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_topics (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  topic_key text not null,
  kind text not null check (kind in ('rank_req', 'merit_badge', 'mb_req', 'freeform')),
  rank_id text references public.ranks(id) on delete cascade,
  req_code text,
  mb_id text references public.merit_badges(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  constraint meeting_topics_entry_key unique (calendar_entry_id, topic_key),
  constraint meeting_topics_one_reference check (
    case kind
      when 'rank_req' then rank_id is not null and req_code is not null and mb_id is null and title is null
                           and topic_key = rank_id || '-' || req_code
      when 'merit_badge' then mb_id is not null and rank_id is null and req_code is null and title is null
                              and topic_key = 'mb:' || mb_id
      when 'mb_req' then mb_id is not null and req_code is not null and rank_id is null and title is null
                         and topic_key = mb_id || '-' || req_code
      when 'freeform' then title is not null and btrim(title) <> '' and rank_id is null and req_code is null
                           and mb_id is null and topic_key like 'ff:%'
    end
  )
);
alter table public.meeting_topics enable row level security;
revoke all on public.meeting_topics from anon, authenticated;

-- ── 3. meeting_pick_lists ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_pick_lists (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id)
);
create index if not exists meeting_pick_lists_person_idx on public.meeting_pick_lists (person_id);
alter table public.meeting_pick_lists enable row level security;
revoke all on public.meeting_pick_lists from anon, authenticated;

-- ── 4. meeting_topic_picks ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_topic_picks (
  topic_id bigint not null references public.meeting_topics(id) on delete cascade,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  priority smallint check (priority between 1 and 5),
  first_asked_on date not null,
  note text check (note is null or char_length(note) <= 200),
  later boolean not null default false,
  entered_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (topic_id, person_id)
);
create index if not exists meeting_topic_picks_entry_person_idx on public.meeting_topic_picks (calendar_entry_id, person_id);
create index if not exists meeting_topic_picks_person_idx on public.meeting_topic_picks (person_id);
alter table public.meeting_topic_picks enable row level security;
revoke all on public.meeting_topic_picks from anon, authenticated;

-- ── 5. meeting_intents ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_intents (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  intent text not null check (intent in ('coming', 'undecided', 'not_coming')),
  entered_by_person_id bigint references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id)
);
create index if not exists meeting_intents_person_idx on public.meeting_intents (person_id);
alter table public.meeting_intents enable row level security;
revoke all on public.meeting_intents from anon, authenticated;

-- ── 6. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────────

-- May p_actor write for p_target on a meeting board? Self; a VERIFIED ADULT in the same household as the target scout;
-- or a leader (p_leader, verified by capability in the server action before it gets here). "Verified adult" is Verified
-- Signup's own definition: sign-in issues an adult session to anyone person_directory lists outside the scout tabs
-- (tab 'leader' or 'adult') and offers in the picker (in_picker: an active person, not a youth scout). The view already
-- leaves out guest people (guest_host_household_id) and merged-away records. So an inactive youth scout, a deactivated
-- person and a guest never act for a sibling; a scout who has aged out (18+) is an adult, as at sign-in.
create or replace function public._meeting_may_act_for(p_actor bigint, p_target bigint, p_leader boolean) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p_actor is not null and (
    coalesce(p_leader, false)
    or p_actor = p_target
    or (
      exists (select 1 from person_directory d where d.person_id = p_actor and d.tab in ('leader', 'adult') and d.in_picker)
      and exists (select 1 from scouts s where s.person_id = p_target and s.active)
      and exists (
        select 1 from household_members a join household_members b on b.household_id = a.household_id
         where a.person_id = p_actor and b.person_id = p_target
      )
    )
  );
$$;

-- The topic row for a key on a meeting, created on first use. Null when the key names nothing pickable: an unknown
-- or non-top-level requirement, an unknown badge, or a freeform/station topic nobody has put on this board.
create or replace function public._meeting_topic_id(p_entry bigint, p_key text) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_rank text;
  v_code text;
begin
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  if found then return v_id; end if;
  if p_key like 'mb:%' then
    if not exists (select 1 from merit_badges where id = substr(p_key, 4)) then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id)
    values (p_entry, p_key, 'merit_badge', substr(p_key, 4))
    on conflict (calendar_entry_id, topic_key) do nothing;
  else
    -- A rank requirement: '<rankId>-<top-level code>'. Rank ids carry dashes ('second-class'), so take the longest
    -- rank id the key starts with.
    select r.id into v_rank from ranks r where p_key like r.id || '-%' order by length(r.id) desc limit 1;
    if v_rank is null then return null; end if;
    v_code := substr(p_key, length(v_rank) + 2);
    if not exists (
      select 1 from rank_requirements q where q.rank_id = v_rank and q.code = v_code and q.parent_id is null
    ) then
      return null;
    end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id, req_code)
    values (p_entry, p_key, 'rank_req', v_rank, v_code)
    on conflict (calendar_entry_id, topic_key) do nothing;
  end if;
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  return v_id;
end;
$$;

-- Every pick write starts here: the lock, who may act, the board's mode, and the first-write copy of carried picks.
-- p_carry: [{ "topic_key", "first_asked_on" ('YYYY-MM-DD'), "priority", "note", "entered_by_person_id" }], built by
-- the loader from the scout's last board (unfinished picks only, later cleared). Ignored once the list exists.
-- p_op: 'add' needs a rank board; 'edit' (remove, reorder, note) works on any board, so stale picks can always be
-- cleared. Every op is refused once the meeting's day has passed (Central), here as well as in the server action.
create or replace function public._meeting_pick_guard(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_carry jsonb, p_op text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  v_topic bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
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
$$;

-- Add one pick. p_later: a wish for a later meeting (asked when the scout said "Can't make it"). p_mark_coming: the
-- scout answered "At Sunday's meeting" to that question, so they are now Coming (stored, because they chose it).
create or replace function public.meeting_add_pick(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text,
  p_later boolean, p_mark_coming boolean, p_carry jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
  v_ranked boolean;
  v_n int;
begin
  perform public._meeting_pick_guard(p_entry, p_person, p_actor, p_leader, p_carry, 'add');
  v_topic := public._meeting_topic_id(p_entry, p_topic_key);
  if v_topic is null then raise exception 'That isn''t something you can pick for this meeting.'; end if;
  if exists (select 1 from meeting_topic_picks where topic_id = v_topic and person_id = p_person) then
    -- Already picked: the second tap of a double-tap. Nothing to do.
    return;
  end if;
  select count(*), bool_or(priority is not null) into v_n, v_ranked
    from meeting_topic_picks where calendar_entry_id = p_entry and person_id = p_person;
  if v_n >= 5 then
    raise exception 'You have 5. Take one off to add this.';
  end if;
  insert into meeting_topic_picks (topic_id, calendar_entry_id, person_id, priority, first_asked_on, later, entered_by_person_id)
  values (
    v_topic, p_entry, p_person,
    case when coalesce(v_ranked, false) then v_n + 1 end,
    (now() at time zone 'America/Chicago')::date,
    coalesce(p_later, false),
    p_actor
  );
  if coalesce(p_mark_coming, false) then
    insert into meeting_intents (calendar_entry_id, person_id, intent, entered_by_person_id)
    values (p_entry, p_person, 'coming', p_actor)
    on conflict (calendar_entry_id, person_id)
    do update set intent = 'coming', entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
  end if;
end;
$$;

create or replace function public.meeting_remove_pick(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_carry jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
end;
$$;

-- Ranking is optional (Decision 8). p_keys null = clear the order; otherwise every current pick, in order.
create or replace function public.meeting_set_pick_order(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_keys text[], p_carry jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current text[];
begin
  perform public._meeting_pick_guard(p_entry, p_person, p_actor, p_leader, p_carry, 'edit');
  if p_keys is null then
    update meeting_topic_picks set priority = null, updated_at = now()
     where calendar_entry_id = p_entry and person_id = p_person and priority is not null;
    return;
  end if;
  v_current := array(
    select t.topic_key from meeting_topic_picks p join meeting_topics t on t.id = p.topic_id
     where p.calendar_entry_id = p_entry and p.person_id = p_person order by 1
  );
  if v_current is distinct from array(select k from unnest(p_keys) k order by 1) then
    raise exception 'Your picks changed. Reload the page and try again.';
  end if;
  update meeting_topic_picks p set priority = o.n, updated_at = now()
    from unnest(p_keys) with ordinality as o(k, n), meeting_topics t
   where t.calendar_entry_id = p_entry and t.topic_key = o.k and p.topic_id = t.id and p.person_id = p_person;
end;
$$;

create or replace function public.meeting_set_pick_note(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_note text, p_carry jsonb
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_pick_guard(p_entry, p_person, p_actor, p_leader, p_carry, 'edit');
  update meeting_topic_picks p set note = nullif(left(btrim(coalesce(p_note, '')), 200), ''), updated_at = now()
    from meeting_topics t
   where t.id = p.topic_id and t.calendar_entry_id = p_entry and t.topic_key = p_topic_key and p.person_id = p_person;
end;
$$;

-- Coming / Not sure yet / Can't make it. Refused only on a closed board (an MB night still asks who's coming).
create or replace function public.meeting_set_intent(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_intent text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
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
$$;

-- ── 7. meeting_board_stamp ────────────────────────────────────────────────────────────────────────────────────────
-- Changes whenever a pick or an answer on this board is added, removed or edited (a removal changes a count).
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
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

revoke all on function public.meeting_board_mode(bigint) from public, anon, authenticated;
revoke all on function public._meeting_may_act_for(bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public._meeting_topic_id(bigint, text) from public, anon, authenticated;
revoke all on function public._meeting_pick_guard(bigint, bigint, bigint, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function public.meeting_add_pick(bigint, bigint, bigint, boolean, text, boolean, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.meeting_remove_pick(bigint, bigint, bigint, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.meeting_set_pick_order(bigint, bigint, bigint, boolean, text[], jsonb) from public, anon, authenticated;
revoke all on function public.meeting_set_pick_note(bigint, bigint, bigint, boolean, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.meeting_set_intent(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_board_mode(bigint) to service_role;
grant execute on function public._meeting_may_act_for(bigint, bigint, boolean) to service_role;
grant execute on function public._meeting_topic_id(bigint, text) to service_role;
grant execute on function public._meeting_pick_guard(bigint, bigint, bigint, boolean, jsonb, text) to service_role;
grant execute on function public.meeting_add_pick(bigint, bigint, bigint, boolean, text, boolean, boolean, jsonb) to service_role;
grant execute on function public.meeting_remove_pick(bigint, bigint, bigint, boolean, text, jsonb) to service_role;
grant execute on function public.meeting_set_pick_order(bigint, bigint, bigint, boolean, text[], jsonb) to service_role;
grant execute on function public.meeting_set_pick_note(bigint, bigint, bigint, boolean, text, text, jsonb) to service_role;
grant execute on function public.meeting_set_intent(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 8. merge_people: + meeting_pick_lists, meeting_topic_picks, meeting_intents ─────────────────────────────────────
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
$function$;
