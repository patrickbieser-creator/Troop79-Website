-- Meeting Planner III: split a group into Group 1, 2, 3 (Plans/Meeting-Planner-III-Split-Groups.md, S2).
--
-- 1. meeting_group_splits: one row per section of a split group. group_key is the base ('fr:tenderfoot', and later
--    'fr:mb:first-aid', D7), section 1-3, item_keys the requirement keys that section lists (a key may sit in several,
--    D3; a focus key no section lists is Group 1's, decided in lib/focus-plan), from_done the section's level (how many
--    of the rank's requirements a scout has done to start there; Group 1 = 0; all 0 = placement by fit alone). merged_at
--    set on every row of a base =
--    the soft merge: the engine reads '~2'/'~3' keys as the base, and clearing it brings the split back as it was.
-- 2. meeting_topics_one_reference: a group topic may be 'fr:<rank>~2' / '~3' (and 'fr:mb:<mb>~2' / '~3').
-- 3. _meeting_topic_id: resolves a section key (the base id without the suffix); '~1', '~4' and the like are nothing.
-- 4. meeting_split_group(entry, group, sections jsonb, levels int[], actor): sets the base's sections (2-3 arrays of
--    keys) and their levels (null = all 0), replacing
--    any split it had and un-merging it; under the meeting's seed lock. Move / share a column = the same call with the
--    sections changed. meeting_merge_group / meeting_unmerge_group set or clear merged_at.
-- 5. meeting_board_stamp: + the splits (count, max(updated_at); every change sets updated_at, merge included).
-- 6. merge_people: + meeting_group_splits.updated_by_person_id (20261231500000's body otherwise).
--
-- DEPLOY ORDER: DB-first (additive; the CHECK rewrite only widens). Posture (D-051 / D-239): RLS on, no policies,
-- nothing granted to anon or authenticated; functions invoker with search_path pinned, EXECUTE to service_role only.

-- ── 1. the table ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_group_splits (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  group_key text not null check (group_key ~ '^fr:(mb:)?[a-z0-9][a-z0-9-]{0,80}$'),
  section smallint not null check (section between 1 and 3),
  item_keys text[] not null default '{}' check (cardinality(item_keys) <= 200),
  from_done smallint not null default 0 check (from_done between 0 and 500),
  merged_at timestamptz,
  updated_by_person_id bigint references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (calendar_entry_id, group_key, section)
);
create index if not exists meeting_group_splits_updated_by_idx on public.meeting_group_splits (updated_by_person_id) where updated_by_person_id is not null;
alter table public.meeting_group_splits enable row level security;
revoke all on public.meeting_group_splits from anon, authenticated;

-- ── 2. section keys on group topics ───────────────────────────────────────────────────────────────────────────────
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
    when 'focus_group_part' then req_code is null and title is null and (
                            (rank_id is not null and mb_id is null
                             and topic_key in ('fr:' || rank_id, 'fr:' || rank_id || '~2', 'fr:' || rank_id || '~3'))
                         or (mb_id is not null and rank_id is null
                             and topic_key in ('fr:mb:' || mb_id, 'fr:mb:' || mb_id || '~2', 'fr:mb:' || mb_id || '~3')))
  end
);

-- ── 3. _meeting_topic_id: + section keys ──────────────────────────────────────────────────────────────────────────
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
  v_base text;
begin
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = p_key;
  if found then return v_id; end if;
  if p_key like 'ff:%' or p_key like 'fg:%' then return null; end if;
  if p_key like 'fr:%' then
    -- A group of the night, or one of a split's groups ('~2', '~3'). The id is what's left without the suffix.
    if p_key like '%~%' and p_key !~ '~[23]$' then return null; end if;
    v_base := regexp_replace(p_key, '~[23]$', '');
  end if;
  if p_key like 'fr:mb:%' then
    -- A merit badge group of the night.
    if not exists (select 1 from merit_badges where id = substr(v_base, 7)) then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id)
    values (p_entry, p_key, 'focus_group_part', substr(v_base, 7))
    on conflict (calendar_entry_id, topic_key) do nothing;
  elsif p_key like 'fr:%' then
    -- A rank group: the rank worked on, Scout through First Class only.
    if substr(v_base, 4) not in ('scout', 'tenderfoot', 'second-class', 'first-class') then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id)
    values (p_entry, p_key, 'focus_group_part', substr(v_base, 4))
    on conflict (calendar_entry_id, topic_key) do nothing;
  elsif p_key like 'mb:%' then
    if not exists (select 1 from merit_badges where id = substr(p_key, 4)) then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id)
    values (p_entry, p_key, 'merit_badge', substr(p_key, 4))
    on conflict (calendar_entry_id, topic_key) do nothing;
  else
    -- A rank requirement first: '<rankId>-<top-level code>'. Rank ids carry dashes ('second-class'), so take the
    -- longest rank id the key starts with.
    select r.id into v_rank from ranks r where p_key like r.id || '-%' order by length(r.id) desc limit 1;
    if v_rank is not null and v_rank <> 'scout' and p_key = v_rank || '-BoR' then
      -- A board of review: no catalog row, the rank is the reference.
      insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id, req_code)
      values (p_entry, p_key, 'rank_req', v_rank, 'BoR')
      on conflict (calendar_entry_id, topic_key) do nothing;
    elsif v_rank is not null and exists (
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
revoke all on function public._meeting_topic_id(bigint, text) from public, anon, authenticated;
grant execute on function public._meeting_topic_id(bigint, text) to service_role;

-- ── 4. split, merge, unmerge ──────────────────────────────────────────────────────────────────────────────────────
-- Is p_group a base this meeting can split: a group rank, or a real badge (D7: the engine and table take badges; the
-- screen offers rank groups only).
create or replace function public._meeting_split_base_ok(p_group text) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_group !~ '^fr:(mb:)?[a-z0-9][a-z0-9-]{0,80}$' then false
    when p_group like 'fr:mb:%' then exists (select 1 from merit_badges where id = substr(p_group, 7))
    else substr(p_group, 4) in ('scout', 'tenderfoot', 'second-class', 'first-class')
  end;
$$;

-- Set a group's sections: p_sections is a JSON array of 2-3 arrays of requirement keys (Group 1 first). Replaces the
-- split the group had (merged or not) and leaves it un-merged. A key must name a requirement of that rank or badge;
-- one that doesn't is refused, not skipped (the screen only offers real ones).
create or replace function public.meeting_split_group(p_entry bigint, p_group text, p_sections jsonb, p_levels integer[], p_actor bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n int;
  v_i int;
  v_items text[];
  v_prefix text;
  v_mb text;
  k text;
begin
  perform public._meeting_seed_guard(p_entry);
  if not public._meeting_split_base_ok(p_group) then raise exception 'That group can’t be split.'; end if;
  if jsonb_typeof(p_sections) is distinct from 'array' then raise exception 'Malformed request'; end if;
  v_n := jsonb_array_length(p_sections);
  if v_n not between 2 and 3 then raise exception 'A group splits into 2 or 3 groups.'; end if;
  if p_levels is not null and (
       cardinality(p_levels) <> v_n or p_levels[1] <> 0
       or exists (select 1 from generate_subscripts(p_levels, 1) i where p_levels[i] is null or p_levels[i] not between 0 and 500
                     or (i > 1 and p_levels[i] < p_levels[i - 1]))) then
    raise exception 'Malformed request';
  end if;
  v_mb := case when p_group like 'fr:mb:%' then substr(p_group, 7) end;
  v_prefix := coalesce(v_mb, substr(p_group, 4)) || '-';
  for v_i in 0 .. v_n - 1 loop
    if jsonb_typeof(p_sections -> v_i) is distinct from 'array' then raise exception 'Malformed request'; end if;
    v_items := array(select distinct e from jsonb_array_elements_text(p_sections -> v_i) e);
    if cardinality(v_items) > 200 then raise exception 'Too many requirements in one group.'; end if;
    foreach k in array v_items loop
      if not (k like v_prefix || '%') or (
           case when v_mb is not null
             then not exists (select 1 from merit_badge_requirements q where q.mb_id = v_mb and v_prefix || q.code = k)
             else not exists (select 1 from rank_requirements q where q.rank_id = substr(p_group, 4) and v_prefix || q.code = k)
           end) then
        raise exception 'Not a requirement of this group: %', k;
      end if;
    end loop;
  end loop;
  delete from meeting_group_splits where calendar_entry_id = p_entry and group_key = p_group;
  insert into meeting_group_splits (calendar_entry_id, group_key, section, item_keys, from_done, merged_at, updated_by_person_id, updated_at)
  select p_entry, p_group, (o)::smallint, array(select distinct x from jsonb_array_elements_text(e) x), coalesce(p_levels[o], 0), null, p_actor, now()
    from jsonb_array_elements(p_sections) with ordinality s(e, o);
end;
$$;

-- Merge a split group back into one (soft): the sections stay, marked merged. Nothing to merge = no change.
create or replace function public.meeting_merge_group(p_entry bigint, p_group text, p_actor bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_seed_guard(p_entry);
  update meeting_group_splits set merged_at = now(), updated_by_person_id = p_actor, updated_at = now()
   where calendar_entry_id = p_entry and group_key = p_group and merged_at is null;
end;
$$;

-- Split a merged group again, as it was. A group that was never split is refused.
create or replace function public.meeting_unmerge_group(p_entry bigint, p_group text, p_actor bigint) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_seed_guard(p_entry);
  if not exists (select 1 from meeting_group_splits where calendar_entry_id = p_entry and group_key = p_group) then
    raise exception 'That group has no split to bring back.';
  end if;
  update meeting_group_splits set merged_at = null, updated_by_person_id = p_actor, updated_at = now()
   where calendar_entry_id = p_entry and group_key = p_group and merged_at is not null;
end;
$$;
revoke all on function public._meeting_split_base_ok(text) from public, anon, authenticated;
revoke all on function public.meeting_split_group(bigint, text, jsonb, integer[], bigint) from public, anon, authenticated;
revoke all on function public.meeting_merge_group(bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.meeting_unmerge_group(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public._meeting_split_base_ok(text) to service_role;
grant execute on function public.meeting_split_group(bigint, text, jsonb, integer[], bigint) to service_role;
grant execute on function public.meeting_merge_group(bigint, text, bigint) to service_role;
grant execute on function public.meeting_unmerge_group(bigint, text, bigint) to service_role;

-- ── 5. meeting_board_stamp: + splits ──────────────────────────────────────────────────────────────────────────────
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
    (select count(*) from meeting_topics where calendar_entry_id = p_entry and seeded_at is not null),
    (select count(*) from event_attendance where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_roles where calendar_entry_id = p_entry),
    (select count(*) from meeting_night_badges where calendar_entry_id = p_entry),
    (select count(*) from meeting_live_presence where calendar_entry_id = p_entry and present),
    (select count(*) from meeting_scout_exclusions where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_suggestions where calendar_entry_id = p_entry),
    (select count(*) from meeting_scout_helpers where calendar_entry_id = p_entry),
    (select count(*) from meeting_emails where calendar_entry_id = p_entry and status = 'sent'),
    (select count(*) from meeting_group_splits where calendar_entry_id = p_entry and merged_at is null),
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select max(seeded_at) from meeting_topics where calendar_entry_id = p_entry),
        (select max(recorded_at) from event_attendance where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_roles where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_night_badges where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_live_presence where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_exclusions where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_scout_suggestions where calendar_entry_id = p_entry),
        (select max(set_at) from meeting_scout_helpers where calendar_entry_id = p_entry),
        (select max(sent_at) from meeting_emails where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_group_splits where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 6. merge_people, + group splits ───────────────────────────────────────────────────────────────────────────────
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
  update public.meeting_saved_plans set created_by_person_id = p_survivor where created_by_person_id = p_loser;
  -- Split groups (S2): the survivor becomes whoever last changed a split the loser did.
  update public.meeting_group_splits set updated_by_person_id = p_survivor where updated_by_person_id = p_loser;
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
  -- Meeting Planner III (P2): the loser's hand choices become the survivor's (a meeting both had a choice at keeps the
  -- survivor's), and the survivor becomes whoever set a choice or added a night's badge.
  insert into public.meeting_scout_roles (calendar_entry_id, person_id, role, ref_key, set_by_person_id, set_at)
  select r.calendar_entry_id, p_survivor, r.role, r.ref_key, r.set_by_person_id, r.set_at
    from public.meeting_scout_roles r where r.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_scout_roles where person_id = p_loser;
  update public.meeting_scout_roles set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  -- Meeting Planner III Emails (E1): a family's unticks, suggestions and helper answers become the survivor's (a key
  -- or meeting both had keeps the survivor's), the survivor becomes whoever set them, and the email log follows.
  insert into public.meeting_scout_exclusions (calendar_entry_id, person_id, topic_key, set_by_person_id, set_at)
  select x.calendar_entry_id, p_survivor, x.topic_key, x.set_by_person_id, x.set_at
    from public.meeting_scout_exclusions x where x.person_id = p_loser
  on conflict (calendar_entry_id, person_id, topic_key) do nothing;
  delete from public.meeting_scout_exclusions where person_id = p_loser;
  update public.meeting_scout_exclusions set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  insert into public.meeting_scout_suggestions (calendar_entry_id, person_id, topic_key, suggested_by_person_id, created_at)
  select x.calendar_entry_id, p_survivor, x.topic_key, x.suggested_by_person_id, x.created_at
    from public.meeting_scout_suggestions x where x.person_id = p_loser
  on conflict (calendar_entry_id, person_id, topic_key) do nothing;
  delete from public.meeting_scout_suggestions where person_id = p_loser;
  update public.meeting_scout_suggestions set suggested_by_person_id = p_survivor where suggested_by_person_id = p_loser;
  insert into public.meeting_scout_helpers (calendar_entry_id, person_id, group_key, set_by_person_id, set_at)
  select h.calendar_entry_id, p_survivor, h.group_key, h.set_by_person_id, h.set_at
    from public.meeting_scout_helpers h where h.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_scout_helpers where person_id = p_loser;
  update public.meeting_scout_helpers set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  update public.meeting_emails set recipient_person_id = p_survivor where recipient_person_id = p_loser;
  update public.meeting_emails set queued_by_person_id = p_survivor where queued_by_person_id = p_loser;
  update public.meeting_emails
     set about = jsonb_set(about, '{scouts}', (
           select coalesce(jsonb_agg(distinct case when s::bigint = p_loser then p_survivor else s::bigint end), '[]'::jsonb)
             from jsonb_array_elements_text(about->'scouts') s))
   where about ? 'scouts' and about->'scouts' @> to_jsonb(p_loser);
  update public.meeting_night_badges set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  -- A family link keeps working for the survivor only if it was the loser's live epoch; its scouts follow the merge.
  update public.meeting_plan_pages pg
     set recipient_person_id = p_survivor,
         recipient_epoch = case when pg.recipient_epoch = v_loser.session_epoch then v_survivor.session_epoch else pg.recipient_epoch end
   where pg.recipient_person_id = p_loser;
  update public.meeting_plan_pages
     set scout_person_ids = array(select distinct unnest(array_replace(scout_person_ids, p_loser, p_survivor)))
   where p_loser = any (scout_person_ids);
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
