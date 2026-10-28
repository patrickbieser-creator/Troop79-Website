-- Meeting Planner III, P2: groups, the night's merit badges, and the planners' hand choices
-- (Plans/Meeting-Planner-III.md, Technical Approach items 3-5).
--
-- 1. meeting_topics kind 'focus_group_part': one group of the night, 'fr:<rankId>' (Scout through First Class, the rank
--    worked on) or 'fr:mb:<mbId>' (a merit badge). Which groups exist is derived in TS from the meeting's focus
--    (lib/focus-plan.ts); the row is created lazily by _meeting_topic_id the first time something hangs off it (a
--    teacher, an invite, a family's pick), so teachers, invites and picks work on a group exactly as on any topic.
-- 2. _meeting_topic_id resolves 'fr:' keys: a group rank, or a real badge. Nothing else.
-- 3. meeting_night_badges: a badge added to the night directly (with or without focus items of its own).
-- 4. meeting_scout_roles: a planner's hand choice for one scout at one meeting (teach / a group / a class from requests
--    and offers). No row = placement decides.
-- 5. focus_sets.merit_badge_id: the set's paired badge, offered when the set is added.
-- 6. (meeting_board_stamp's new version ships in 20261229100000, with the retirement.)
-- 7. merge_people: + the new tables (production's body, only those lines added).
-- 8. meeting_plan_snapshots (P4): each "Publish snapshot": the families-visible plan as it was emailed, numbered per
--    meeting; the page compares a hash of today's plan with the latest to say "families see an earlier version".
-- 9. meeting_plan_pages (P4, qa-lead 2026-10-28): the published email's family link, /i/plan/<token>. A SCOPED
--    capability, never a sign-in: the recipient's own scouts (fixed at mint), one meeting, intent + picks only; only
--    the peppered hash is stored; expires 6 PM Central on the meeting day; a republish supersedes it; a planner can
--    revoke a publish; at most 200 writes. meeting_plan_page_claim locks the page, refuses anything but an open page,
--    re-checks the recipient's session_epoch and counts the write, all at once.
--
-- DEPLOY ORDER: DB-first. Additive only (the CHECK rewrite only widens); production's current code keeps working.
-- The retirement of Rotations is 20261229100000, pushed AFTER this release's code is live (code-first). Posture (D-051 / D-239): RLS on, no policies,
-- nothing granted to anon or authenticated; functions invoker with search_path pinned, EXECUTE to service_role only.

-- ── 1. the group kind ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.meeting_topics drop constraint if exists meeting_topics_kind_check;
alter table public.meeting_topics add constraint meeting_topics_kind_check
  check (kind in ('rank_req', 'merit_badge', 'mb_req', 'freeform', 'focus_group', 'focus_group_part'));
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
                            (rank_id is not null and mb_id is null and topic_key = 'fr:' || rank_id)
                         or (mb_id is not null and rank_id is null and topic_key = 'fr:mb:' || mb_id))
  end
);

-- ── 2. _meeting_topic_id: + groups ────────────────────────────────────────────────────────────────────────────────
-- The topic row for a key on a meeting, created on first use. Null when the key names nothing pickable.
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
  if p_key like 'fr:mb:%' then
    -- A merit badge group of the night.
    if not exists (select 1 from merit_badges where id = substr(p_key, 7)) then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, mb_id)
    values (p_entry, p_key, 'focus_group_part', substr(p_key, 7))
    on conflict (calendar_entry_id, topic_key) do nothing;
  elsif p_key like 'fr:%' then
    -- A rank group: the rank worked on, Scout through First Class only.
    if substr(p_key, 4) not in ('scout', 'tenderfoot', 'second-class', 'first-class') then return null; end if;
    insert into meeting_topics (calendar_entry_id, topic_key, kind, rank_id)
    values (p_entry, p_key, 'focus_group_part', substr(p_key, 4))
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

-- A group's topic row, for the planner's server actions (a teacher slot, an invite). Null for a key that isn't a group.
create or replace function public.meeting_group_topic(p_entry bigint, p_key text) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_key not like 'fr:%' then return null; end if;
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting isn’t on the calendar.';
  end if;
  return public._meeting_topic_id(p_entry, p_key);
end;
$$;

-- ── 3. the night's merit badges ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_night_badges (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  mb_id text not null references public.merit_badges(id) on delete cascade,
  added_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (calendar_entry_id, mb_id)
);
create index if not exists meeting_night_badges_added_by_idx on public.meeting_night_badges (added_by_person_id) where added_by_person_id is not null;
alter table public.meeting_night_badges enable row level security;
revoke all on public.meeting_night_badges from anon, authenticated;

