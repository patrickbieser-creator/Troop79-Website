-- Guests as people — Phase 0a, schema (Plans/Guests-As-People.md, Patrick
-- 2026-08-22: "the concept of guests is misplaced … we need to know who they
-- are, their ride, etc." and, the same day, "mature guest support — BOTH
-- modes are real").
--
-- Guests become a per-event builder SETTING with three modes, not a
-- retirement of the count:
--   none   — no guests;
--   count  — the host's entry carries "+N guests" (guest_count / guest_note),
--            nothing else (Court of Honor, service project);
--   named  — every guest is a `people` row: short-lived, host-linked,
--            invisible to the directory and the pickers, so a guest has a
--            remembered car, a phone (adults only), money and a health-form
--            date like anyone else, and Grandma is the same person across
--            events (campouts, anything priced, anything overnight).
--
-- This migration is ADDITIVE (the house pattern — tighten after a soak,
-- cf. step 15 of Event Logistics):
--   1. event_signups.guest_mode + a two-way sync with allow_guests, so the
--      deployed RPC (reads allow_guests) and the deployed Builder (writes
--      allow_guests) both keep working until the code ships;
--   2. people.guest_host_household_id — non-null ⇒ this person is a guest of
--      that household. A column, not a household_members row: membership
--      means "on the family's party, signs up for anything, appears in
--      /profile"; a guest must not. DB guard: a person can never hold the
--      flag AND a household_members row (tech-lead: CHECK/trigger, not
--      convention);
--   3. person_directory hides guests (every tab and picker reads it);
--   4. a guest's signup entry must carry a guest participant_class
--      (trigger — the rule lives where the class is written);
--   5. backfill: every named guest row (person_id null) gets a people row
--      keyed on (host household, lower(trim(guest_name))) and its person_id
--      set. Reported loudly, never silent: a row whose host household cannot
--      be resolved, or that would twin a live row, ABORTS the migration;
--   6. merge_people learns promotion: merging a guest into a member clears
--      the guest flag (the merged identity is a member if either side was).
--
-- NOT here (Phase 3, after a soak): person_id NOT NULL, dropping guest_name,
-- dropping allow_guests, dropping the two old CHECKs. The RPC moves to
-- guest_mode in the next migration (Phase 0b).

-- ── 1. event_signups.guest_mode ──────────────────────────────────────────
alter table public.event_signups
  add column if not exists guest_mode text not null default 'none'
    check (guest_mode in ('none', 'count', 'named'));

-- What the forms have been WRITING for an allow_guests event since
-- 2026-08-21 is named rows, so that is what the flag meant.
update public.event_signups set guest_mode = 'named'
where allow_guests and guest_mode = 'none';

comment on column public.event_signups.guest_mode is
  'none | count | named — how this event takes guests (Plans/Guests-As-People.md). allow_guests is kept in sync by trigger for one release and then dropped.';

-- Two-way sync for one release: whichever column the writer touched wins.
-- Old code writes allow_guests (true ⇒ named, false ⇒ none); new code
-- writes guest_mode (anything but none ⇒ allow_guests true).
create or replace function public.event_signups_guest_mode_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.guest_mode <> 'none' then
      new.allow_guests := true;
    elsif new.allow_guests then
      new.guest_mode := 'named';
    end if;
  else
    if new.guest_mode is distinct from old.guest_mode then
      new.allow_guests := new.guest_mode <> 'none';
    elsif new.allow_guests is distinct from old.allow_guests then
      new.guest_mode := case when new.allow_guests then 'named' else 'none' end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists event_signups_guest_mode_sync on public.event_signups;
create trigger event_signups_guest_mode_sync
  before insert or update of guest_mode, allow_guests on public.event_signups
  for each row execute function public.event_signups_guest_mode_sync();

-- ── 2. people.guest_host_household_id + the guard ────────────────────────
-- ON DELETE CASCADE, deliberately not SET NULL: a guest whose host household
-- is deleted must not fall into the directory as a plain person. A guest
-- with sign-up history blocks the household delete instead
-- (signup_entries.person_id is RESTRICT) — the honest outcome.
alter table public.people
  add column if not exists guest_host_household_id bigint
    references public.households(id) on delete cascade;

create index if not exists people_guest_host_idx
  on public.people (guest_host_household_id)
  where guest_host_household_id is not null;

comment on column public.people.guest_host_household_id is
  'Non-null ⇒ this person is a GUEST of that household (Plans/Guests-As-People.md): not a household member, hidden from the directory and every picker, sign-up-able only through the host household''s form or a leader. Cleared by merge_people when the guest is promoted into a member.';

create or replace function public.people_guest_not_member()
returns trigger
language plpgsql
as $$
begin
  if new.guest_host_household_id is not null
     and exists (select 1 from public.household_members hm where hm.person_id = new.id) then
    raise exception 'GUEST_CANNOT_BE_HOUSEHOLD_MEMBER: person % is a household member', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists people_guest_not_member on public.people;
create trigger people_guest_not_member
  before insert or update of guest_host_household_id on public.people
  for each row execute function public.people_guest_not_member();

create or replace function public.household_members_not_guest()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.people p
    where p.id = new.person_id and p.guest_host_household_id is not null
  ) then
    raise exception 'GUEST_CANNOT_BE_HOUSEHOLD_MEMBER: person % is a guest — promote them (merge into their member record) first', new.person_id;
  end if;
  return new;
