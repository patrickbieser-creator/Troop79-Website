-- Meeting Planner II, P3: seeding and focus sets (Plans/Meeting-Planner-II.md, Decisions 2, 10, 10a, 10b; the
-- tech-lead's P3 spec, 2026-10-21).
--
-- 1. focus_sets / focus_set_labels / focus_set_items: a planner's reusable, labelled group of requirements. An item is
--    a ledger composite key of ANY node ('tenderfoot-4a', 'tenderfoot-4a.1', 'first-aid-9b'), checked against the
--    catalog on save. No usage log: "last used" is max(meeting_topics.seeded_at) for the set.
-- 2. meeting_topics learns seeding: seeded_by_person_id + seeded_at (seeded = seeded_at is not null), and a new kind
--    'focus_group' (key 'fg:<set id>', title = the set's name when seeded, focus_set_id pointing back). The key never
--    changes, so renaming or deleting the set never strands a pick.
-- 3. meeting_topic_members: the items a focus group was seeded with, SNAPSHOT at seeding. Editing the set later never
--    changes a class already on a board.
-- 4. _meeting_topic_id resolves a top-level merit badge requirement ('first-aid-9', kind mb_req; rank ids first, then
--    the merit badge requirement). 'fg:' keys are never created lazily: only by meeting_seed_focus_set.
-- 5. RPCs: focus_set_save / focus_set_delete; meeting_seed_focus_set / meeting_seed_topic / meeting_unseed_topic;
--    focus_requirement_search / focus_requirement_counts (the server search). Who may call them (meeting_planner.seed)
--    is checked by the server action before any of these runs; they take p_actor to record who did it.
-- 6. meeting_board_stamp: + seeded topics, so the board's poller sees a seed or unseed.
-- 7. merge_people: + meeting_topics.seeded_by_person_id, focus_sets.created_by_person_id, and the teacher copy now
--    carries meeting_topic_teachers.for_picks (qa-lead, 2026-10-21). The body is production's (pg_get_functiondef,
--    identical to 20261124100000's) with only those lines added.
--
-- DEPLOY ORDER: DB-first (additive tables, columns and functions; the CHECK rewrite only widens), then the code.
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker with
-- search_path pinned and EXECUTE revoked from public/anon/authenticated.

-- ── 1. focus sets ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.focus_sets (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> '' and char_length(name) <= 80),
  created_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.focus_sets enable row level security;
revoke all on public.focus_sets from anon, authenticated;

create table if not exists public.focus_set_labels (
  set_id bigint not null references public.focus_sets(id) on delete cascade,
  label text not null check (label = lower(btrim(label)) and char_length(label) between 1 and 30),
  primary key (set_id, label)
);
alter table public.focus_set_labels enable row level security;
revoke all on public.focus_set_labels from anon, authenticated;

create table if not exists public.focus_set_items (
  set_id bigint not null references public.focus_sets(id) on delete cascade,
  topic_key text not null,
  position smallint not null default 0,
  primary key (set_id, topic_key)
);
alter table public.focus_set_items enable row level security;
revoke all on public.focus_set_items from anon, authenticated;

-- ── 2. meeting_topics: seeding and focus groups ───────────────────────────────────────────────────────────────────
alter table public.meeting_topics
  add column if not exists seeded_by_person_id bigint references public.people(id) on delete set null,
  add column if not exists seeded_at timestamptz,
  add column if not exists focus_set_id bigint references public.focus_sets(id) on delete set null;
create index if not exists meeting_topics_focus_set_idx on public.meeting_topics (focus_set_id) where focus_set_id is not null;
create index if not exists meeting_topics_seeded_by_idx on public.meeting_topics (seeded_by_person_id) where seeded_by_person_id is not null;

alter table public.meeting_topics drop constraint if exists meeting_topics_kind_check;
alter table public.meeting_topics add constraint meeting_topics_kind_check
  check (kind in ('rank_req', 'merit_badge', 'mb_req', 'freeform', 'focus_group'));
alter table public.meeting_topics drop constraint if exists meeting_topics_one_reference;
alter table public.meeting_topics add constraint meeting_topics_one_reference check (
  case kind
    when 'rank_req' then rank_id is not null and req_code is not null and mb_id is null and title is null
                         and topic_key = rank_id || '-' || req_code
    when 'merit_badge' then mb_id is not null and rank_id is null and req_code is null and title is null
                            and topic_key = 'mb:' || mb_id
    when 'mb_req' then mb_id is not null and req_code is not null and rank_id is null and title is null
                       and topic_key = mb_id || '-' || req_code
    when 'freeform' then title is not null and btrim(title) <> '' and rank_id is null and req_code is null
                         and mb_id is null and topic_key like 'ff:%'
    when 'focus_group' then title is not null and btrim(title) <> '' and rank_id is null and req_code is null
                            and mb_id is null and topic_key like 'fg:%'
  end
);
-- Only a focus group points at a set.
alter table public.meeting_topics drop constraint if exists meeting_topics_focus_set_only_groups;
alter table public.meeting_topics add constraint meeting_topics_focus_set_only_groups
  check (focus_set_id is null or kind = 'focus_group');

-- ── 3. meeting_topic_members ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_topic_members (
  topic_id bigint not null references public.meeting_topics(id) on delete cascade,
  item_key text not null,
  position smallint not null default 0,
  primary key (topic_id, item_key)
);
alter table public.meeting_topic_members enable row level security;
revoke all on public.meeting_topic_members from anon, authenticated;

-- ── 4. _meeting_topic_id: + top-level merit badge requirements; never a focus group ──────────────────────────────
-- The topic row for a key on a meeting, created on first use. Null when the key names nothing pickable: an unknown
-- or non-top-level requirement, an unknown badge, or a freeform/focus-group/station topic nobody put on this board.
create or replace function public._meeting_topic_id(p_entry bigint, p_key text) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_rank text;
  v_mb text;
  v_code text;
begin
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  if found then return v_id; end if;
  if p_key like 'ff:%' or p_key like 'fg:%' then return null; end if;
  if p_key like 'mb:%' then
    if not exists (select 1 from merit_badges where id = substr(p_key, 4)) then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id)
    values (p_entry, p_key, 'merit_badge', substr(p_key, 4))
    on conflict (calendar_entry_id, topic_key) do nothing;
  else
    -- A rank requirement first: '<rankId>-<top-level code>'. Rank ids carry dashes ('second-class'), so take the
    -- longest rank id the key starts with.
    select r.id into v_rank from ranks r where p_key like r.id || '-%' order by length(r.id) desc limit 1;
    if v_rank is not null and exists (
      select 1 from rank_requirements q where q.rank_id = v_rank and q.code = substr(p_key, length(v_rank) + 2) and q.parent_id is null
    ) then
      v_code := substr(p_key, length(v_rank) + 2);
      insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id, req_code)
      values (p_entry, p_key, 'rank_req', v_rank, v_code)
      on conflict (calendar_entry_id, topic_key) do nothing;
    else
      -- Then a top-level merit badge requirement: '<mbId>-<code>', the longest badge id that names one.
      select q.mb_id, q.code into v_mb, v_code
        from merit_badge_requirements q
       where q.parent_id is null and p_key = q.mb_id || '-' || q.code
       order by length(q.mb_id) desc limit 1;
      if v_mb is null then return null; end if;
      insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id, req_code)
      values (p_entry, p_key, 'mb_req', v_mb, v_code)
      on conflict (calendar_entry_id, topic_key) do nothing;
    end if;
  end if;
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  return v_id;
end;
$$;

