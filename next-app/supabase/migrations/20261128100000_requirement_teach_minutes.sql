-- Expected teaching time on every requirement (2026-10-20, Plans/Matcher-Tune-Up.md T-3).
--
-- Patrick: every requirement has a typical amount of time it takes to teach, and adults should know what's expected
-- of them. Every row starts at 15 minutes as a head start; Patrick edits them at Admin › Lookups › Req codes.
--
-- One source of truth: a requirement WITH sub-requirements (Tenderfoot 4a, First Aid) takes the sum of its parts
-- (lib/meeting-board-picklist teachMinutes); its own column is kept at the default and not shown. Rank and merit
-- badge requirements both carry it.
--
-- Additive only: two columns with defaults, no function change. DEPLOY ORDER: DB-first, then the code.

alter table public.rank_requirements
  add column if not exists teach_minutes smallint not null default 15
  constraint rank_requirements_teach_minutes_range check (teach_minutes between 1 and 240);

alter table public.merit_badge_requirements
  add column if not exists teach_minutes smallint not null default 15
  constraint merit_badge_requirements_teach_minutes_range check (teach_minutes between 1 and 240);