end;
$$;

drop trigger if exists household_members_not_guest on public.household_members;
create trigger household_members_not_guest
  before insert or update of person_id on public.household_members
  for each row execute function public.household_members_not_guest();

-- ── 3. person_directory hides guests ─────────────────────────────────────
-- Same columns as 20260720160000 (CREATE OR REPLACE keeps the column list),
-- one more WHERE arm. The People → Guests tab reads `people` directly.
create or replace view public.person_directory as
with scout_record as (
  select
    s.person_id,
    s.id as scout_id,
    s.active,
    nullif(trim(s.inactive_reason), '') as inactive_reason,
    s.birthdate,
    (
      coalesce(nullif(trim(s.inactive_reason), ''), '') = 'aged_out'
      or (s.birthdate is not null and s.birthdate <= current_date - interval '18 years')
    ) as no_longer_youth
  from public.scouts s
  where s.person_id is not null
),
troop_role as (
  select r.person_id,
         bool_or(r.role in ('adult_leader', 'committee_member', 'chartered_org_rep')) as holds_troop_role,
         string_agg(distinct r.role, ', ' order by r.role) as roles
  from public.person_roles r
  where r.end_date is null and r.role <> 'youth_member'
  group by r.person_id
)
select
  p.id                     as person_id,
  p.display_name,
  p.primary_email,
  p.primary_phone,
  p.bsa_member_id,
  p.birthdate,
  sr.scout_id,
  sr.inactive_reason,
  coalesce(cr.roles, '')   as roles,
  case
    when sr.scout_id is not null and sr.active and not sr.no_longer_youth then 'active_scout'
    when sr.scout_id is not null and not sr.active and not sr.no_longer_youth then 'inactive_scout'
    when coalesce(cr.holds_troop_role, false) then 'leader'
    else 'adult'
  end as tab,
  (
    p.active
    and not (sr.scout_id is not null and sr.active and not sr.no_longer_youth)
    and not (sr.scout_id is not null and not sr.active and not sr.no_longer_youth)
  ) as in_picker,
  p.active,
  p.inactive_reason as person_inactive_reason
from public.people p
left join scout_record sr on sr.person_id = p.id
left join troop_role cr on cr.person_id = p.id
where p.merged_into_person_id is null
  and p.guest_host_household_id is null;

-- ── 4. a guest's entry carries a guest class ─────────────────────────────
-- Sits beside signup_entries_default_class (which only fills a NULL class
-- for roster people). A guest person with no class is a caller bug — raise,
-- don't guess (youth or adult is exactly what the class tells us).
create or replace function public.signup_entries_guest_class_guard()
returns trigger
language plpgsql
as $$
begin
  if new.person_id is not null
     and exists (select 1 from public.people p where p.id = new.person_id and p.guest_host_household_id is not null) then
    if new.participant_class is null then
      raise exception 'GUEST_CLASS_REQUIRED: person % is a guest — a guest entry must name its class', new.person_id;
    end if;
    if new.participant_class not in ('webelos', 'cub_scout', 'youth_guest', 'adult_guest') then
      raise exception 'GUEST_CLASS_INVALID: % — a guest entry carries a guest class (promote the guest to a member first)', new.participant_class;
    end if;
  end if;
  return new;
end;
$$;

-- The default-class trigger (20260822110000) runs first (BEFORE triggers fire
-- in name order) and would hand a guest 'adult' — no scouts row — before the
-- guard saw the NULL. Teach it the one new rule: a guest's class is never
-- guessed, so the guard raises GUEST_CLASS_REQUIRED with the real problem.
create or replace function public.signup_entries_default_class()
returns trigger
language plpgsql
as $$
begin
  if new.participant_class is null then
    if new.person_id is null then
      return new;
    end if;
    if exists (select 1 from public.people p where p.id = new.person_id and p.guest_host_household_id is not null) then
      return new;   -- signup_entries_guest_class_guard raises GUEST_CLASS_REQUIRED
    end if;
    new.participant_class := public.default_participant_class(new.person_id, new.event_signup_id);
  end if;
  return new;
