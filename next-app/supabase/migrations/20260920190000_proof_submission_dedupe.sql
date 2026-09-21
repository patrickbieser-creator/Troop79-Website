-- Duplicate "I did this" proof submissions (Patrick, 2026-09-20).
--
-- The public Resource Library's proof form let a scout write several
-- identical PENDING rows: the submit button stayed live while the action
-- uploaded media and sent an email, so a double-tap on a phone posted
-- twice. The live queue held Anjali x3 on `first-class-9a` and Henry x5 on
-- `first-class-7d`, each set inserted 0.6-1.0s apart.
--
-- `requirement_submissions_target_idx` (20260721100000) covers the same
-- three columns but is NOT unique, so nothing stopped it.
--
-- Two steps, in order: collapse the duplicates that already exist, then
-- make new ones impossible.

-- 1. Keep the OLDEST pending row per (scout, kind, key) and delete the
--    rest. Oldest wins because that is the submission the scout actually
--    meant to send; the extras are retries of it, carrying the same proof.
--    Only `pending` rows are touched -- a reviewed submission (approved or
--    returned) is a record of a leader's decision and is never deleted.
delete from public.requirement_submissions s
where s.status = 'pending'
  and exists (
    select 1
    from public.requirement_submissions keep
    where keep.status = 'pending'
      and keep.scout_id = s.scout_id
      and keep.target_kind = s.target_kind
      and keep.target_key = s.target_key
      and (keep.created_at, keep.id) < (s.created_at, s.id)
  );

-- 2. One pending submission per scout per requirement.
--
--    The predicate is deliberately exactly `status = 'pending'`: a returned
--    submission must be re-submittable, and a scout who redoes a
--    requirement after an approval must be able to claim it again. Widening
--    this predicate would block both. tests/proof-duplicate-submission.test.ts
--    asserts all three behaviours.
create unique index requirement_submissions_pending_unique
  on public.requirement_submissions (scout_id, target_kind, target_key)
  where status = 'pending';

comment on index public.requirement_submissions_pending_unique is
  'One pending proof claim per scout per requirement. Backstop for the '
  'double-tap the submit button and the action''s pre-insert check also '
  'guard -- neither closes the race on its own (two tabs, back-button '
  'resubmit, a tap landing before hydration).';
