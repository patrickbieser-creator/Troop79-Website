-- Household membership for people placed by a declared relationship.
--
-- WHY (Patrick, 2026-07-20)
-- The spine backfill seeded household_members from the only membership fact
-- that existed at the time: scouts.household_id, plus the adults reachable
-- through those scouts' parent rows. The roster import then created ~43 people
-- who have neither — adults entered from the file, with a relationship recorded
-- by hand during review but no household row.
--
-- Without this, a parent who was just linked to their scout still renders as a
-- household of one, and picking them shows an empty family instead of the
-- household the picker exists to surface.
--
-- This is derivation from a DECLARED fact (a relationship a leader entered),
-- not from string similarity — the distinction that matters. And like D-030 it
-- runs once and produces stored rows a leader can correct, rather than an
-- inference re-run on every page load.

insert into public.household_members (household_id, person_id)
select distinct hm.household_id, orphan.id
from public.people orphan
join public.relationships r
  on (r.person_id = orphan.id or r.related_person_id = orphan.id)
join public.household_members hm
  on hm.person_id = case when r.person_id = orphan.id
                         then r.related_person_id
                         else r.person_id end
where orphan.merged_into_person_id is null
  -- Only place people who have no household at all. Someone already placed
  -- stays where a leader put them; this never moves anyone.
  and not exists (
    select 1 from public.household_members h2 where h2.person_id = orphan.id
  )
  -- Guardianship deliberately does NOT imply co-residence: a non-custodial
  -- parent is a guardian of a scout while living at another address, and
  -- placing them in the scout's household would erase exactly the distinction
  -- the relationships table was added to express. Only parent_of and
  -- sibling_of place someone.
  and r.type in ('parent_of', 'sibling_of')
on conflict do nothing;
