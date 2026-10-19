-- Meeting Requests & Teaching Offers, Phase 0a (Plans/Meeting-Requests-And-Teaching-Offers.md): teaching skills and
-- merit badge counselors keyed to PEOPLE, so a parent with no leader code can teach or counsel.
--
-- 1. teaching_skills(person_id, skill_id): ONE table for adults and scouts, replacing leader_skills (by leader code)
--    and scout_instructors (by scout id). Whether a row makes an adult teacher or a scout instructor follows from who
--    the person is; a scout only ever teaches a youth-teachable skill (checked at write and at read). The backfill
--    RAISEs on any row it can't place and asserts rows in = rows out. The old tables stay until a later migration
--    drops them, once the code that reads teaching_skills is live.
-- 2. merit_badge_counselors re-keyed in place to (mb_id, person_id). Non-person sign-off sources (Summer Camp, the
--    "Camp" code: 2 rows, animal-science and art) are not people and can't counsel, so they are dropped (the plan's
--    rule for Camp, extended to counselors). leader_code stays, nullable, until the later drop; a bridge trigger
--    fills person_id from it for any writer still sending only the code.
-- 3. merge_people moves both to the survivor.
--
-- DEPLOY ORDER: DB-first, then the code straight after (admin skill edits made in between land in the old tables).
-- Posture (D-051 / D-239): RLS on, no policies, nothing granted to anon or authenticated.

-- ── 1. teaching_skills ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.teaching_skills (
  person_id bigint not null references public.people(id) on delete cascade,
  skill_id text not null references public.skills(id) on delete cascade,
  authorized_by text,
  authorized_at timestamptz not null default now(),
  primary key (person_id, skill_id)
);
create index if not exists teaching_skills_skill_idx on public.teaching_skills (skill_id);
alter table public.teaching_skills enable row level security;
revoke all on public.teaching_skills from anon, authenticated;

do $$
declare
  v_orphans int;
  v_expected int;
  v_got int;
begin
  select count(*) into v_orphans
    from leader_skills ls join leaders l on l.code = ls.leader_code
   where l.person_id is null and l.is_person;
  if v_orphans > 0 then raise exception 'teaching_skills backfill: % leader_skills rows belong to a person-leader with no person_id', v_orphans; end if;
  select count(*) into v_orphans
    from scout_instructors si join scouts s on s.id = si.scout_id
   where s.person_id is null;
  if v_orphans > 0 then raise exception 'teaching_skills backfill: % scout_instructors rows belong to a scout with no person_id', v_orphans; end if;

  -- Non-person sources (Camp) are dropped explicitly: they are not people.
  insert into teaching_skills (person_id, skill_id, authorized_by, authorized_at)
  select s.person_id, si.skill_id, si.authorized_by, si.authorized_at
    from scout_instructors si join scouts s on s.id = si.scout_id
  on conflict do nothing;
  insert into teaching_skills (person_id, skill_id)
  select l.person_id, ls.skill_id
    from leader_skills ls join leaders l on l.code = ls.leader_code
   where l.person_id is not null
  on conflict do nothing;

  select count(*) into v_expected from (
    select l.person_id, ls.skill_id from leader_skills ls join leaders l on l.code = ls.leader_code where l.person_id is not null
    union
    select s.person_id, si.skill_id from scout_instructors si join scouts s on s.id = si.scout_id
  ) x;
  select count(*) into v_got from teaching_skills;
  if v_got <> v_expected then raise exception 'teaching_skills backfill: expected % rows, got %', v_expected, v_got; end if;
end $$;

-- ── 2. merit_badge_counselors by person ────────────────────────────────────────────────────────────────────────
alter table public.merit_badge_counselors add column if not exists person_id bigint references public.people(id) on delete cascade;
update public.merit_badge_counselors m set person_id = l.person_id from public.leaders l where l.code = m.leader_code and m.person_id is null;
do $$
declare v_bad int;
begin
  select count(*) into v_bad
    from merit_badge_counselors m join leaders l on l.code = m.leader_code
   where m.person_id is null and l.is_person;
  if v_bad > 0 then raise exception 'merit_badge_counselors re-key: % rows belong to a person-leader with no person_id', v_bad; end if;
end $$;
delete from public.merit_badge_counselors where person_id is null;
-- Two leader codes for one person counselling the same badge would collide on the new key: keep the first (qa-lead;
-- production had none on 2026-10-18).
delete from public.merit_badge_counselors m
 where exists (
   select 1 from public.merit_badge_counselors x
    where x.mb_id = m.mb_id and x.person_id = m.person_id
      and (x.sort_order, x.leader_code) < (m.sort_order, m.leader_code)
 );
alter table public.merit_badge_counselors drop constraint if exists merit_badge_counselors_pkey;
alter table public.merit_badge_counselors alter column leader_code drop not null;
alter table public.merit_badge_counselors alter column person_id set not null;
alter table public.merit_badge_counselors add primary key (mb_id, person_id);
create index if not exists mb_counselors_person_idx on public.merit_badge_counselors (person_id);

-- Bridge until leader_code is dropped: a writer sending only the code still lands on the person.
create or replace function public.merit_badge_counselors_fill_person()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- On insert without a person, or when an old writer changes only the code, the code decides the person.
  if new.leader_code is not null
     and ((tg_op = 'INSERT' and new.person_id is null)
          or (tg_op = 'UPDATE' and new.leader_code is distinct from old.leader_code)) then
    select person_id into new.person_id from leaders where code = new.leader_code;
  end if;
  if new.person_id is null then
    raise exception 'A merit badge counselor must be a person';
  end if;
  return new;
end;
$$;
drop trigger if exists merit_badge_counselors_fill_person on public.merit_badge_counselors;
create trigger merit_badge_counselors_fill_person before insert or update on public.merit_badge_counselors
  for each row execute function public.merit_badge_counselors_fill_person();
revoke all on function public.merit_badge_counselors_fill_person() from public, anon, authenticated;

-- ── 3. merge_people: + teaching_skills, merit_badge_counselors ─────────────────────────────────────────────────
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
