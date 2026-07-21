-- Enable RLS on the 9 people-spine tables that shipped without it (B-001).
--
-- WHY (Operator, 2026-07-21)
-- The identity-spine migrations (20260720100000 onward) created
-- household_members, households, import_batches, import_rows,
-- merge_suggestions, people, person_roles, relationships, and
-- scout_parent_emails with RLS left disabled — a live gap found by the
-- Supabase advisor during today's signup migration work. With RLS off, the
-- anon key (shipped to every browser) has direct read/write on every
-- person's name, email, phone, household, and relationship data, bypassing
-- every app-level gate (family password, leader login).
--
-- ZERO policies, not a policy pass: every reader/writer of these 9 tables
-- goes exclusively through createAdminClient() (service role), confirmed by
-- grepping every call site in next-app/src before writing this migration —
-- no anon-key or per-user-session code path touches any of them. The
-- service-role key bypasses RLS regardless of policy count, so "enable RLS,
-- add no policies" blocks the anon key completely without changing any
-- existing app behavior. This is the same shape already used for
-- signup_entries, event_signups, and the rest of the Event Signup tables
-- (RLS enabled, no select policy, service-role only).

alter table public.household_members  enable row level security;
alter table public.households         enable row level security;
alter table public.import_batches     enable row level security;
alter table public.import_rows        enable row level security;
alter table public.merge_suggestions  enable row level security;
alter table public.people             enable row level security;
alter table public.person_roles       enable row level security;
alter table public.relationships      enable row level security;
alter table public.scout_parent_emails enable row level security;
