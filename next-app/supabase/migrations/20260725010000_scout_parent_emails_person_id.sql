-- Re-key scout_parent_emails from scout_parent_id to person_id.
--
-- WHY (Patrick, 2026-07-25)
-- Bounce/unsubscribe tracking has been keyed on scout_parent_id since
-- 20260719010000 — a leftover from before the people spine existed. It's the
-- last thing (besides signup_entries.scout_parent_id) keeping scout_parents
-- alive, and the sole call site (lib/email-recipients.ts) already has to join
-- through scout_parents just to reach it. Re-keying directly to person_id
-- removes that join and clears one of the two FKs blocking a future
-- scout_parents drop (held for a later session — see Plans/).
--
-- DEDUP RISK: a person can hold multiple scout_parents rows (one per child).
-- Two rows for the same person can independently have logged the SAME email
-- address with different bounce/unsubscribe history before this migration —
-- a straight backfill would collide against the new unique(person_id, email)
-- constraint. Rule: the row carrying real bounce/unsubscribe signal wins;
-- among ties, is_primary wins; among ties, lowest id wins (matches
-- households.ts's own "lowest scout_parents.id wins" convention for picking
-- a canonical row per person). Before a loser row is deleted, any signal it
-- alone carries is promoted onto the survivor — never silently dropped.
--
-- This migration also fixes the two WRITE call sites (add_parent_to_household,
-- merge_people) in the same transaction as the column drop, so there is no
-- deploy window where either references a column that no longer exists.

-- ── Step 1: add + backfill ──────────────────────────────────────────────────
alter table public.scout_parent_emails add column if not exists person_id bigint;

update public.scout_parent_emails spe
set person_id = sp.person_id
from public.scout_parents sp
where spe.scout_parent_id = sp.id and spe.person_id is null;

do $$
declare v_unresolved int;
begin
  select count(*) into v_unresolved from public.scout_parent_emails where person_id is null;
  if v_unresolved > 0 then
    raise exception 'scout_parent_emails: % row(s) have no resolvable person_id — resolve by hand before continuing', v_unresolved;
  end if;
end $$;

-- ── Step 2: dedup before the new unique constraint can reject a collision ──
-- Promote bounce/unsubscribe signal from losers onto the surviving row first.
with ranked as (
  select id, person_id, email, bounced_at, unsubscribed_at, is_primary,
         row_number() over (
           partition by person_id, lower(trim(email))
           order by
             (bounced_at is not null or unsubscribed_at is not null) desc,
             is_primary desc,
             id asc
         ) as rnk
  from public.scout_parent_emails
),
winners as (select id from ranked where rnk = 1),
losers  as (select id, person_id, email, bounced_at, unsubscribed_at from ranked where rnk > 1)
update public.scout_parent_emails w
set bounced_at = coalesce(w.bounced_at, l.bounced_at),
    unsubscribed_at = coalesce(w.unsubscribed_at, l.unsubscribed_at)
from losers l, ranked rw
where rw.id = w.id
  and rw.person_id = l.person_id
  and lower(trim(rw.email)) = lower(trim(l.email))
  and w.id in (select id from winners);

delete from public.scout_parent_emails
where id in (
  select id from (
    select id, row_number() over (
      partition by person_id, lower(trim(email))
      order by
        (bounced_at is not null or unsubscribed_at is not null) desc,
        is_primary desc,
        id asc
    ) as rnk
    from public.scout_parent_emails
  ) x where x.rnk > 1
);

-- ── Step 3: constraints ─────────────────────────────────────────────────────
alter table public.scout_parent_emails alter column person_id set not null;

drop index if exists public.scout_parent_emails_one_primary;
alter table public.scout_parent_emails drop constraint if exists scout_parent_emails_scout_parent_id_email_key;

alter table public.scout_parent_emails
  add constraint scout_parent_emails_person_id_email_key unique (person_id, email);

create unique index if not exists scout_parent_emails_one_primary_per_person
  on public.scout_parent_emails (person_id) where is_primary;

create index if not exists scout_parent_emails_person_idx on public.scout_parent_emails (person_id);

-- ── Step 4: drop the old column + its FK + its old parent index ────────────
drop index if exists public.scout_parent_emails_parent_idx;
alter table public.scout_parent_emails drop column scout_parent_id;

-- ── Step 5: fix write call site — add_parent_to_household ──────────────────
create or replace function public.add_parent_to_household(
  p_household_id bigint,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_relationship text default null
)
returns bigint
language plpgsql
as $$
declare
  v_scout text;
  v_scout_person_id bigint;
  v_parent_id bigint;
  v_person_id bigint;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'PARENT_NAME_REQUIRED'; end if;

  select id, person_id into v_scout, v_scout_person_id from public.scouts
  where household_id = p_household_id order by id limit 1;
  if v_scout is null then raise exception 'HOUSEHOLD_HAS_NO_SCOUTS: %', p_household_id; end if;

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

  insert into public.scout_parents (scout_id, name, relationship, email, phone, person_id)
  values (v_scout, trim(p_name), nullif(trim(coalesce(p_relationship, '')), ''),
          v_email, nullif(trim(p_phone), ''), v_person_id)
  returning id into v_parent_id;

  if v_email is not null then
    -- CHANGED (this migration): keyed on person_id, matching the new
    -- unique(person_id, email) constraint.
    insert into public.scout_parent_emails (person_id, email, label, is_primary)
    values (v_person_id, v_email, 'home', true)
    on conflict (person_id, email) do nothing;
  end if;

  insert into public.household_members (household_id, person_id)
  values (p_household_id, v_person_id)
  on conflict do nothing;

  if v_scout_person_id is not null and v_scout_person_id <> v_person_id then
    insert into public.relationships (person_id, related_person_id, type, source_label)
    values (v_person_id, v_scout_person_id, 'parent_of', nullif(trim(coalesce(p_relationship, '')), ''))
    on conflict do nothing;
  end if;

  return v_parent_id;
end;
$$;

-- ── Step 6: fix write call site — merge_people ──────────────────────────────
-- CREATE OR REPLACE, same signature, so no DROP FUNCTION needed.
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
  update scout_parents set person_id = p_survivor where person_id = p_loser;

  -- scout_parent_emails: promote any bounce/unsubscribe signal the loser's
  -- duplicate-address row alone carries onto the survivor's matching row
  -- first (same rule as the re-key dedup — real signal is never dropped),
  -- then move every address the survivor doesn't already have (clearing
  -- is_primary on a moved row if the survivor already has one — the partial
  -- unique index allows only one primary per person), then delete what's
  -- left as pure duplicates. Without this, a merge silently orphans the
  -- loser's deliverability history now that emails carry person_id directly.
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
