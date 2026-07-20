-- Active / inactive for adults, and an honest "can this person be picked".
--
-- WHY (Patrick, 2026-07-20)
-- Scouts have had active + inactive_reason since the demographics work; adults
-- have not. Without it the signup picker accumulates every adult who has ever
-- been on record — the roster import alone added 42 — and within a couple of
-- years families scroll past people long gone to find themselves. Deleting
-- them is not an option: they are attached to ledger history, relationships,
-- and past events. They need to stop being OFFERED without stopping existing.
--
-- Deliberately separate from role. Ending someone's role moves them from
-- Leaders to Adults — they are still around, still a parent, still pickable.
-- Marking them inactive says they have left the troop's orbit entirely. A
-- committee member who steps down is the first; a family that moves away is
-- the second, and conflating them would hide parents who are simply not
-- currently helping out.

alter table public.people
  add column if not exists active boolean not null default true;

alter table public.people
  add column if not exists inactive_reason text;

create index if not exists people_active_idx on public.people (active);

-- A scout's activity still lives on `scouts` — that column drives the scout
-- tabs and the advancement screens, and duplicating it here would create two
-- answers to one question. people.active governs ADULTS.

-- CREATE OR REPLACE cannot rename or reorder a view's columns, and this drops
-- has_legacy_pointer in favour of in_picker. Nothing outside the Roster reads
-- the view yet, so dropping and recreating is safe.
drop view if exists public.person_directory;

create view public.person_directory as
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
  -- Whether this person is currently offered in the family signup picker.
  --
  -- This replaces has_legacy_pointer, which asked the wrong question: it tested
  -- for a scout_parents or leaders row, so people added by the roster import
  -- read "not in picker" no matter what a leader did to them. Assigning a
  -- household — which the screen explicitly told you to do — could not change
  -- the answer, because the answer was not about households. The picker now
  -- lists any active adult, so the honest test is simply whether they are
  -- active and not a currently-enrolled youth.
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
where p.merged_into_person_id is null;
