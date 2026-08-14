-- Calendar unification, step 1 of 3: additive only (Plans/Calendar-Unification.md).
--
-- WHY (Operator, 2026-08-14)
-- Three admin surfaces describe the same act — "something happens on a date":
-- Events (/admin/news/calendar), Event Signups (/admin/events) and Meetings
-- (/admin/advancement/meetings). Committee members entering content experience
-- them as three front doors to one job, and they are right: `meetings` has been
-- a parallel system keyed by `meeting_date` UNIQUE with NO foreign key to
-- calendar_entries. Creating a meeting never touched the calendar, so a meeting
-- entered on the Meetings screen was invisible to the calendar page, the
-- homepage sidebar, and /calendar.ics — Outlook and Band never saw it.
--
-- The only thing correlating the two systems was a matching date string,
-- resolved at read time in lib/meetings.ts getCalendarMeetingEntry(). Move a
-- date on one side and they split silently. This is the same double-entry
-- disease D-079 cured between events and articles; this is the third leg.
--
-- Two additive changes here, nothing destructive, safe to deploy ahead of code:
--
--   1. calendar_categories.template — the entry-time type. Patrick creates a
--      category in Lookups & Admin and picks a template; the admin editor
--      composes its panels from it and the public page picks its renderer from
--      it. Deliberately NOT a new column on calendar_entries: the category IS
--      the type, it is already FK'd with ON UPDATE CASCADE, and it is already
--      Patrick's to manage (D-082/D-085). A second discriminator would be a
--      second thing to keep in sync.
--
--      This extends D-085's own reasoning rather than reversing it. Categories
--      stay an OPEN set humans reason about; `template` is a CLOSED set the code
--      branches on, and the open set points at the closed one. Same split as
--      `behavior`, one level up.
--
--      Note `template` and `behavior` are independent: several categories may
--      share the 'meeting' TEMPLATE (a PLC or committee meeting has an agenda
--      too), while at most one may carry the 'meeting' BEHAVIOR (the weekly
--      troop meeting the Meetings system publishes for). Template is
--      presentation; behavior is identity.
--
--   2. meetings.calendar_entry_id — meetings become a LAYER on the calendar
--      spine, joined by a real FK, rather than being absorbed into it. Keeping
--      meetings.id alive is the whole point: 1,249 historical check-ins
--      (meeting_attendance / meeting_attendance_leaders), meeting_sessions, and
--      the 645-line Meeting Plan engine all keep their key and need no data
--      surgery. Layers-on-one-spine is the model already locked by D-081.
--
-- Nullable here on purpose; 20260814110000 backfills it and makes it NOT NULL.

-- ---------------------------------------------------------------------------
-- 1. Category templates
-- ---------------------------------------------------------------------------

alter table public.calendar_categories
  add column template text
  check (template in ('meeting', 'activity', 'announcement'));

comment on column public.calendar_categories.template is
  'Which editor panel set and public renderer this category uses. Closed set the code branches on: meeting (agenda + logistics), activity (story + signup), announcement (story only). Presentation and composition ONLY — a template never gates which layer tables may attach to an entry, so an entry can always grow. NULL falls back to activity in code, matching colorFor()''s posture. Distinct from `behavior`, which is identity and unique.';

-- Seeded to match how each category is actually used today. Anything ambiguous
-- goes to 'activity', the widest template (story + optional signup).
update public.calendar_categories set template = 'meeting'
  where label in ('Troop Meeting', 'Leadership / Planning');

-- A cancelled meeting week has no agenda and nothing to sign up for; it is a
-- notice. (Its 'no_meeting' BEHAVIOR still drives the meeting-week logic — the
-- template only decides that it renders as a notice rather than an agenda.)
update public.calendar_categories set template = 'announcement'
  where label = 'No Meeting';

update public.calendar_categories set template = 'activity'
  where template is null;

-- ---------------------------------------------------------------------------
-- 2. Meetings become a layer on calendar_entries
-- ---------------------------------------------------------------------------

alter table public.meetings
  add column calendar_entry_id bigint
  references public.calendar_entries (id) on delete cascade;

comment on column public.meetings.calendar_entry_id is
  'The calendar entry this meeting is the agenda layer of. ON DELETE CASCADE: the entry is the spine, the meeting is a layer on it, and deleting the entry takes its layers. Backfilled and made NOT NULL by 20260814110000.';

-- Child side of a FK that is joined on constantly (every meeting page load
-- resolves entry -> meeting).
create index meetings_calendar_entry_id_idx
  on public.meetings (calendar_entry_id);
