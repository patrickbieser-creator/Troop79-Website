-- Court of Honor report (Patrick, 2026-08-17) — a ceremony-oriented sibling
-- of advancement_reports: same content_json/content_md snapshot pattern,
-- but scoped to completed ranks + merit badges + special awards ONLY (no
-- individual requirements), filtered by the date each thing was actually
-- EARNED (not entered_at — a ceremony recognizes real accomplishment in
-- the period, regardless of when a leader got around to recording it;
-- confirmed with Patrick this is deliberately different from the Weekly
-- Report's entered-not-earned rule).
--
-- Deliberately a SEPARATE table from advancement_reports, not a `type`
-- column on it — different date semantics, different kind scope, and
-- different overlap-checking namespace (a COH's range shouldn't be checked
-- against Weekly Report ranges) made a shared polymorphic table more
-- confusing than two small tables, matching how this app already keeps
-- articles/calendar_entries/advancement_reports separate rather than one
-- polymorphic "content" table.
--
-- coh_history (pre-existing, legacy) stays untouched by this migration —
-- it's a lightweight hand-maintained summary log (title/date/counts) that
-- predates this feature and already feeds the Leader Dashboard's "COH
-- Candidates since {date}" stat. Publishing a court_of_honor_reports row
-- also upserts a summary row into coh_history going forward, so that
-- existing stat stays accurate without manual dual-entry — but the two
-- rows already in coh_history (real past ceremonies from before this
-- feature existed) are left exactly as they are.

create table if not exists court_of_honor_reports (
  id bigint generated always as identity primary key,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  content_json jsonb not null,
  content_md text not null,
  note text,
  generated_at timestamptz not null default now(),
  generated_by text,
  published_at timestamptz,
  published_by text,
  corrected_at timestamptz,
  corrected_by text,
  created_at timestamptz not null default now(),
  constraint court_of_honor_reports_date_range_chk check (start_date <= end_date)
);

create index if not exists court_of_honor_reports_status_idx on court_of_honor_reports (status);
create index if not exists court_of_honor_reports_end_date_idx on court_of_honor_reports (end_date desc);

alter table court_of_honor_reports enable row level security;
