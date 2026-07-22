-- Official BSA requirement text, stored separately from rank_requirements /
-- merit_badge_requirements so neither existing table gains a column.
--
-- WHY (Operator, 2026-07-22)
-- Keyed by (source, parent_id, code) — the same stable natural key ledger_entries
-- and the Resource Library already use (`<parentId>-<code>` composite,
-- D-019/D-053 rename-cascade pattern) — NOT a foreign key to the bigserial
-- row id. updateMeritBadge() does a full delete-and-reinsert of
-- merit_badge_requirements on every save (fresh ids every time), so an
-- id-keyed FK with on-delete-cascade would silently wipe every badge's
-- official text on its very first catalog edit. Renaming a code already
-- cascades to ledger_entries and Resource Library (updateReqCode /
-- updateMeritBadge); this table joins that same cascade.
--
-- Holds verbatim official wording pasted in by a leader (see the
-- populate-mb-requirements skill's paste-driven pattern) — copyrighted BSA
-- text, not troop-authored data. RLS enabled with ZERO policies (the same
-- D-051 shape as change_requests / signup_entries): every reader/writer goes
-- through createAdminClient() (service role), and the app only ever renders
-- it behind hasFamilyAccess() (leader/scout/family session) — never on an
-- unauthenticated public page.

create table public.requirement_official_text (
  id bigserial primary key,
  source text not null check (source in ('rank', 'mb')),
  parent_id text not null,
  code text not null,
  official_text text not null,
  source_url text,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (source, parent_id, code)
);

alter table public.requirement_official_text enable row level security;
-- No policies — service-role only, matching change_requests / signup_entries.
