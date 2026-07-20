-- People identity spine: declared identity, replacing read-time inference.
--
-- WHY (Patrick, 2026-07-20)
-- A human currently has no single record. The same person exists as a `scouts`
-- row, and/or a `leaders` row, and/or one `scout_parents` row PER CHILD, with
-- no link between any of them. Identity is reconstructed on every page load by
-- normalizing names and emails in next-app/src/lib/households.ts.
--
-- That inference has now failed twice in one week, each time with a different
-- fuzzy-matching mode, and each time it listed a real person twice in the
-- public signup picker and would have allowed a duplicate signup:
--   * v1.13.1 — siblings' parent rows spelled one name two ways
--     ("JamieLynn" / "Jamie Lynn"), so the leaders row carrying the other
--     spelling was treated as a different human.
--   * same release — four adults recorded by nickname on one record and formal
--     name on the other ("Dan"/"Daniel", "Mike"/"Michael", "Nate"/"Nathaniel").
-- 16 of 42 leaders are also in scout_parents. String matching is load-bearing
-- for 38% of the adult roster.
--
-- Three further things the current model cannot express, all of which are real:
--   1. An adult with NO organizational role. `leaders` is the only home for an
--      adult who isn't tied to a child, but 21 code paths read membership in it
--      as "is a leader" — the admin login pool, Roll Call, the Meeting Plan
--      teacher pool, the Roster, and every sign-off initials dropdown. A
--      pending roster import carries ~30 adults whose only role is "parent".
--   2. A non-custodial guardian. Guardianship, parentage, and household
--      membership are currently the same fact, so a guardian who lives
--      elsewhere is unrepresentable.
--   3. An adult's household at all, except through a child — which is why an
--      adult with no scout renders as "signing up on your own".
--
-- SHAPE: additive spine, NOT a table collapse. scouts / leaders / scout_parents
-- keep their primary keys and their shape. scouts.id ('A01') remains the
-- business key that 9,722 ledger_entries rows point at; leaders.code stays put
-- rather than dragging the D-019 rename-cascade into this change. `person_id`
-- is a link column, not a replacement PK.