-- ── 4. hand choices ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_scout_roles (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  role text not null check (role in ('teach', 'group', 'request')),
  -- 'group': the group key ('fr:tenderfoot', 'fr:mb:first-aid'); 'request': the topic key; 'teach': none.
  ref_key text,
  set_by_person_id bigint references public.people(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id),
  constraint meeting_scout_roles_ref check (
    case role
      when 'teach' then ref_key is null
      when 'group' then ref_key like 'fr:%'
      when 'request' then ref_key is not null and ref_key not like 'fr:%'
    end
  )
);
create index if not exists meeting_scout_roles_person_idx on public.meeting_scout_roles (person_id);
create index if not exists meeting_scout_roles_set_by_idx on public.meeting_scout_roles (set_by_person_id) where set_by_person_id is not null;
alter table public.meeting_scout_roles enable row level security;
revoke all on public.meeting_scout_roles from anon, authenticated;

-- ── 5. a focus set's paired badge ─────────────────────────────────────────────────────────────────────────────────
alter table public.focus_sets add column if not exists merit_badge_id text references public.merit_badges(id) on delete set null;
create index if not exists focus_sets_merit_badge_idx on public.focus_sets (merit_badge_id) where merit_badge_id is not null;

-- ── 8. published snapshots ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_plan_snapshots (
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  n integer not null check (n >= 1),
  payload jsonb not null,
  payload_hash text not null check (char_length(payload_hash) between 8 and 128),
  published_by_person_id bigint references public.people(id) on delete set null,
  published_at timestamptz not null default now(),
  emailed integer not null default 0 check (emailed >= 0),
  -- Families it was meant for: emailed < meant offers "Send to the families not reached".
  meant integer not null default 0 check (meant >= 0),
  primary key (calendar_entry_id, n)
);
create index if not exists meeting_plan_snapshots_published_by_idx on public.meeting_plan_snapshots (published_by_person_id) where published_by_person_id is not null;
alter table public.meeting_plan_snapshots enable row level security;
revoke all on public.meeting_plan_snapshots from anon, authenticated;

-- ── 9. the family link ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_plan_pages (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  recipient_person_id bigint not null references public.people(id) on delete cascade,
  recipient_epoch integer not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scout_person_ids bigint[] not null check (cardinality(scout_person_ids) between 1 and 12),
  snapshot_n integer not null check (snapshot_n >= 1),
  expires_at timestamptz not null,
  superseded_at timestamptz,
  revoked_at timestamptz,
  write_count integer not null default 0 check (write_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists meeting_plan_pages_entry_recipient_idx on public.meeting_plan_pages (calendar_entry_id, recipient_person_id);
create index if not exists meeting_plan_pages_recipient_idx on public.meeting_plan_pages (recipient_person_id);
alter table public.meeting_plan_pages enable row level security;
revoke all on public.meeting_plan_pages from anon, authenticated;

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
  if not (p_scout = any (r.scout_person_ids)) then raise exception 'scope'; end if;
  if r.write_count >= 200 then raise exception 'limit'; end if;
  update meeting_plan_pages set write_count = write_count + 1 where id = r.id;
  return query select r.id, r.calendar_entry_id, r.recipient_person_id;
end;
$$;

-- ── 7. merge_people: + the new tables (production's body, only those lines added) ───────────────────────────────
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
  -- Meeting Planner III (P2): the loser's hand choices become the survivor's (a meeting both had a choice at keeps the
  -- survivor's), and the survivor becomes whoever set a choice or added a night's badge.
  insert into public.meeting_scout_roles (calendar_entry_id, person_id, role, ref_key, set_by_person_id, set_at)
  select r.calendar_entry_id, p_survivor, r.role, r.ref_key, r.set_by_person_id, r.set_at
    from public.meeting_scout_roles r where r.person_id = p_loser
  on conflict (calendar_entry_id, person_id) do nothing;
  delete from public.meeting_scout_roles where person_id = p_loser;
  update public.meeting_scout_roles set set_by_person_id = p_survivor where set_by_person_id = p_loser;
  update public.meeting_night_badges set added_by_person_id = p_survivor where added_by_person_id = p_loser;
  update public.meeting_plan_snapshots set published_by_person_id = p_survivor where published_by_person_id = p_loser;
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

revoke all on function public._meeting_topic_id(bigint, text) from public, anon, authenticated;
revoke all on function public.meeting_group_topic(bigint, text) from public, anon, authenticated;
revoke all on function public.meeting_plan_page_claim(text, bigint) from public, anon, authenticated;
grant execute on function public._meeting_topic_id(bigint, text) to service_role;
grant execute on function public.meeting_group_topic(bigint, text) to service_role;
grant execute on function public.meeting_plan_page_claim(text, bigint) to service_role;
revoke all on function public.merge_people(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.merge_people(bigint, bigint, text) to service_role;
