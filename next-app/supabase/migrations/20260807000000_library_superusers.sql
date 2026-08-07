-- Resource Library superusers (Patrick, 2026-08-07).
--
-- WHY: selected adult leaders can view the public Resource Library as if
-- they were any active scout in the troop — a proxy view for support/UX
-- purposes (e.g. helping a family troubleshoot what they're seeing, or
-- checking the personalized experience without a real household login).
--
-- A NEW TABLE rather than a `leaders.library_superuser boolean` flag column,
-- per Patrick's explicit ask ("entered into another new table"). Keyed on
-- `leaders.code` (not a bigserial id) so it slots directly into the existing
-- LEADER_CODE_REFERRERS rename-cascade list in
-- admin/advancement/lookups/actions.ts alongside merit_badge_counselors,
-- leader_skills, and meeting_attendance_leaders (D-019) — renaming a
-- leader's initials must not silently orphan their superuser grant.
create table public.library_superusers (
  leader_code text primary key references public.leaders(code) on delete cascade,
  granted_at timestamptz not null default now(),
  -- Typed display name of the leader who granted it (session.leader — a
  -- label, not a code, same convention as ledger_entries.by/entered_by
  -- elsewhere in this app). Free text, not an FK — matches this project's
  -- existing audit-stamp pattern rather than adding a second reference.
  granted_by text
);

-- RLS enabled, zero policies — service-role only (D-051 pattern). The only
-- read path is resolveLibraryViewer() (lib/library-viewer.ts) via
-- createAdminClient(); the anon key gets nothing, same as every other
-- capability-list table in this project.
alter table public.library_superusers enable row level security;
