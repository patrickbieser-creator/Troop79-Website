-- Plans/Retire-Roster-Contact-Columns.md — Push C (code-first: ships only after
-- v1.107.0's code has stopped reading every column below; guarded by
-- tests/no-roster-contact-column-reads.test.ts).
--
-- people.* is the one home for a human's contact/demographic details
-- (Push A resynced it; Push B moved every reader and writer). What remains on
-- scouts is the scout's record (rank, patrol, school, swim class, junior
-- leader), on leaders the leader's (code, role, login). leaders.name stays as
-- a trigger-derived cache of people.display_name (people_sync_leader_name).

-- ── Dependent objects first ─────────────────────────────────────────────────
-- person_directory read scouts.birthdate for the aged-out rule; people is the home now.
drop view if exists public.person_directory;
create view public.person_directory as
WITH scout_record AS (
         SELECT s.person_id,
            s.id AS scout_id,
            s.active,
            NULLIF(TRIM(BOTH FROM s.inactive_reason), ''::text) AS inactive_reason,
            p.birthdate,
            COALESCE(NULLIF(TRIM(BOTH FROM s.inactive_reason), ''::text), ''::text) = 'aged_out'::text OR p.birthdate IS NOT NULL AND p.birthdate <= (CURRENT_DATE - '18 years'::interval) AS no_longer_youth
           FROM scouts s
           JOIN people p ON p.id = s.person_id
          WHERE s.person_id IS NOT NULL
        ), troop_role AS (
         SELECT r.person_id,
            bool_or(r.role = ANY (ARRAY['adult_leader'::text, 'committee_member'::text, 'chartered_org_rep'::text])) AS holds_troop_role,
            string_agg(DISTINCT r.role, ', '::text ORDER BY r.role) AS roles
           FROM person_roles r
          WHERE r.end_date IS NULL AND r.role <> 'youth_member'::text
          GROUP BY r.person_id
        )
 SELECT p.id AS person_id,
    p.display_name,
    p.primary_email,
    p.primary_phone,
    p.bsa_member_id,
    p.birthdate,
    sr.scout_id,
    sr.inactive_reason,
    COALESCE(cr.roles, ''::text) AS roles,
        CASE
            WHEN sr.scout_id IS NOT NULL AND sr.active AND NOT sr.no_longer_youth THEN 'active_scout'::text
            WHEN sr.scout_id IS NOT NULL AND NOT sr.active AND NOT sr.no_longer_youth THEN 'inactive_scout'::text
            WHEN COALESCE(cr.holds_troop_role, false) THEN 'leader'::text
            ELSE 'adult'::text
        END AS tab,
    p.active AND NOT (sr.scout_id IS NOT NULL AND sr.active AND NOT sr.no_longer_youth) AND NOT (sr.scout_id IS NOT NULL AND NOT sr.active AND NOT sr.no_longer_youth) AS in_picker,
    p.active,
    p.inactive_reason AS person_inactive_reason
   FROM people p
     LEFT JOIN scout_record sr ON sr.person_id = p.id
     LEFT JOIN troop_role cr ON cr.person_id = p.id
  WHERE p.merged_into_person_id IS NULL AND p.guest_host_household_id IS NULL;

