-- Meeting Planner II rights (Plans/Meeting-Planner-II.md, Decision 2).
--
-- Three public-only rights for /planner: view (the whole board, read-only), edit (enter answers, assign, run Meeting
-- Live; the SPL holds it as a scout), seed (the planning team). They are deliberately NOT leader rights: the app's
-- "may enter /admin / is a leader" checks ignore them (lib/capabilities.ts holdsLeaderCapability), because View is
-- granted to parents and scouts one person at a time (Decision 3).
--
-- Additive: widens the check constraint and seeds the bootstrap admin, so it deploys before the code (D-404).

alter table public.person_capabilities drop constraint person_capabilities_capability_check;
alter table public.person_capabilities add constraint person_capabilities_capability_check
  check (capability in (
    'advancement.write',
    'roster.manage',
    'calendar.write',
    'news.write',
    'meeting_plan.use',
    'library.moderate',
    'library.proxy_view',
    'finance.manage',
    'finance.view',
    'meeting_planner.view',
    'meeting_planner.edit',
    'meeting_planner.seed'
  ));

-- Bootstrap: the library_superusers-derived admin who holds every other capability gets all three, the same query
-- 20260818200000_finance_core.sql used, so AtLeastOnePerson_HoldsEveryCapability_SoTheSystemIsNotBricked holds and
-- someone can grant the rest through /admin/access. Everyone else is granted by hand.
insert into public.person_capabilities (person_id, capability)
select l.person_id, c.capability
from public.library_superusers ls
join public.leaders l on l.code = ls.leader_code
cross join (values ('meeting_planner.view'), ('meeting_planner.edit'), ('meeting_planner.seed')) as c(capability)
where l.person_id is not null
on conflict do nothing;