end;
$$;

drop trigger if exists signup_entries_guest_class_guard on public.signup_entries;
create trigger signup_entries_guest_class_guard
  before insert or update of person_id, participant_class on public.signup_entries
  for each row execute function public.signup_entries_guest_class_guard();

-- ── 5. backfill named guest rows → people rows ───────────────────────────
do $$
declare
  r record;
  v_hh bigint;
  v_pid bigint;
  v_twin bigint;
begin
  for r in
    select e.id, e.event_signup_id, e.guest_name, e.household_id,
           h.household_id as host_household_id, h.person_id as host_person_id
    from public.signup_entries e
    left join public.signup_entries h on h.id = e.host_entry_id
    where e.person_id is null
    order by e.id
  loop
    v_hh := coalesce(
      r.household_id,
      r.host_household_id,
      (select hm.household_id from public.household_members hm where hm.person_id = r.host_person_id order by hm.household_id limit 1)
    );
    if v_hh is null then
      raise exception 'GUEST_BACKFILL_NO_HOUSEHOLD: signup_entries % ("%") has no resolvable host household — assign one and re-run', r.id, r.guest_name;
    end if;

    select p.id into v_pid
    from public.people p
    where p.guest_host_household_id = v_hh
      and p.merged_into_person_id is null
      and lower(trim(p.display_name)) = lower(trim(r.guest_name))
    order by p.id
    limit 1;

    if v_pid is null then
      insert into public.people (display_name, guest_host_household_id, notes)
      values (trim(r.guest_name), v_hh, 'Guest — created from a named sign-up row by the 2026-08-23 backfill')
      returning id into v_pid;
    end if;

    -- signup_entries_person_uniq would refuse a second live row for the same
    -- person + event; that is a twin a human must look at, not the
    -- migration's call.
    select x.id into v_twin
    from public.signup_entries x
    where x.event_signup_id = r.event_signup_id and x.person_id = v_pid
      and x.status <> 'cancelled' and x.id <> r.id
    limit 1;
    if v_twin is not null then
      raise exception 'GUEST_BACKFILL_TWIN: signup_entries % and % would both be guest "%" (person %) on event % — cancel one first', r.id, v_twin, r.guest_name, v_pid, r.event_signup_id;
    end if;

    update public.signup_entries set person_id = v_pid, updated_at = now() where id = r.id;
  end loop;
end $$;

-- ── 6. merge_people: promotion clears the guest flag ─────────────────────
-- Body identical to the live definition (20260815200000) plus the guest
-- arms: (a) a guest survivor absorbing a member loser stops being a guest
-- BEFORE the household rows move (the household_members guard would refuse
-- otherwise); (b) the loser's flag is cleared on the way out. Two guests of
-- one household merged together stay a guest.
create or replace function public.merge_people(
  p_survivor bigint,
  p_loser bigint,
  p_decided_by text
) returns void
language plpgsql
security definer
set search_path = public
as $$
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
  update leaders        set person_id = p_survivor where person_id = p_loser;

  update public.scout_parent_emails surv
  set bounced_at = coalesce(surv.bounced_at, dup.bounced_at),
      unsubscribed_at = coalesce(surv.unsubscribed_at, dup.unsubscribed_at)
  from public.scout_parent_emails dup
  where surv.person_id = p_survivor and dup.person_id = p_loser
    and lower(trim(dup.email)) = lower(trim(surv.email));

  update public.scout_parent_emails spe
  set person_id = p_survivor,
      is_primary = spe.is_primary and not exists (
        select 1 from public.scout_parent_emails x where x.person_id = p_survivor and x.is_primary
      )
  where spe.person_id = p_loser
    and not exists (
      select 1 from public.scout_parent_emails x
      where x.person_id = p_survivor and lower(trim(x.email)) = lower(trim(spe.email))
    );

  delete from public.scout_parent_emails where person_id = p_loser;

  insert into household_members (household_id, person_id, is_primary_contact)
  select hm.household_id, p_survivor, hm.is_primary_contact
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
    notes = trim(coalesce(notes, '') || ' [merged into person ' || p_survivor
            || ' by ' || p_decided_by || ' on ' || now()::date || ']'),
    updated_at = now()
  where id = p_loser;
end;
$$;