-- ── 5. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────────

-- Is this a requirement in the catalog (any level)? A rank requirement or a merit badge requirement; never a board
-- of review.
create or replace function public._focus_item_valid(p_key text) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from rank_requirements q where p_key = q.rank_id || '-' || q.code and lower(q.code) <> 'bor')
      or exists (select 1 from merit_badge_requirements q where p_key = q.mb_id || '-' || q.code);
$$;

-- Create (p_set null) or replace a focus set: its name, labels and items, in the order given. Returns the set's id.
create or replace function public.focus_set_save(
  p_actor bigint, p_set bigint, p_name text, p_labels text[], p_items text[]
) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  v_id bigint := p_set;
  v_bad text;
  v_label text;
begin
  if v_name = '' then raise exception 'Give the set a name.'; end if;
  if cardinality(coalesce(p_items, '{}'::text[])) > 300 then raise exception 'Keep a set to 300 requirements.'; end if;
  select k into v_bad from unnest(coalesce(p_items, '{}'::text[])) k where not public._focus_item_valid(k) limit 1;
  if v_bad is not null then raise exception 'That isn’t a requirement: %', v_bad; end if;
  foreach v_label in array coalesce(p_labels, '{}'::text[]) loop
    if char_length(lower(btrim(v_label))) not between 1 and 30 then
      raise exception 'Keep labels to 30 characters.';
    end if;
  end loop;
  if v_id is null then
    insert into focus_sets (name, created_by_person_id) values (v_name, p_actor) returning id into v_id;
  else
    update focus_sets set name = v_name, updated_at = now() where id = v_id;
    if not found then raise exception 'That set no longer exists.'; end if;
  end if;
  delete from focus_set_labels where set_id = v_id;
  insert into focus_set_labels (set_id, label)
  select distinct v_id, lower(btrim(l)) from unnest(coalesce(p_labels, '{}'::text[])) l
  on conflict do nothing;
  delete from focus_set_items where set_id = v_id;
  insert into focus_set_items (set_id, topic_key, position)
  select v_id, k, min(o)::smallint - 1 from unnest(coalesce(p_items, '{}'::text[])) with ordinality u(k, o) group by k
  on conflict do nothing;
  return v_id;
