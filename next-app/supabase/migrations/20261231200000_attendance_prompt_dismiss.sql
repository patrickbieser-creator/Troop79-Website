-- "Would you like to update attendance?" can be dismissed (Patrick, 2026-10-29): No thanks hides the prompt for that
-- meeting, for every editor, and records nothing. Attendance stays recordable from Roll Call.
--
-- meeting_boards.attendance_dismissed_at / _by: when, and who (the actor's label, as Roll Call's recorded_by: no person
-- FK, so merge_people is untouched).
--
-- DEPLOY ORDER: DB-first (two nullable columns; production's code keeps working). Posture (D-051 / D-239) unchanged.

alter table public.meeting_boards add column if not exists attendance_dismissed_at timestamptz;
alter table public.meeting_boards add column if not exists attendance_dismissed_by text check (attendance_dismissed_by is null or char_length(attendance_dismissed_by) <= 200);
