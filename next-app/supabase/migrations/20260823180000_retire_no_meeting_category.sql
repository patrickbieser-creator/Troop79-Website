-- Retire the "No Meeting" category (Patrick, 2026-08-23: "the category of
-- 'no meeting' is unnecessary and messy … simply have a 'troop meeting' with
-- the title 'no meeting'").
--
-- The category existed only to carry behavior = 'no_meeting', and every
-- consumer of that flag was cosmetic or already covered by the title:
--   · the public event page's "no meeting this week" card → the meeting
--     template's placeholder (now prints the entry's description generically);
--   · the admin Events/signups list hid such entries → they list like any
--     meeting (nothing to enable);
--   · the admin Meetings list hid them → one "No Troop Meeting" row per
--     holiday, no agenda, no roll — attendance % is unaffected because its
--     denominator is dates where roll was actually taken;
--   · the ICS feed never exported the category at all — consumers already saw
--     the title; a Troop Meeting titled "No Troop Meeting" sorts, filters and
--     feeds exactly like every other meeting.
--
-- Steps: (1) every entry (and album) still carrying the label moves to
-- 'Troop Meeting' — titles untouched ("No Troop Meeting" says it all);
-- (2) the lookup row loses its behavior (the delete-protect trigger refuses a
-- behavior-carrying row) and is deleted; (3) the behavior CHECK shrinks to the
-- one value the app still branches on. The code that dropped the no_meeting
-- branches ships first (same order as every tightening today).

-- ── 1. recategorize ──────────────────────────────────────────────────────
update public.calendar_entries set category = 'Troop Meeting'
where category = 'No Meeting';

update public.photo_albums set category = 'Troop Meeting'
where category = 'No Meeting';

-- ── 2. the lookup row ────────────────────────────────────────────────────
update public.calendar_categories set behavior = null where label = 'No Meeting';
delete from public.calendar_categories where label = 'No Meeting';

-- ── 3. one behavior left ─────────────────────────────────────────────────
alter table public.calendar_categories drop constraint if exists calendar_categories_behavior_check;
alter table public.calendar_categories
  add constraint calendar_categories_behavior_check check (behavior in ('meeting'));

comment on column public.calendar_categories.behavior is
  'Stable handle for the one category the app branches on: meeting (the weekly troop meeting the Meetings system publishes agendas for and Roll Call credits). A week with no meeting is a Troop Meeting titled "No Troop Meeting" (2026-08-23) — no category.';
