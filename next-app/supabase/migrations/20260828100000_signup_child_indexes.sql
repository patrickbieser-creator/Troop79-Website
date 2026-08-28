-- Indexes the signup child tables were missing on the columns every roster,
-- workbench and snapshot read filters by (Plans/Performance-Review-2026-08-27.md
-- #13). Checked against production pg_indexes 2026-08-27: the other columns
-- named in the review were already covered by composite or unique indexes
-- whose leading column is the filter (signup_slots, event_prices,
-- signup_slot_claims, signup_group_sets, signup_group_members) and are not
-- repeated here. Additive; safe to apply before or after the code that
-- benefits.

create index if not exists signup_questions_signup_idx
  on public.signup_questions (event_signup_id);

-- signup_answers had only (signup_entry_id, question_id); the per-question
-- lookups (leader-only column checks, answer stats) walked it.
create index if not exists signup_answers_question_idx
  on public.signup_answers (question_id);

-- signup_groups had only partial indexes on set_id (driver / no-driver);
-- a plain "groups in this set" read matched neither predicate fully.
create index if not exists signup_groups_set_idx
  on public.signup_groups (set_id);

create index if not exists reimbursement_requests_entry_idx
  on public.reimbursement_requests (calendar_entry_id);
