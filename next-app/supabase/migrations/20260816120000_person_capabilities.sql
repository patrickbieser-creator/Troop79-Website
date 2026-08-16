-- Unified Identity & Capabilities — Phase A
-- (Plans/Unified-Identity-And-Capabilities.md).
--
-- WHY (Patrick, 2026-08-16)
-- Today five mechanisms grant access across two identity spaces:
-- FAMILY_PASSWORD, LEADER_PASSWORD, SCOUT_PASSWORD, the identity cookie, and
-- the library_superusers table. A leader who is also a parent authenticates
-- twice to be the same human. This table is the single grant mechanism that
-- replaces all of it: a capability is a row keyed to a people.id, written by
-- a leader through an admin screen. Knowing a password grants nothing;
-- appearing in a particular table grants nothing.
--
-- Grants deliberately do NOT nest. A youth leader is not a weaker adult
-- leader; an advancement chair holds no news grants. Bundles exist only in
-- the UI (lib/capabilities.ts) and write flat rows — there is no bundle_id
-- here on purpose, so a bundle definition changing later can never silently
-- alter someone's access.
--
-- Ships DARK: nothing reads this table yet. Phase B switches /admin over.

-- ── the vocabulary ──────────────────────────────────────────────────────────
-- Deliberately small. Add a capability when a surface needs one, never
-- speculatively. Anything NOT here needs no grant at all — event signup,
-- editing your own household, submitting your own proof, proposing a news
-- article, and reading gated content all follow from being a verified person
-- in a household.
create table public.person_capabilities (
  person_id  bigint not null references public.people(id) on delete cascade,
  capability text   not null check (capability in (
    'advancement.write',   -- fast entry, ledger, roll call, BoR
    'roster.manage',       -- read AND edit contact info/demographics; approve change requests
    'calendar.write',      -- calendar entries, events, signup blocks
    'news.write',          -- edit any article and flip its status live/not-live
    'meeting_plan.use',    -- GENERATE and publish a plan (reading /meeting-plan is already public)
    'library.moderate',    -- approve/reject Library submissions and proofs
    'library.proxy_view'   -- view the Library as any active scout (was library_superusers)
  )),
  granted_at timestamptz not null default now(),
  -- A real FK, not a typed display label. This is the one audit stamp in the
  -- app that says who handed out access, so it should not be free text the
  -- way ledger_entries.entered_by is.
  granted_by bigint references public.people(id) on delete set null,
  primary key (person_id, capability)
);

create index person_capabilities_capability_idx
  on public.person_capabilities (capability);

alter table public.person_capabilities enable row level security;
-- Zero policies (D-051 pattern, same as login_tokens and library_superusers).
-- Every read goes through createAdminClient(); the anon key gets nothing.
-- An authorization table the anon key can enumerate is a map of who to phish.

-- ── person_authz — epoch and grants in ONE round trip ───────────────────────
-- isEpochCurrent() already costs a read on every privileged write
-- (lib/identity-session.ts's header explains why that spend is deliberate and
-- bounded). Folding the grant read into the same call keeps authorization
-- free relative to today's cost profile.
--
-- Two separate reads would double the per-write cost and tempt a caller to
-- cache the grants in the cookie — which is exactly the staleness that keeping
-- capabilities OUT of the token was meant to avoid. Callers must use this
-- function, not two queries.
create or replace function public.person_authz(p_person_id bigint)
returns table (session_epoch int, capabilities text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    p.session_epoch,
    coalesce(
      (select array_agg(pc.capability order by pc.capability)
         from public.person_capabilities pc
        where pc.person_id = p.id),
      '{}'::text[]
    )
  from public.people p
  where p.id = p_person_id;
$$;

revoke all on function public.person_authz(bigint) from public, anon, authenticated;

-- ── seed ────────────────────────────────────────────────────────────────────
-- Replicates lib/authorized-adults.ts's isAdultPerson() rule rather than
-- reading leaders.can_login directly.
--
-- THIS DISTINCTION IS LOAD-BEARING. can_login is true for 21 rows, including
-- non-person codes (Summer Camp, Turner Hall, Troop 118 — is_person = false)
-- and for at least one ACTIVE SCOUT who teaches (an older scout with a leader
-- code). Seeding from the flag alone would have granted a youth roster.manage
-- — every family's address, birthdates, and medical-adjacent notes. The
-- non-person rows self-exclude via person_id is null; the scout does NOT.
-- Guarded by NoActiveScout_HoldsAnyCapability_AfterSeed in
-- tests/capabilities.test.ts.
create temporary table _seed_adults on commit drop as
select distinct l.code, l.person_id
from public.leaders l
left join public.scouts s on s.id = l.scout_id
where l.can_login = true
  and l.is_person = true
  and l.person_id is not null
  and (l.scout_id is null or coalesce(s.active, false) = false);

-- Every eligible adult gets the working set they already exercise through
-- LEADER_PASSWORD today, MINUS the two heavy grants. roster.manage is
-- deliberately a short list (Patrick, 2026-08-16) and library.moderate
-- follows the Librarian bundle — both are assigned by name in the admin
-- screen, not guessed here.
insert into public.person_capabilities (person_id, capability)
select a.person_id, c.capability
from _seed_adults a
cross join (values
  ('advancement.write'),
  ('calendar.write'),
  ('news.write'),
  ('meeting_plan.use')
) as c(capability)
on conflict do nothing;

-- Bootstrap admin. Someone must hold every capability at seed time or the
-- grants screen itself is unreachable and the system is bricked — see
-- AtLeastOnePerson_HoldsEveryCapability_SoTheSystemIsNotBricked.
--
-- Identified as the existing library_superusers holder, which is the only
-- durable in-database signal of "this person already has elevated access"
-- (Patrick, sole superuser as of 2026-08-16 and ~95% of all admin activity).
insert into public.person_capabilities (person_id, capability)
select l.person_id, c.capability
from public.library_superusers ls
join public.leaders l on l.code = ls.leader_code
cross join (values
  ('advancement.write'),
  ('roster.manage'),
  ('calendar.write'),
  ('news.write'),
  ('meeting_plan.use'),
  ('library.moderate'),
  ('library.proxy_view')
) as c(capability)
where l.person_id is not null
on conflict do nothing;

-- library_superusers keeps its leaders.code key and stays in the schema for
-- now: it participates in the LEADER_CODE_REFERRERS rename cascade in
-- admin/advancement/lookups/actions.ts (D-019), so rekeying it to person_id
-- is its own change with its own regression risk. It is now a seed source,
-- not a live authorization read — resolveLibraryViewer() moves to
-- library.proxy_view in Phase B.

comment on table public.person_capabilities is
  'The single grant mechanism (Plans/Unified-Identity-And-Capabilities.md Phase A). '
  'One row per person per capability. Bundles live in lib/capabilities.ts and write flat rows here.';
comment on function public.person_authz(bigint) is
  'Session epoch + granted capabilities in one round trip. Callers must not split this into two queries.';
