-- Plans/Retire-Roster-Contact-Columns.md — Push A (additive, DB-first).
--
-- 1. people <- scouts: the scout form was the only editor of a scout's contact
--    details until v1.106.3, so where the two sides disagree, scouts.* is the
--    truth for SCOUTS (email was already resynced the other way on 2026-08-26
--    after the parent-address cleanup; it is deliberately excluded here).
-- 2. leaders.name derived from people.display_name (trigger + backfill).
-- 3. person_emails: multiple addresses per person, with people.primary_email
--    kept as a two-way cache of the is_primary row so every existing reader
--    and writer keeps working during the transition.
-- 4. Backfill person_emails from people.primary_email, then re-home the legacy
--    scout_parent_emails rows onto the PARENT's person (never the scout's).
--
-- Nothing is dropped here — that is Push C, after the code stops reading the
-- old columns.

-- ── 1. people <- scouts contact resync ──────────────────────────────────────
do $$
declare v_n int;
begin
  with src as (
    select s.person_id,
           nullif(trim(s.phone), '')        as phone,
           nullif(trim(s.address_line1), '') as address_line1,
           nullif(trim(s.address_line2), '') as address_line2,
           nullif(trim(s.city), '')          as city,
           nullif(trim(s.state), '')         as state,
           nullif(trim(s.zip), '')           as zip,
           s.birthdate, s.gender,
           nullif(trim(s.bsa_member_id), '') as bsa_member_id,
           s.health_form_date,
           nullif(trim(s.things_we_should_know), '') as things_we_should_know
    from public.scouts s
    where s.person_id is not null
  ),
  upd as (
    update public.people p set
      primary_phone         = coalesce(src.phone, p.primary_phone),
      address_line1         = coalesce(src.address_line1, p.address_line1),
      address_line2         = coalesce(src.address_line2, p.address_line2),
      city                  = coalesce(src.city, p.city),
      state                 = coalesce(src.state, p.state),
      zip                   = coalesce(src.zip, p.zip),
      birthdate             = coalesce(src.birthdate, p.birthdate),
      gender                = coalesce(src.gender, p.gender),
      bsa_member_id         = coalesce(src.bsa_member_id, p.bsa_member_id),
      health_form_date      = coalesce(src.health_form_date, p.health_form_date),
      things_we_should_know = coalesce(src.things_we_should_know, p.things_we_should_know),
      updated_at            = now()
    from src
    where src.person_id = p.id
      and (
        src.phone is distinct from p.primary_phone and src.phone is not null
        or src.address_line1 is distinct from p.address_line1 and src.address_line1 is not null
        or src.city is distinct from p.city and src.city is not null
        or src.state is distinct from p.state and src.state is not null
        or src.zip is distinct from p.zip and src.zip is not null
        or src.birthdate is distinct from p.birthdate and src.birthdate is not null
        or src.gender is distinct from p.gender and src.gender is not null
        or src.bsa_member_id is distinct from p.bsa_member_id and src.bsa_member_id is not null
        or src.health_form_date is distinct from p.health_form_date and src.health_form_date is not null
        or src.things_we_should_know is distinct from p.things_we_should_know and src.things_we_should_know is not null
      )
    returning p.id
  )
  select count(*) into v_n from upd;
  raise notice 'people <- scouts resync: % people rows updated', v_n;
end $$;

-- ── 2. leaders.name derived from people.display_name ────────────────────────
create or replace function public.sync_leader_name_from_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_name is distinct from old.display_name then
    update public.leaders set name = new.display_name
    where person_id = new.id and is_person and name is distinct from new.display_name;
  end if;
  return new;
end;
$$;

drop trigger if exists people_sync_leader_name on public.people;
create trigger people_sync_leader_name
  after update of display_name on public.people
  for each row execute function public.sync_leader_name_from_person();

do $$
declare v_n int;
begin
  with upd as (
    update public.leaders l set name = p.display_name
    from public.people p
    where p.id = l.person_id and l.is_person and l.name is distinct from p.display_name
    returning l.code
  )
  select count(*) into v_n from upd;
  raise notice 'leaders.name <- people.display_name: % rows updated', v_n;
end $$;