-- add_parent_to_household: household via household_members; address via person_emails.
CREATE OR REPLACE FUNCTION public.add_parent_to_household(p_household_id bigint, p_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_relationship text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_scout_person_id bigint;
  v_person_id bigint;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_rel text := nullif(trim(coalesce(p_relationship, '')), '');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'PARENT_NAME_REQUIRED'; end if;

  -- household membership lives in household_members (scouts and adults)
  select s.person_id into v_scout_person_id
    from public.scouts s
    join public.household_members hm on hm.person_id = s.person_id
   where hm.household_id = p_household_id and s.person_id is not null
   order by s.id limit 1;

  if v_email is not null then
    select id into v_person_id from public.people
    where merged_into_person_id is null and lower(trim(primary_email)) = v_email
    limit 1;
  end if;

  if v_person_id is null then
    insert into public.people (first_name, last_name, display_name, primary_email, primary_phone)
    values (
      nullif(split_part(trim(p_name), ' ', 1), ''),
      nullif(trim(substring(trim(p_name) from position(' ' in trim(p_name)) + 1)), ''),
      trim(p_name), v_email, nullif(trim(p_phone), '')
    )
    returning id into v_person_id;
  end if;

  -- person_emails: the people.primary_email trigger creates/promotes the
  -- primary row; an address on an EXISTING person with a different primary
  -- is added as a second address rather than overwriting it.
  if v_email is not null then
    insert into public.person_emails (person_id, email, label, is_primary)
    values (v_person_id, v_email, 'home', not exists (select 1 from public.person_emails x where x.person_id = v_person_id and x.is_primary))
    on conflict (person_id, lower(trim(email))) do nothing;
  end if;

  insert into public.household_members (household_id, person_id)
  values (p_household_id, v_person_id)
  on conflict do nothing;

  if v_scout_person_id is not null and v_scout_person_id <> v_person_id then
    insert into public.relationships (person_id, related_person_id, type, source_label, role_label)
    values (v_person_id, v_scout_person_id, 'parent_of', v_rel, v_rel)
    on conflict (person_id, related_person_id, type)
    do update set role_label = coalesce(public.relationships.role_label, excluded.role_label);
  end if;

  return v_person_id;
end;
$function$;

-- merge_people: person_emails instead of scout_parent_emails; no is_primary_contact.
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


-- ── set_primary_email: one statement, no gap without a primary ──────────────
-- qa-lead (Push B review): the lib's demote-then-promote was two round trips,
-- and the sync trigger set people.primary_email to NULL in between.
create or replace function public.set_primary_email(p_person_id bigint, p_email_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.person_emails where id = p_email_id and person_id = p_person_id) then
    raise exception 'EMAIL_NOT_OWNED';
  end if;
  -- Two statements inside one function = one transaction: no gap a reader
  -- can observe, and the partial unique index (one primary) is never hit by
  -- a single-statement row order that promotes before it demotes.
  update public.person_emails set is_primary = false
   where person_id = p_person_id and is_primary and id <> p_email_id;
  update public.person_emails set is_primary = true
   where id = p_email_id and not is_primary;
end;
$$;

-- ── Drops ───────────────────────────────────────────────────────────────────
-- Duplicate contact/demographic columns
alter table public.scouts
  drop column if exists address_line1,
  drop column if exists address_line2,
  drop column if exists city,
  drop column if exists state,
  drop column if exists zip,
  drop column if exists phone,
  drop column if exists email,
  drop column if exists health_form_date,
  drop column if exists birthdate,
  drop column if exists gender,
  drop column if exists bsa_member_id,
  drop column if exists things_we_should_know,
  -- household membership lives in household_members (scouts AND adults)
  drop column if exists household_id,
  -- dead since the spine (audit 2026-08-26)
  drop column if exists auth_user_id,
  drop column if exists last_activity,
  drop column if exists joined_date;

alter table public.leaders
  drop column if exists address_line1,
  drop column if exists address_line2,
  drop column if exists city,
  drop column if exists state,
  drop column if exists zip,
  drop column if exists phone,
  drop column if exists email,
  drop column if exists health_form_date,
  drop column if exists birthdate,
  drop column if exists bsa_member_id,
  drop column if exists ypt_completed,
  drop column if exists things_we_should_know,
  -- derivable: leaders.person_id = scouts.person_id
  drop column if exists scout_id;

-- Dead columns from the audit
alter table public.households drop column if exists notes;
alter table public.household_members drop column if exists is_primary_contact;

-- Legacy parent-email table: every row now lives on the parent's
-- person_emails (Push A, 4b). Its two readers moved in Push B.
drop table if exists public.scout_parent_emails;
