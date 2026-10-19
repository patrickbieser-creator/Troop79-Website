-- Meeting Requests & Teaching Offers, Phase 2 (Plans/Meeting-Requests-And-Teaching-Offers.md): the teacher board.
-- Adults (leaders and parents alike) and Junior Leaders say they'll teach what scouts asked for, or offer something
-- first, on one date or several.
--
-- 1. meeting_topic_teachers: "I'll teach this" on one topic of one meeting, keyed to the teacher's PERSON.
--    calendar_entry_id is denormalized for the per-meeting cap. A requirement offer and a freeform offer ("Knife
--    sharpening", which creates an 'ff:<normalized title>' topic: supply on a topic nobody asked for) are rows here too.
-- 2. meeting_teaching_offers: a broad SKILL offer ("First aid") for one meeting. Not a topic (demand counts stay clean):
--    the loader expands it through rank_requirements.skill_id. Per Prototype feedback item 3, a skill offer counts as
--    ONE of the person's two commitments, even when it would fill both blocks.
-- 3. The cap: at most 2 commitments per person per meeting, topic rows and skill offers together, in advisory-locked
--    RPCs (the same per-(meeting, person) lock as Phase 1's picks and answers). A standing offer across dates is one
--    call with several meetings: each date becomes its own row, the locks are taken in date order, and if any date is
--    already full nothing is written and the error names the full dates.
-- 4. Who may act: the person themself, or a leader (p_leader, verified by capability in the server action). A teaching
--    commitment is personal, so a household adult cannot commit for another adult or a scout. Who may teach at all:
--    an adult (person_directory tab leader/adult, in the picker: Verified Signup's definition, as in Phase 1) or an
--    active scout. The Junior Leader rule (canOfferToTeach: First Class+, or grade 9-12 with the roster override) is
--    date-dependent TypeScript and is checked in the server action; the database holds the safety rule: a scout never
--    teaches an adults-only skill (skills.youth_teachable), whether by topic or by skill offer.
-- 5. Qualification is SHOWN, not enforced: an adult may commit to any topic and the board flags "not in your teaching
--    skills" / "sign-off needs a counselor" (matcher rule 1: a non-counselor can teach a badge, flagged).
-- 6. Adds need a rank board (merit badge stations are Phase 3b); removing works on any board. A meeting whose day has
--    passed takes no writes. The 5:30 pm close is display-only, as in Phase 1. Adult intent uses meeting_set_intent.
-- 7. meeting_board_stamp now changes on teacher and offer writes too.
-- 8. merge_people: teacher rows and offers follow the survivor; entered_by re-points. Production's body was diffed
--    identical to 20261115100000's first (2026-10-18).
--
-- DEPLOY ORDER: DB-first (additive tables and functions; the stamp and merge_people bodies only), then the code.
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated; functions are invoker (the
-- callers are service role) with search_path pinned and EXECUTE revoked from public/anon/authenticated.

-- ── 1. meeting_topic_teachers ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_topic_teachers (
  topic_id bigint not null references public.meeting_topics(id) on delete cascade,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  entered_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (topic_id, person_id)
);
create index if not exists meeting_topic_teachers_entry_person_idx on public.meeting_topic_teachers (calendar_entry_id, person_id);
create index if not exists meeting_topic_teachers_person_idx on public.meeting_topic_teachers (person_id);
alter table public.meeting_topic_teachers enable row level security;
revoke all on public.meeting_topic_teachers from anon, authenticated;

-- ── 2. meeting_teaching_offers ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.meeting_teaching_offers (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  skill_id text not null references public.skills(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  entered_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_teaching_offers_one unique (calendar_entry_id, person_id, skill_id)
);
create index if not exists meeting_teaching_offers_person_idx on public.meeting_teaching_offers (person_id);
alter table public.meeting_teaching_offers enable row level security;
revoke all on public.meeting_teaching_offers from anon, authenticated;

-- ── 3. helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

-- 'adult' | 'junior' | null. Adult = Verified Signup's adult (person_directory tab leader/adult, in the picker), which
-- leaves out guests, merged-away and deactivated people. Junior = an active scout (whether they may offer at all is the
-- server action's canOfferToTeach). Anyone else may not teach.
create or replace function public._meeting_teacher_kind(p_person bigint) returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from person_directory d where d.person_id = p_person and d.tab in ('leader', 'adult') and d.in_picker) then 'adult'
    when exists (select 1 from scouts s where s.person_id = p_person and s.active) then 'junior'
  end;
$$;

-- Commitments a person holds on one meeting: topic rows and skill offers together (a skill offer counts as one).
create or replace function public._meeting_teach_count(p_entry bigint, p_person bigint) returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (select count(*) from meeting_topic_teachers where calendar_entry_id = p_entry and person_id = p_person)::int
       + (select count(*) from meeting_teaching_offers where calendar_entry_id = p_entry and person_id = p_person)::int;
$$;

-- The freeform topic for a title on a meeting, created on first use. The key is 'ff:' + the title trimmed, inner
-- whitespace collapsed, cut to 80 characters, lower-cased (lib/meeting-board-teach freeformKey() is the same rule).
create or replace function public._meeting_freeform_topic_id(p_entry bigint, p_title text) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_title text := left(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), 80);
  v_key text;
  v_id bigint;
begin
  if v_title = '' then return null; end if;
  v_key := 'ff:' || lower(v_title);
  insert into meeting_topics (calendar_entry_id, topic_key, kind, title)
  values (p_entry, v_key, 'freeform', v_title)
  on conflict (calendar_entry_id, topic_key) do nothing;
  select id into v_id from meeting_topics where calendar_entry_id = p_entry and topic_key = v_key;
  return v_id;
end;
$$;

-- Every teacher write starts here: the lock, the meeting, who may act, who may teach, and (for an add) a rank board.
-- Returns the person's teacher kind. An 'edit' (taking something back) skips the may-teach check, so someone who has
-- since stopped qualifying (deactivated, or a Junior Leader the date rule no longer admits) can still withdraw.
create or replace function public._meeting_teach_guard(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_op text
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended(format('meeting_board:%s:%s', p_entry, p_person), 0));
  if not exists (select 1 from calendar_entries where id = p_entry) then
    raise exception 'That meeting no longer exists.';
  end if;
  if (select entry_date from calendar_entries where id = p_entry) < (now() at time zone 'America/Chicago')::date then
    raise exception 'That meeting has passed.';
  end if;
  if p_actor is null or not (coalesce(p_leader, false) or p_actor = p_person) then
    raise exception 'You can only sign up to teach for yourself.';
  end if;
  v_kind := public._meeting_teacher_kind(p_person);
  if v_kind is null and p_op = 'add' then
    raise exception 'Teaching is for adults and Junior Leaders.';
  end if;
  if p_op = 'add' and public.meeting_board_mode(p_entry) <> 'rank' then
    raise exception 'There’s no teaching sign-up for this meeting.';
  end if;
  return v_kind;
end;
$$;

-- ── 4. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────────

-- "I'll teach this" on one meeting or several (a standing offer of a requirement or of something freeform).
-- p_topic_key: a rank requirement ('tenderfoot-4a'), a badge ('mb:first-aid'), or an existing freeform key; null with
-- p_title for a new freeform offer. Already teaching it on a date = nothing to do there. All-or-nothing.
create or replace function public.meeting_teach_topic(
  p_entries bigint[], p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text, p_title text, p_note text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_entries bigint[] := array(select distinct e from unnest(coalesce(p_entries, '{}'::bigint[])) e where e is not null order by 1);
  v_entry bigint;
  v_kind text;
  v_topic bigint;
  v_topics bigint[] := '{}';
  v_full text[] := '{}';
  v_skill text;
begin
  if cardinality(v_entries) = 0 then raise exception 'Pick at least one date.'; end if;
  foreach v_entry in array v_entries loop
    v_kind := public._meeting_teach_guard(v_entry, p_person, p_actor, p_leader, 'add');
    if p_topic_key is null then
      v_topic := public._meeting_freeform_topic_id(v_entry, p_title);
    else
      v_topic := public._meeting_topic_id(v_entry, p_topic_key);
    end if;
    if v_topic is null then raise exception 'That isn’t something you can teach at this meeting.'; end if;
    v_skill := null;
    if v_kind = 'junior' then
      select k.id into v_skill
        from meeting_topics t
        join rank_requirements q on q.rank_id = t.rank_id and q.code = t.req_code and q.parent_id is null
        join skills k on k.id = q.skill_id
       where t.id = v_topic and not k.youth_teachable;
      if v_skill is not null then
        raise exception 'Junior Leaders can’t teach that: it’s adults only.';
      end if;
    end if;
    v_topics := v_topics || v_topic;
    if not exists (select 1 from meeting_topic_teachers where topic_id = v_topic and person_id = p_person)
       and public._meeting_teach_count(v_entry, p_person) >= 2 then
      v_full := v_full || to_char((select entry_date from calendar_entries where id = v_entry), 'FMMon FMDD');
    end if;
  end loop;
  if cardinality(v_full) > 0 then
    if cardinality(v_entries) = 1 then
      raise exception 'You’re teaching 2. Remove one to add another.';
    end if;
    raise exception 'You’re teaching 2 on %. Remove one there, or pick other dates.', array_to_string(v_full, ', ');
  end if;
  for i in 1 .. cardinality(v_entries) loop
    insert into meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id)
    values (v_topics[i], v_entries[i], p_person, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    on conflict (topic_id, person_id) do nothing;
  end loop;
end;
$$;

-- Take back one commitment on one meeting. A freeform topic nobody teaches or picked any more goes with it.
create or replace function public.meeting_unteach_topic(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_topic_key text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topic bigint;
begin
  perform public._meeting_teach_guard(p_entry, p_person, p_actor, p_leader, 'edit');
  select id into v_topic from meeting_topics where calendar_entry_id = p_entry and topic_key = p_topic_key;
  if v_topic is null then return; end if;
  delete from meeting_topic_teachers where topic_id = v_topic and person_id = p_person;
  -- Lock the topic first (waits out a scout's pick being added to it), so the check below sees that pick.
  perform 1 from meeting_topics where id = v_topic for update;
  delete from meeting_topics t
   where t.id = v_topic and t.kind = 'freeform'
     and not exists (select 1 from meeting_topic_teachers x where x.topic_id = t.id)
     and not exists (select 1 from meeting_topic_picks x where x.topic_id = t.id);
end;
$$;

-- A broad skill offer on one meeting or several. Offering the same skill again on a date updates its note. A scout
-- never offers an adults-only skill. All-or-nothing, like meeting_teach_topic.
create or replace function public.meeting_offer_skill(
  p_entries bigint[], p_person bigint, p_actor bigint, p_leader boolean, p_skill_id text, p_note text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_entries bigint[] := array(select distinct e from unnest(coalesce(p_entries, '{}'::bigint[])) e where e is not null order by 1);
  v_entry bigint;
  v_kind text;
  v_full text[] := '{}';
begin
  if cardinality(v_entries) = 0 then raise exception 'Pick at least one date.'; end if;
  if not exists (select 1 from skills where id = p_skill_id) then raise exception 'Unknown skill %', p_skill_id; end if;
  foreach v_entry in array v_entries loop
    v_kind := public._meeting_teach_guard(v_entry, p_person, p_actor, p_leader, 'add');
    if v_kind = 'junior' and not (select youth_teachable from skills where id = p_skill_id) then
      raise exception 'Junior Leaders can’t teach that: it’s adults only.';
    end if;
    if not exists (select 1 from meeting_teaching_offers where calendar_entry_id = v_entry and person_id = p_person and skill_id = p_skill_id)
       and public._meeting_teach_count(v_entry, p_person) >= 2 then
      v_full := v_full || to_char((select entry_date from calendar_entries where id = v_entry), 'FMMon FMDD');
    end if;
  end loop;
  if cardinality(v_full) > 0 then
    if cardinality(v_entries) = 1 then
      raise exception 'You’re teaching 2. Remove one to add another.';
    end if;
    raise exception 'You’re teaching 2 on %. Remove one there, or pick other dates.', array_to_string(v_full, ', ');
  end if;
  foreach v_entry in array v_entries loop
    insert into meeting_teaching_offers (calendar_entry_id, person_id, skill_id, note, entered_by_person_id)
    values (v_entry, p_person, p_skill_id, nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_actor)
    on conflict (calendar_entry_id, person_id, skill_id)
    do update set note = excluded.note, entered_by_person_id = excluded.entered_by_person_id, updated_at = now();
  end loop;
end;
$$;

create or replace function public.meeting_withdraw_skill_offer(
  p_entry bigint, p_person bigint, p_actor bigint, p_leader boolean, p_skill_id text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public._meeting_teach_guard(p_entry, p_person, p_actor, p_leader, 'edit');
  delete from meeting_teaching_offers where calendar_entry_id = p_entry and person_id = p_person and skill_id = p_skill_id;
end;
$$;

-- ── 5. meeting_board_stamp: + teachers and offers ─────────────────────────────────────────────────────────────────
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
    (select coalesce(extract(epoch from greatest(
        (select max(updated_at) from meeting_topic_picks where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_intents where calendar_entry_id = p_entry),
        (select max(created_at) from meeting_pick_lists where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_topic_teachers where calendar_entry_id = p_entry),
        (select max(updated_at) from meeting_teaching_offers where calendar_entry_id = p_entry),
        (select updated_at from meeting_boards where calendar_entry_id = p_entry)
      ))::text, '0'))
  );
$$;

revoke all on function public._meeting_teacher_kind(bigint) from public, anon, authenticated;
revoke all on function public._meeting_teach_count(bigint, bigint) from public, anon, authenticated;
revoke all on function public._meeting_freeform_topic_id(bigint, text) from public, anon, authenticated;
revoke all on function public._meeting_teach_guard(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_teach_topic(bigint[], bigint, bigint, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.meeting_unteach_topic(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_offer_skill(bigint[], bigint, bigint, boolean, text, text) from public, anon, authenticated;
revoke all on function public.meeting_withdraw_skill_offer(bigint, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.meeting_board_stamp(bigint) from public, anon, authenticated;
grant execute on function public._meeting_teacher_kind(bigint) to service_role;
grant execute on function public._meeting_teach_count(bigint, bigint) to service_role;
grant execute on function public._meeting_freeform_topic_id(bigint, text) to service_role;
grant execute on function public._meeting_teach_guard(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_teach_topic(bigint[], bigint, bigint, boolean, text, text, text) to service_role;
grant execute on function public.meeting_unteach_topic(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_offer_skill(bigint[], bigint, bigint, boolean, text, text) to service_role;
grant execute on function public.meeting_withdraw_skill_offer(bigint, bigint, bigint, boolean, text) to service_role;
grant execute on function public.meeting_board_stamp(bigint) to service_role;

-- ── 6. merge_people: + meeting_topic_teachers, meeting_teaching_offers ───────────────────────────────────────────
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
  insert into public.meeting_topic_teachers (topic_id, calendar_entry_id, person_id, note, entered_by_person_id, created_at, updated_at)
  select t.topic_id, t.calendar_entry_id, p_survivor, t.note, t.entered_by_person_id, t.created_at, t.updated_at
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
