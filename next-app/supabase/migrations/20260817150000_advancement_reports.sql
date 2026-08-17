-- Weekly Advancement Report (Plans/Weekly-Advancement-Report.md) — a leader
-- generates a consolidated summary of what got signed off in a date range,
-- for the Bugle newsletter and a public page on the site.
--
-- content_json IS THE SOURCE OF TRUTH, content_md IS A DERIVED CACHE.
-- Revised from the plan's original "markdown is the single source" framing
-- during tech-lead review (2026-08-17): the prototype's scout-centric view
-- (`buildScoutView()`) regroups the STRUCTURED report object the
-- consolidation pass produces — it never parses markdown, and reconstructing
-- that structure by re-parsing rendered markdown text would be fragile in
-- exactly the way this plan elsewhere warns against. content_json stores the
-- structured object (the same shape `buildReport()` returns in the
-- prototype); content_md is regenerated from it on every save so the two can
-- never drift apart, and exists only so the Bugle export and the
-- category-view markdown render have something to consume without
-- recomputing structure on every read.
--
-- generated_by / published_by / corrected_by are plain text labels, NOT
-- people FKs — matches ledger_entries.entered_by / articles.author_name /
-- calendar_entries.author_name (attribution captured at write time from the
-- acting session), not the person_capabilities.granted_by pattern (that one
-- is a real FK because it's an authorization record, not an attribution
-- stamp — see that migration's own comment for why the two are different).
create table public.advancement_reports (
  id bigserial primary key,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),

  content_json jsonb not null,
  content_md text not null,

  -- An editor's note a leader can add above the report (e.g. "light week —
  -- most of the troop was traveling to Summer Camp"), same shape as the
  -- prototype's `meta.note`.
  note text,

  generated_at timestamptz not null default now(),
  generated_by text,

  published_at timestamptz,
  published_by text,

  corrected_at timestamptz,
  corrected_by text,

  created_at timestamptz not null default now(),

  constraint advancement_reports_range_valid check (start_date <= end_date)
);

create index on public.advancement_reports (status, end_date desc);
create index on public.advancement_reports (end_date desc) where status = 'published';

-- RLS zero-policy (D-051 pattern) — service-role only, every read/write in
-- this app goes through createAdminClient().
alter table public.advancement_reports enable row level security;

comment on table public.advancement_reports is
  'Weekly Advancement Report snapshots (Plans/Weekly-Advancement-Report.md). '
  'content_json is the source of truth; content_md is a derived cache, regenerated on every save.';
