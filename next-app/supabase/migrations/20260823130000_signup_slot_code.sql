-- Job codes (Plans/Roster-Status-Tab.md, "job-heavy events" — Patrick,
-- 2026-08-22: "the rummage sale will have 20–30 jobs; we should come up with
-- a plan for how that's displayed on the roster").
--
-- The roster grid gets ONE narrow column per job, headed by a short code
-- ("SET", "CASH", "TRK") with the full label on hover, instead of the single
-- Jobs column that listed every claim as prose — unreadable at 20–30 jobs.
-- The code is optional and leader-set in the Builder; when it is NULL the
-- app derives one from the label (initials / consonant skeleton, made unique
-- per event — src/lib/job-codes.ts), so nothing needs a backfill and a
-- leader only types a code when the derived one reads badly.
--
-- Codes are 1–5 letters/digits and unique per event case-insensitively
-- (the app uppercases before writing; the index guards a direct writer).
-- Families never see codes — the family form keeps full labels.

alter table public.signup_slots
  add column if not exists code text
    check (code is null or code ~ '^[A-Za-z0-9]{1,5}$');

create unique index if not exists signup_slots_code_uniq
  on public.signup_slots (event_signup_id, upper(code))
  where code is not null;

comment on column public.signup_slots.code is
  'Short roster-column code (1–5 letters/digits, unique per event, case-insensitive). NULL = derived from the label by the app. Leader-facing only.';