-- ── The spine ──────────────────────────────────────────────────────────────
-- bigint PK for consistency with households / scout_parents. (scouts.auth_user_id
-- is a uuid, but that is Supabase's auth key, not ours.)
create table if not exists public.people (
  id bigserial primary key,
  first_name text,
  last_name text,
  display_name text not null,
  birthdate date,
  gender text,
  primary_email text,
  primary_phone text,
  bsa_member_id text,
  -- Merges retain the losing row and point it here rather than deleting it, so
  -- an accepted merge stays auditable and reversible. Readers must filter on
  -- `merged_into_person_id is null`; the person_active view below does it.
  merged_into_person_id bigint references public.people(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists people_email_idx on public.people (lower(trim(primary_email)));
create index if not exists people_name_idx on public.people (lower(trim(display_name)));
create index if not exists people_bsa_idx on public.people (bsa_member_id);
create index if not exists people_merged_idx on public.people (merged_into_person_id);

create or replace view public.people_active as
  select * from public.people where merged_into_person_id is null;

-- ── Household membership becomes a stored row ──────────────────────────────
-- Today membership is scouts.household_id ONLY, so an adult's household is
-- inferred transitively through their child. That is exactly why an adult with
-- no scout in the troop cannot have one. Adults and scouts now both get a row.
create table if not exists public.household_members (
  household_id bigint not null references public.households(id) on delete cascade,
  person_id bigint not null references public.people(id) on delete cascade,
  is_primary_contact boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (household_id, person_id)
);

create index if not exists household_members_person_idx on public.household_members (person_id);

-- ── Roles are dated assignments, not table membership ──────────────────────
-- The critical consequence: a person with ZERO rows here has no organizational
-- role. That is how "not a leader, not a merit badge counselor, only a parent"
-- is stated — by absence, with no boolean flag needed. Being a parent is NOT a
-- role; it is a relationship (see below).
--
-- Membership STATUS (active / moved away / aged out) is deliberately not here.
-- It stays on scouts.active + scouts.inactive_reason. The pending import mixes
-- the two in one column ('A','S','Inactive','Moved','Cub'); that conflation is
-- the thing this table exists to avoid inheriting.
create table if not exists public.person_roles (
  id bigserial primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  role text not null check (role in (
    'youth_member',
    'adult_leader',
    'merit_badge_counselor',
    'committee_member',
    'chartered_org_rep',
    'external_contact'
  )),
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists person_roles_person_idx on public.person_roles (person_id);
-- One CURRENT holding of a given role per person; history is expressed by
-- ended rows, which this partial index deliberately ignores.
create unique index if not exists person_roles_one_current
  on public.person_roles (person_id, role)
  where end_date is null;

-- ── Relationships are edges between people ─────────────────────────────────
-- Separate from household_members on purpose. A non-custodial parent is a
-- guardian_of edge WITHOUT a shared household row — the combination the old
-- model could not hold, because it treated the two as one fact.
create table if not exists public.relationships (
  id bigserial primary key,
  person_id bigint not null references public.people(id) on delete cascade,
  related_person_id bigint not null references public.people(id) on delete cascade,
  -- Read as "<person> is <type> <related_person>": parent_of, guardian_of.
  type text not null check (type in (
    'parent_of',
    'guardian_of',
    'sibling_of',
    'emergency_contact_for'
  )),
  is_guardian boolean not null default false,
  -- Free text off the source roster ("Mom", "Dad of Leo and Lucy"). Kept
  -- verbatim rather than parsed: the import's 56 distinct phrasings point in
  -- two directions (adult rows say "Mom of X", scout rows say "Dad Patrick,
  -- Mom Jamie Lynn"), and auto-parsing that is where the next silent bug lives.
  source_label text,
  created_at timestamptz not null default now(),
  constraint relationships_not_self check (person_id <> related_person_id),
  unique (person_id, related_person_id, type)
);

create index if not exists relationships_person_idx on public.relationships (person_id);
create index if not exists relationships_related_idx on public.relationships (related_person_id);

-- ── Link columns on the existing tables ────────────────────────────────────
-- Nullable throughout. Nothing reads these yet; every existing consumer of
-- scouts.id / leaders.code / scout_parents.id keeps working untouched.
alter table public.scouts        add column if not exists person_id bigint references public.people(id) on delete set null;
alter table public.leaders       add column if not exists person_id bigint references public.people(id) on delete set null;
alter table public.scout_parents add column if not exists person_id bigint references public.people(id) on delete set null;

create index if not exists scouts_person_idx        on public.scouts (person_id);
create index if not exists leaders_person_idx       on public.leaders (person_id);
create index if not exists scout_parents_person_idx on public.scout_parents (person_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL
--
-- Bootstrap-matches on EXACT email only. Fuzzy name matching is precisely the
-- mechanism that produced the bugs this migration exists to end, so it is not
-- used here at any confidence level. Whatever exact email cannot resolve is
-- left as separate person rows and surfaced by person_merge_candidates below
-- for a human to decide. Expect roughly a dozen leader/parent pairs to land
-- there, since most leaders rows carry no email.
-- ═══════════════════════════════════════════════════════════════════════════

-- Temporary correlation key, dropped at the end of the backfill.
--
-- The first version of this file inserted a person per source row and then
-- linked back by matching display_name and taking min(id). That is name-based
-- correlation inside the migration whose entire purpose is to END name-based
-- correlation, and it is unsound: nothing constrains scouts.display_name (or
-- leader/parent names) to be unique, so two people sharing a name would both
-- link to the lowest-id row and one person's demographics would silently land
-- on another. It happens to be safe against today's data — 0 duplicate display
-- names among scouts, leaders, or parents, checked — but seven scouts DO share
-- a name with an adult record, so a later run with a new scout could mislink
-- to the adult. Correlating on the source row's own primary key removes the
-- class of bug entirely rather than relying on the data staying lucky.
alter table public.people add column if not exists _backfill_key text;
create unique index if not exists people_backfill_key_idx on public.people (_backfill_key);

-- 1. Every scout is a person. No matching required; scouts are already unique.
insert into public.people (first_name, last_name, display_name, birthdate, gender, primary_email, primary_phone, bsa_member_id, _backfill_key)
select s.first_name, s.last_name, coalesce(nullif(s.display_name, ''), s.first_name || ' ' || s.last_name),
       s.birthdate, s.gender, nullif(trim(s.email), ''), nullif(trim(s.phone), ''), nullif(trim(s.bsa_member_id), ''),
       'scout:' || s.id
from public.scouts s
where s.person_id is null
on conflict (_backfill_key) do nothing;

update public.scouts s
set person_id = p.id
from public.people p
where s.person_id is null
  and p._backfill_key = 'scout:' || s.id;

-- 2. Youth leader codes resolve to their scout's person via the DECLARED link
--    (leaders.scout_id, D-013) rather than by name. This is the one adult/scout
--    identity the old model already stated explicitly, so it costs nothing.
update public.leaders l
set person_id = s.person_id
from public.scouts s
where l.scout_id = s.id
  and l.person_id is null
  and s.person_id is not null;

-- 3. Parents. One person per distinct exact email; parents with no email fall
--    back to their own row (never merged on name). This collapses the
--    sibling-duplicate case — a parent of two scouts has two rows sharing an
--    email and becomes one person.
with keyed as (
  select sp.id,
         sp.name,
         nullif(lower(trim(sp.email)), '') as em,
         nullif(trim(sp.phone), '') as ph
  from public.scout_parents sp
  where sp.person_id is null
),
groups as (
  select coalesce(em, 'row:' || id::text) as gkey,
         min(id) as rep_id,
         min(name) as nm,
         min(em) as em,
         min(ph) as ph
  from keyed
  group by coalesce(em, 'row:' || id::text)
),
-- Reuse a person already created in step 1/2 whose email matches exactly,
-- rather than creating a second row for the same human.
resolved as (
  select g.*, (
    select min(p.id) from public.people p
    where g.em is not null
      and lower(trim(p.primary_email)) = g.em
  ) as existing_id
  from groups g
),
created as (
  insert into public.people (first_name, last_name, display_name, primary_email, primary_phone, _backfill_key)
  select nullif(split_part(r.nm, ' ', 1), ''),
         nullif(substring(r.nm from position(' ' in r.nm) + 1), ''),
         r.nm, r.em, r.ph, 'parent:' || r.gkey
  from resolved r
  where r.existing_id is null
  on conflict (_backfill_key) do nothing
  -- Returned from the CTE, not re-read from the table: rows a data-modifying
  -- CTE inserts are invisible to any other read of that table in the SAME
  -- statement, so a lookup against public.people here silently finds nothing.
  returning id, _backfill_key
)
-- Correlate on the group key, not on the name that was just written.
update public.scout_parents sp
set person_id = coalesce(
      r.existing_id,
      (select c.id from created c where c._backfill_key = 'parent:' || r.gkey)
    )
from resolved r
where sp.person_id is null
  and coalesce(nullif(lower(trim(sp.email)), ''), 'row:' || sp.id::text) = r.gkey;

-- 4. Remaining adult leaders — real people not already resolved as a youth
--    leader or matched to a parent by exact email.
with unresolved as (
  select l.code, l.name, nullif(lower(trim(l.email)), '') as em, nullif(trim(l.phone), '') as ph,
         l.birthdate, nullif(trim(l.bsa_member_id), '') as bsa
  from public.leaders l
  where l.person_id is null and l.is_person
),
resolved as (
  select u.*, (
    select min(p.id) from public.people p
    where u.em is not null and lower(trim(p.primary_email)) = u.em
  ) as existing_id
  from unresolved u
),
created as (
  insert into public.people (first_name, last_name, display_name, primary_email, primary_phone, birthdate, bsa_member_id, _backfill_key)
  select nullif(split_part(r.name, ' ', 1), ''),
         nullif(substring(r.name from position(' ' in r.name) + 1), ''),
         r.name, r.em, r.ph, r.birthdate, r.bsa, 'leader:' || r.code
  from resolved r
  where r.existing_id is null
  on conflict (_backfill_key) do nothing
  -- See the note in step 3: correlate through the CTE's own RETURNING.
  returning id, _backfill_key
)
-- Correlate on leaders.code, not on the name that was just written.
update public.leaders l
set person_id = coalesce(
      r.existing_id,
      (select c.id from created c where c._backfill_key = 'leader:' || r.code)
    )
from resolved r
where l.code = r.code and l.person_id is null;

-- 5. Household membership from the existing stored scout households, plus the
--    adults reachable through those scouts' parent rows. An adult with no
--    scout gets no row here yet — that is a gap the review UI fills, not
--    something to guess at.
insert into public.household_members (household_id, person_id)
select distinct s.household_id, s.person_id
from public.scouts s
where s.household_id is not null and s.person_id is not null
on conflict do nothing;

insert into public.household_members (household_id, person_id)
select distinct s.household_id, sp.person_id
from public.scout_parents sp
join public.scouts s on s.id = sp.scout_id
where s.household_id is not null and sp.person_id is not null
on conflict do nothing;

-- 6. Roles. Active scouts are youth members; is_person leaders that are NOT a
--    current scout's youth-leader code are adult leaders; MB counselors get
--    their own role. Parents deliberately receive NOTHING — that absence is
--    the whole point of the table.
-- Active scouts hold a current youth_member role; former scouts hold an ENDED
-- one. Giving inactive scouts no role at all would break the "absence of roles
-- means only-a-parent" rule this table is built on — 19 aged-out scouts would
-- be indistinguishable from 30 parents. The end date is not known (the source
-- records status, not when it changed), so it is stamped today and labelled as
-- approximate rather than silently presented as fact.
insert into public.person_roles (person_id, role, start_date)
select distinct s.person_id, 'youth_member', s.joined_date
from public.scouts s
where s.person_id is not null and s.active
on conflict do nothing;

-- `on conflict do nothing` cannot guard this insert: the partial unique index
-- person_roles_one_current only covers rows with a NULL end_date, and these all
-- carry one, so there is no conflict target to hit. A re-run would append a
-- second ended-role row per scout. Guarding on absence instead.
insert into public.person_roles (person_id, role, start_date, end_date, notes)
select distinct s.person_id, 'youth_member', s.joined_date, current_date,
       'End date approximate — set from inactive status at spine backfill, actual date unknown'
       || coalesce(' (' || nullif(trim(s.inactive_reason), '') || ')', '')
from public.scouts s
where s.person_id is not null and not s.active
  and not exists (
    select 1 from public.person_roles pr
    where pr.person_id = s.person_id and pr.role = 'youth_member'
  );

insert into public.person_roles (person_id, role)
select distinct l.person_id, 'adult_leader'
from public.leaders l
where l.person_id is not null
  and l.is_person
  and (l.scout_id is null or l.scout_id not in (select id from public.scouts where active))
on conflict do nothing;

insert into public.person_roles (person_id, role)
select distinct l.person_id, 'merit_badge_counselor'
from public.merit_badge_counselors mbc
join public.leaders l on l.code = mbc.leader_code
where l.person_id is not null
on conflict do nothing;

-- 7. parent_of edges, carrying the source wording verbatim. is_guardian is left
--    false for everyone: the current data does not distinguish custody, and
--    inventing that answer is worse than leaving it to be entered.
insert into public.relationships (person_id, related_person_id, type, source_label)
select distinct sp.person_id, s.person_id, 'parent_of', nullif(trim(sp.relationship), '')
from public.scout_parents sp
join public.scouts s on s.id = sp.scout_id
where sp.person_id is not null and s.person_id is not null and sp.person_id <> s.person_id
on conflict do nothing;

-- The correlation key has served its purpose; nothing outside this file may
-- depend on it.
drop index if exists public.people_backfill_key_idx;
alter table public.people drop column if exists _backfill_key;

-- ── Review queue for what exact-email matching could not resolve ───────────
-- Read-only. Surfaces same-human candidates WITHOUT acting on them, which is
-- the discipline this whole change is about: suggest, never auto-merge.
--
-- A "shared surname" rule was tried here first and REMOVED. It produced 73
-- candidates against 102 people, and its suggestions included merging Jack
-- Porter into his father Jason, and Anjali Sankpal-Tatera into her sister Maya.
-- A reviewer working a list that long would eventually accept one — collapsing
-- a child into a parent, which is a far worse outcome than the duplicate
-- listing this whole change exists to fix. A noisy suggester is not a neutral
-- cost; it manufactures the error it is meant to prevent.
--
-- What remains is deliberately narrow:
--   * exact_name / name_ignoring_spacing — the "JamieLynn" vs "Jamie Lynn" case
--   * nickname_prefix — one first name is a prefix of the other with a shared
--     surname ("Dan"/"Daniel", "Nate"/"Nathaniel"). Catches some nickname pairs,
--     and notably NOT "Mike"/"Michael", which no rule catches. That gap is
--     expected: this view narrows a human's work, it does not replace it.
--
-- Pairs already joined by a relationship edge are excluded outright — the data
-- states they are different humans, so they can never be merge candidates.
create or replace view public.person_merge_candidates as
select a.id as person_id, a.display_name as person_name,
       b.id as candidate_id, b.display_name as candidate_name,
       case
         when lower(trim(a.display_name)) = lower(trim(b.display_name)) then 'exact_name'
         when regexp_replace(lower(trim(a.display_name)), '[^a-z]', '', 'g')
            = regexp_replace(lower(trim(b.display_name)), '[^a-z]', '', 'g') then 'name_ignoring_spacing'
         else 'nickname_prefix'
       end as evidence
from public.people a
join public.people b
  on a.id < b.id
 and a.merged_into_person_id is null
 and b.merged_into_person_id is null
 and (
   regexp_replace(lower(trim(a.display_name)), '[^a-z]', '', 'g')
     = regexp_replace(lower(trim(b.display_name)), '[^a-z]', '', 'g')
   or (
     a.last_name is not null and trim(a.last_name) <> ''
     and lower(trim(a.last_name)) = lower(trim(b.last_name))
     and a.first_name is not null and b.first_name is not null
     and length(trim(a.first_name)) >= 3 and length(trim(b.first_name)) >= 3
     and lower(trim(a.first_name)) <> lower(trim(b.first_name))
     and (
       lower(trim(b.first_name)) like lower(trim(a.first_name)) || '%'
       or lower(trim(a.first_name)) like lower(trim(b.first_name)) || '%'
     )
   )
 )
 -- Known to be different people: parent/child, siblings, guardians.
 and not exists (
   select 1 from public.relationships r
   where (r.person_id = a.id and r.related_person_id = b.id)
      or (r.person_id = b.id and r.related_person_id = a.id)
 );
