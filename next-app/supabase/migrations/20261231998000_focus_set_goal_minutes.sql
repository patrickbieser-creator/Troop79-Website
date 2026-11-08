-- Station rotations step 1 (Plans/Planner-Station-Rotations.md): a focus set's teaching time goal in minutes, set
-- once and reused at every meeting. On a station night a round lasts as long as the longest station's goal.
--
-- DEPLOY ORDER: DB-first (one additive, nullable column). No date/timestamp column, so no _from_1900 CHECK.
-- Posture (D-051 / D-239): focus_sets already has RLS on and nothing granted to anon or authenticated.

alter table public.focus_sets
  add column if not exists goal_minutes smallint
    constraint focus_sets_goal_minutes_range check (goal_minutes between 5 and 240);

comment on column public.focus_sets.goal_minutes is
  'Teaching time goal in minutes (5–240), null = not set. A station night''s round = the longest station goal.';
