-- Who actually filed an "I did this" proof claim (Patrick, 2026-09-20).
--
-- `requirement_submissions` records WHOSE requirement a claim is about
-- (`scout_id`) and loosely HOW it arrived (`submitted_via` in
-- ('family','scout')), but never WHO pressed submit. A leader filing on a
-- scout's behalf is recorded only as a "Filed by …" line prepended to
-- `body_md` -- prose for a human reader, not an identity.
--
-- That is enough to review a claim and not enough to answer it. Telling a
-- submitter their claim was approved or sent back needs a real person, so:
-- the same `submitted_by_person_id` FK `change_requests` has carried since
-- 20260721040000.
--
-- Nullable, and left null for the claims already filed: the submitter of a
-- pre-migration row is genuinely unknown, and a notice is skipped rather
-- than guessed at. Do NOT backfill it by parsing the body_md attribution
-- line. Plan: Plans/Review-Notifications.md.
alter table public.requirement_submissions
  add column submitted_by_person_id bigint references public.people(id);

comment on column public.requirement_submissions.submitted_by_person_id is
  'The person who pressed submit -- the verified scout, the verified adult, '
  'or the leader filing by proxy. Null on claims filed before 2026-09-20 and '
  'on any claim whose submitter could not be resolved; a null means no '
  'review notice is sent, never a fallback to someone else.';

-- The review-notice lookup is always "this one claim's submitter", never a
-- scan by person, so no index: the FK is read via the row already in hand.
