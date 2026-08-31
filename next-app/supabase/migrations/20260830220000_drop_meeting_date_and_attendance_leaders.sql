-- Backlog soak item, executed on Patrick's direction 2026-08-30:
-- "Drop meetings.meeting_date and meeting_attendance_leaders."
--
-- meetings.meeting_date: the calendar unification (2026-08-14) made the
-- calendar entry the spine — the entry's own entry_date is the date, and
-- migration 20260814120000 (this column's last consumer) verified every
-- meeting links an entry on its own date before this drop. The one
-- remaining writer (createMeeting's insert) stops writing it in the same
-- commit; NOT NULL was relaxed on prod ahead of the code deploy so both
-- code versions insert cleanly during the rollout window.
--
-- meeting_attendance_leaders: legacy date-keyed leader check-ins (21 rows),
-- zero code references since Roll Call moved attendance to people. The
-- meeting_attendance_counts view joined it (also zero code references —
-- the attendance report counts from ledger_active directly) and goes with
-- it; named explicitly rather than CASCADE so nothing else can ride along.

alter table public.meetings drop column if exists meeting_date;
drop view if exists public.meeting_attendance_counts;
drop table if exists public.meeting_attendance_leaders;