end;
$$;

-- Delete a set. A focus group already seeded from it stays on its board, with its own title and members.
create or replace function public.focus_set_delete(p_set bigint) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  delete from focus_sets where id = p_set;
$$;

-- Seeding starts here: the meeting's lock, and the meeting must still be ahead and taking sign-ups.
create or replace function public._meeting_seed_guard(p_entry bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_seed:%s', p_entry), 0));
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if public.meeting_board_mode(p_entry) = 'closed' then
    raise exception 'That meeting isn’t taking sign-ups.';
  end if;
end;
$$;

-- Seed a meeting with a focus set: ONE focus group (one pick, one class), its items snapshot. Existing focus topics
-- stay. Seeding the same set again changes nothing (its members stay as first seeded); a group unseeded earlier is
-- seeded again as it was. Returns how many requirements the group holds.
create or replace function public.meeting_seed_focus_set(p_entry bigint, p_set bigint, p_actor bigint) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_key text := 'fg:' || p_set;
  v_topic bigint;
begin
  perform public._meeting_seed_guard(p_entry);
  select name into v_name from focus_sets where id = p_set;
  if v_name is null then raise exception 'That set no longer exists.'; end if;
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = v_key;
  if v_topic is null then
    if not exists (select 1 from focus_set_items where set_id = p_set) then
      raise exception 'That set has no requirements yet.';
    end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, title, focus_set_id, seeded_by_person_id, seeded_at)
    values (p_entry, v_key, 'focus_group', v_name, p_set, p_actor, now())
    returning id into v_topic;
    insert into meeting_topic_members (topic_id, item_key, position)
    select v_topic, i.topic_key, i.position from focus_set_items i where i.set_id = p_set;
  else
    update meeting_topics set seeded_by_person_id = p_actor, seeded_at = now()
     where id = v_topic and seeded_at is null;
  end if;
  return (select count(*)::int from meeting_topic_members where topic_id = v_topic);
end;
$$;

-- Seed one top-level requirement (a rank requirement or a merit badge requirement). Already seeded = nothing to do.
create or replace function public.meeting_seed_topic(p_entry bigint, p_key text, p_actor bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
begin
  perform public._meeting_seed_guard(p_entry);
  if p_key like 'mb:%' or p_key like 'ff:%' or p_key like 'fg:%' then
    raise exception 'Seed one requirement at a time.';
  end if;
  v_topic := public._meeting_topic_id(p_entry, p_key);
  if v_topic is null then raise exception 'Seed a whole requirement (like Tenderfoot 4a), not a part of one.'; end if;
  update meeting_topics set seeded_by_person_id = p_actor, seeded_at = now() where id = v_topic and seeded_at is null;
end;
$$;

-- Take a topic off the meeting's focus. With no picks and no teachers the row goes (a focus group's members with it);
-- otherwise it stays, unseeded, for the scouts and teachers on it.
create or replace function public.meeting_unseed_topic(p_entry bigint, p_key text) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_seed:%s', p_entry), 0));
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key and seeded_at is not null;
  if v_topic is null then return; end if;
  -- Lock the topic first (waits out a pick or a teacher being added to it), so the check below sees it.
  perform 1 from meeting_topics where id = v_topic for update;
  delete from meeting_topics t
   where t.id = v_topic
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id)
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id)
     and not exists (select 1 from meeting_stations x where x.topic_id = t.id);
  if found then return; end if;
  update meeting_topics set seeded_by_person_id = null, seeded_at = null where id = v_topic;
