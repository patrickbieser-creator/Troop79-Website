-- Give adults' YPT completion, health form date, and "Things We Should Know"
-- a home on the people spine, so the Roster's person editor can actually
-- edit them again.
--
-- WHY (Patrick, 2026-08-17)
-- These three fields have lived on the legacy `leaders` table since
-- 2026-07-13 (`20260713000000_demographics.sql`, `20260721030000_things_we_should_know.sql`)
-- and were editable there through the old Lookups "Adults and Instructors"
-- card. That card moved to /admin/advancement/roster in v1.12 and the roster
-- was later rebuilt on the person-spine model (2026-07-20+) — the new
-- PersonEditor never grew a demographics section, so these three fields have
-- been silently unmanageable since the rebuild. Not a feature that was never
-- built: a real regression (Patrick's report, 2026-08-17).
--
-- `leaders.bsa_member_id` is NOT part of this migration — `people.bsa_member_id`
-- already exists (added at spine creation, `20260720100000_people_identity_spine.sql`)
-- and is already the sole thing every current write path (roster import,
-- person-actions.ts, change-requests) reads and writes. `leaders.bsa_member_id`
-- has been frozen/vestigial since 2026-07-20; nothing in this migration
-- touches it.
--
-- Backfilled from `leaders` via `person_id`, not left empty — production has
-- real data: 14 leaders carry a ypt_completed date (verified via direct
-- query before writing this migration). health_form_date and
-- things_we_should_know are both currently empty on `leaders` in production,
-- but the backfill covers them anyway for correctness if that ever changes
-- before this migration runs elsewhere (a fresh Docker reset, another
-- developer's machine).

alter table public.people add column if not exists ypt_completed date;
alter table public.people add column if not exists health_form_date date;
alter table public.people add column if not exists things_we_should_know text;

update public.people p
set ypt_completed = l.ypt_completed,
    health_form_date = l.health_form_date,
    things_we_should_know = l.things_we_should_know
from public.leaders l
where l.person_id = p.id
  and (
    l.ypt_completed is not null
    or l.health_form_date is not null
    or coalesce(nullif(trim(l.things_we_should_know), ''), '') <> ''
  );
