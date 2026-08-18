-- Decouple "publish the report" from "confirm items were presented"
-- (Patrick, 2026-08-17): the first version wired publish to automatically
-- mark every item as presented, but Court of Honor ceremonies happen
-- outdoors and get rained out/rescheduled — publishing (finalizing the
-- report's content, useful for printing/prep ahead of the actual ceremony)
-- must never itself confirm that the ceremony happened. These columns
-- track a SEPARATE, explicit confirmation step on the report itself (mirrors
-- published_at/published_by), distinct from the per-item
-- ledger_entries.presented_at/presented_by that the confirmation action
-- actually stamps.

alter table court_of_honor_reports
  add column if not exists presented_at timestamptz,
  add column if not exists presented_by text;