end;
$$;

-- The server search: every rank and merit badge requirement (any level, boards of review left out), each typed word
-- matched (AND) against "source code label parent-code parent-label". Words are cut to 6 and the query to 80
-- characters; % and _ are literal. p_kind 'rank' | 'mb' | anything else = both; p_source narrows to one rank or badge.
create or replace function public._focus_requirement_matches(p_q text, p_kind text, p_source text)
returns table (
  kind text, source_id text, source_name text, code text, label text, parent_code text, parent_label text,
  topic_key text, top_level boolean, exact boolean, src_sort integer, top_sort integer, mid_sort integer, child_sort integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with toks as (
    select t from unnest((regexp_split_to_array(lower(btrim(left(coalesce(p_q, ''), 80))), '\s+'))[1:6]) t where t <> ''
  ), reqs as (
    select 'rank'::text as kind, q.rank_id as source_id, r.display_name as source_name, r.sort_order as src_sort,
           q.code, q.label, p.code as parent_code, p.label as parent_label, q.rank_id || '-' || q.code as topic_key,
           q.parent_id is null as top_level,
           coalesce(g.sort_order, p.sort_order, q.sort_order) as top_sort,
           case when g.id is not null then p.sort_order when p.id is not null then q.sort_order else -1 end as mid_sort,
           case when g.id is not null then q.sort_order else -1 end as child_sort
      from rank_requirements q
      join ranks r on r.id = q.rank_id
      left join rank_requirements p on p.id = q.parent_id
      left join rank_requirements g on g.id = p.parent_id
     where lower(q.code) <> 'bor' and (p.id is null or lower(p.code) <> 'bor')
    union all
    select 'mb', q.mb_id, m.name, 1000, q.code, q.label, p.code, p.label, q.mb_id || '-' || q.code, q.parent_id is null,
           coalesce(g.sort_order, p.sort_order, q.sort_order),
           case when g.id is not null then p.sort_order when p.id is not null then q.sort_order else -1 end,
           case when g.id is not null then q.sort_order else -1 end
      from merit_badge_requirements q
      join merit_badges m on m.id = q.mb_id
      left join merit_badge_requirements p on p.id = q.parent_id
      left join merit_badge_requirements g on g.id = p.parent_id
  )
  select x.kind, x.source_id, x.source_name, x.code, x.label, x.parent_code, x.parent_label, x.topic_key, x.top_level,
         exists (select 1 from toks where toks.t = lower(x.code))
           and not exists (
             select 1 from toks
              where toks.t <> lower(x.code)
                and lower(x.source_name) not like '%' || replace(replace(replace(toks.t, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
           ) as exact,
         x.src_sort, x.top_sort, x.mid_sort, x.child_sort
    from reqs x
   where (coalesce(p_kind, '') not in ('rank', 'mb') or x.kind = p_kind)
     and (p_source is null or x.source_id = p_source)
     and not exists (
       select 1 from toks
        where lower(concat_ws(' ', x.source_name, x.code, x.label, x.parent_code, x.parent_label))
              not like '%' || replace(replace(replace(toks.t, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
     );
$$;

-- One page of matches: a code-word match whose other words name the rank or badge first ("First Aid 9"), then ranks in rank order, badges A–Z, catalog order.
create or replace function public.focus_requirement_search(p_q text, p_kind text, p_source text, p_offset integer, p_limit integer)
returns table (
  kind text, source_id text, source_name text, code text, label text, parent_code text, parent_label text,
  topic_key text, top_level boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select m.kind, m.source_id, m.source_name, m.code, m.label, m.parent_code, m.parent_label, m.topic_key, m.top_level
    from public._focus_requirement_matches(p_q, p_kind, p_source) m
   order by m.exact desc, m.src_sort, m.source_name, m.top_sort, m.mid_sort, m.child_sort, m.code
  offset greatest(coalesce(p_offset, 0), 0)
   limit least(greatest(coalesce(p_limit, 50), 1), 101);
$$;

-- How many requirements match in each rank and badge (the browse view, and "N matches" per source).
create or replace function public.focus_requirement_counts(p_q text, p_kind text)
returns table (kind text, source_id text, source_name text, n bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select m.kind, m.source_id, m.source_name, count(*)
    from public._focus_requirement_matches(p_q, p_kind, null) m
   group by m.kind, m.source_id, m.source_name, m.src_sort
   order by m.src_sort, m.source_name;
$$;

-- ── 6. meeting_board_stamp: + seeded topics ───────────────────────────────────────────────────────────────────────
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
    (select count(*) from meeting_topic_teachers where calendar_entry_id = p_entry),
    (select count(*) from meeting_teaching_offers where calendar_entry_id = p_entry),
    (select count(*) from meeting_stations where calendar_entry_id = p_entry),
    (select count(*) from meeting_rotation_placements where calendar_entry_id = p_entry),
    (select count(*) from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null),
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_stations where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_rotation_placements where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

revoke all on function public._meeting_topic_id(bigint, text) from public, anon, authenticated;
revoke all on function public._focus_item_valid(text) from public, anon, authenticated;
revoke all on function public.focus_set_save(bigint, bigint, text, text[], text[]) from public, anon, authenticated;
revoke all on function public.focus_set_delete(bigint) from public, anon, authenticated;
revoke all on function public._meeting_seed_guard(bigint) from public, anon, authenticated;
revoke all on function public.meeting_seed_focus_set(bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.meeting_seed_topic(bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.meeting_unseed_topic(bigint, text) from public, anon, authenticated;
revoke all on function public._focus_requirement_matches(text, text, text) from public, anon, authenticated;
revoke all on function public.focus_requirement_search(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.focus_requirement_counts(text, text) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public._meeting_topic_id(bigint, text) to service_role;
grant execute on function public._focus_item_valid(text) to service_role;
grant execute on function public.focus_set_save(bigint, bigint, text, text[], text[]) to service_role;
grant execute on function public.focus_set_delete(bigint) to service_role;
grant execute on function public._meeting_seed_guard(bigint) to service_role;
grant execute on function public.meeting_seed_focus_set(bigint, bigint, bigint) to service_role;
grant execute on function public.meeting_seed_topic(bigint, text, bigint) to service_role;
grant execute on function public.meeting_unseed_topic(bigint, text) to service_role;
grant execute on function public._focus_requirement_matches(text, text, text) to service_role;
grant execute on function public.focus_requirement_search(text, text, text, integer, integer) to service_role;
grant execute on function public.focus_requirement_counts(text, text) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 7. merge_people: + seeded_by, focus set creator, for_picks in the teacher copy ────────────────────────────────
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
  -- Meeting board (Phase 3b): the survivor keeps a rotation placement either side had (a night both were placed on
  -- keeps the survivor's), and becomes whoever entered the loser's.
  insert into public.meeting_rotation_placements (calendar_entry_id, person_id, group_index, helper_topic_id, other_work, entered_by_person_id, updated_at)
  select r.calendar_entry_id, p_survivor, r.group_index, r.helper_topic_id, r.other_work, r.entered_by_person_id, r.updated_at
    from public.meeting_rotation_placements r where r.person_id = p_loser
  on conflict do nothing;
  delete from public.meeting_rotation_placements where person_id = p_loser;
  update public.meeting_rotation_placements set entered_by_person_id = p_survivor where entered_by_person_id = p_loser;
  -- Wreath sale (W-1): the survivor becomes the last editor of any order note the loser saved.
  update public.wreath_orders set order_note_updated_by_person_id = p_survivor where order_note_updated_by_person_id = p_loser;
  -- Meeting Planner P3: the survivor becomes whoever seeded a topic or created a focus set the loser did.
  update public.meeting_topics set seeded_by_person_id = p_survivor where seeded_by_person_id = p_loser;
  update public.focus_sets set created_by_person_id = p_survivor where created_by_person_id = p_loser;
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
$function$

;
