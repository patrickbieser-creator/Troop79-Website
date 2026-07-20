-- Person directory: the single classification behind the Roster tabs.
--
-- WHY A VIEW (Patrick, 2026-07-20)
-- The Roster, the signup picker, and the login pool each need to answer "is
-- this person a scout or an adult, and what are they to the troop". Answering
-- it three times in three components is how the old model drifted. One
-- definition, in SQL, that every reader shares.
--
-- AGE-OUT IS NOT INACTIVITY. At 18 a scout is no longer a scout — full stop,
-- not "an inactive scout". They become an adult, and a Leader if they hold a
-- role. The scouts row stays as history, but it no longer makes them a youth
-- member. Conflating the two put a promoted 18-year-old under Inactive Scouts
-- and hid her from the Leaders list she actually belongs on.
--
-- Inactive Scouts therefore means a YOUTH who left — dropped out, moved away,
-- transferred. On production today that is 18 people, versus 1 who aged out.
-- 11 of those 18 have no birthdate on record, so age cannot be the only test;
-- an explicit aged_out reason has to count on its own.
--
-- TAB MEMBERSHIP IS DERIVED, NEVER STORED. Someone moves between Leaders and
-- Adults by gaining or ending a role, not by being reassigned. Relationships
-- and household membership are untouched by any of it — where a person is
-- SHOWN is a projection of their current role; who they are RELATED to is not.

create or replace view public.person_directory as
with scout_record as (
  select
    s.person_id,
    s.id as scout_id,
    s.active,
    nullif(trim(s.inactive_reason), '') as inactive_reason,
    s.birthdate,
    -- 18 ends youth membership regardless of what the scouts row says, and an
    -- explicit aged_out reason ends it even when no birthdate is recorded.
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
    -- Everyone below is an adult: no scout record at all, or a scout record
    -- that age has ended. A merit_badge_counselor-only person is deliberately
    -- an Adult, not a Leader — the "outside merit badge counselor" case.
    when coalesce(cr.holds_troop_role, false) then 'leader'
    else 'adult'
  end as tab,
  -- Whether this person can currently be written to signup_entries through the
  -- legacy identity columns. False for the people the roster import created,
  -- who hold no scout_parents or leaders row and are therefore unreachable in
  -- the picker until the submit RPC moves to person_id.
  (
    sr.scout_id is not null
    or exists (select 1 from public.scout_parents sp where sp.person_id = p.id)
    or exists (select 1 from public.leaders l where l.person_id = p.id and l.is_person)
  ) as has_legacy_pointer
from public.people p
left join scout_record sr on sr.person_id = p.id
left join troop_role cr on cr.person_id = p.id
where p.merged_into_person_id is null;