-- ── 3. person_emails ────────────────────────────────────────────────────────
create table if not exists public.person_emails (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  email text not null,
  label text not null default 'home' check (label in ('home', 'work', 'other')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  bounced_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint person_emails_email_shape check (position('@' in email) > 1)
);
create unique index if not exists person_emails_person_email_uniq
  on public.person_emails (person_id, lower(trim(email)));
create unique index if not exists person_emails_one_primary
  on public.person_emails (person_id) where is_primary;
create index if not exists person_emails_email_idx on public.person_emails (lower(trim(email)));
alter table public.person_emails enable row level security;
-- Zero policies (D-051): service role only.

-- 3a. person_emails -> people.primary_email cache
create or replace function public.person_emails_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_person bigint; v_primary text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_person := coalesce(new.person_id, old.person_id);
  select lower(trim(email)) into v_primary from public.person_emails
    where person_id = v_person and is_primary limit 1;
  update public.people set primary_email = v_primary, updated_at = now()
    where id = v_person and primary_email is distinct from v_primary;
  return null;
end;
$$;

drop trigger if exists person_emails_sync_primary on public.person_emails;
create trigger person_emails_sync_primary
  after insert or update or delete on public.person_emails
  for each row execute function public.person_emails_sync_primary();

-- 3b. people.primary_email -> person_emails (the transition's other direction:
--     every existing writer of people.primary_email keeps working)
create or replace function public.people_primary_email_to_person_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  v_email := nullif(lower(trim(new.primary_email)), '');
  -- demote the old primary (keep the row — it is still a known address)
  update public.person_emails set is_primary = false
    where person_id = new.id and is_primary
      and (v_email is null or lower(trim(email)) <> v_email);
  if v_email is not null then
    insert into public.person_emails (person_id, email, is_primary)
      values (new.id, v_email, true)
    on conflict (person_id, lower(trim(email))) do update set is_primary = true;
  end if;
  return new;
end;
$$;

drop trigger if exists people_primary_email_to_person_emails on public.people;
create trigger people_primary_email_to_person_emails
  after insert or update of primary_email on public.people
  for each row execute function public.people_primary_email_to_person_emails();

-- ── 4. Backfill ─────────────────────────────────────────────────────────────
do $$
declare v_n int; v_m int; v_left int;
begin
  -- 4a. one primary row per existing address
  insert into public.person_emails (person_id, email, is_primary)
  select p.id, lower(trim(p.primary_email)), true
  from public.people p
  where nullif(trim(p.primary_email), '') is not null
  on conflict (person_id, lower(trim(email))) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'person_emails backfill from people.primary_email: % rows', v_n;

  -- 4b. legacy scout_parent_emails: since 20260725010000 its person_id IS the
  --     parent's person (re-keyed from scout_parent_id). Every row becomes a
  --     person_emails row for that parent: the primary already exists from 4a
  --     (flags merged), any other address lands as a non-primary — exactly the
  --     "second email" Phase 2 exists for. Rows keyed to a SCOUT (none in
  --     prod as of 2026-08-26) are left for review and dropped in Push C.
  with legacy as (
    select spe.person_id, lower(trim(spe.email)) as em, spe.label, spe.bounced_at, spe.unsubscribed_at
    from public.scout_parent_emails spe
    join public.people p on p.id = spe.person_id
    where nullif(trim(spe.email), '') is not null
      and spe.person_id not in (select person_id from public.scouts where person_id is not null)
  ),
  ins as (
    insert into public.person_emails (person_id, email, label, is_primary, bounced_at, unsubscribed_at)
    select person_id, em, case when label in ('home','work','other') then label else 'home' end, false, bounced_at, unsubscribed_at
    from legacy
    on conflict (person_id, lower(trim(email))) do update
      set bounced_at = coalesce(public.person_emails.bounced_at, excluded.bounced_at),
          unsubscribed_at = coalesce(public.person_emails.unsubscribed_at, excluded.unsubscribed_at)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_m, v_n from ins;
  raise notice 'scout_parent_emails -> person_emails: % new non-primary addresses, % already present (flags merged)', v_m, v_n;

  select count(*) into v_left from public.scout_parent_emails spe
  where spe.person_id in (select person_id from public.scouts where person_id is not null);
  raise notice 'scout_parent_emails rows keyed to a scout (left for review, dropped in Push C): %', v_left;
end $$;
