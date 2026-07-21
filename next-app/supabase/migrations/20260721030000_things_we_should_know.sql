-- "Things we should know" — freeform medical/allergy/special-needs notes.
--
-- WHY (Patrick, 2026-07-21)
-- D-014 (2026-07-13) deliberately stored no medical data, only a
-- health_form_date compliance date. This column reverses that clause: a
-- leader needs somewhere to note food allergies, medical conditions, and
-- special needs so a future event-attachment report can surface them for
-- both Scouts and adults attending. See DECISIONS.md for the entry
-- superseding D-014's "no medical data" clause.
--
-- Mirrors health_form_date's existing pattern: same column on both scouts
-- and leaders (not the people spine — domain-specific fields stay on the
-- legacy tables per D-042/D-043), no anon read policy on either table
-- (D-005), so this inherits the existing lockdown with no new RLS surface.
alter table public.scouts add column things_we_should_know text;
alter table public.leaders add column things_we_should_know text;
