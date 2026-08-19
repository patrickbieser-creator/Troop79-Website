-- Rollback data for 20260819120000_remove_redundant_bor_catalog_rows.sql
-- Dumped directly from PRODUCTION (qyovupepjdxikyepieps) before the
-- migration ran, per Opus pre-deploy risk assessment #4 (2026-08-19) —
-- these are the only two rows this migration deletes that have no other
-- copy anywhere (ledger_entries and requirement_submissions rows
-- referencing the old codes are explicitly NOT touched by the migration
-- and remain in place; nothing to roll back there).
--
-- To restore: run this file directly against production.
-- Not expected to be needed — this is the safety net, not the plan.

-- rank_requirements (6 rows)
insert into public.rank_requirements
  (id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order)
values
  (513, 'eagle', null, 'BoR', 'Board of Review - Eagle', 'all', null, 6),
  (490, 'first-class', null, 'BoR', 'Board of Review - First Class', 'all', null, 37),
  (506, 'life', null, 'BoR', 'Board of Review - Life', 'all', null, 7),
  (445, 'second-class', null, 'BoR', 'Board of Review - Second Class', 'all', null, 36),
  (498, 'star', null, 'BoR', 'Board of Review - Star', 'all', null, 7),
  (401, 'tenderfoot', null, 'BoR', 'Board of Review - Tenderfoot', 'all', null, 26)
on conflict (id) do nothing;

-- requirement_official_text (6 rows)
insert into public.requirement_official_text
  (id, source, parent_id, code, official_text, source_url)
values
  (141, 'rank', 'eagle', 'BoR', 'Successfully complete your board of review for the Eagle Scout rank.', null),
  (101, 'rank', 'first-class', 'BoR', 'Successfully complete your board of review for the First Class rank.', null),
  (134, 'rank', 'life', 'BoR', 'Successfully complete your board of review for the Life rank.', null),
  (63, 'rank', 'second-class', 'BoR', 'Successfully complete your board of review for the Second Class rank.', null),
  (126, 'rank', 'star', 'BoR', 'Successfully complete your board of review for the Star rank.', null),
  (26, 'rank', 'tenderfoot', 'BoR', 'Successfully complete your board of review for the Tenderfoot rank.', null)
on conflict (id) do nothing;

-- Reference only — NOT deleted by the migration, NOT part of this rollback,
-- confirmed present in production at time of dump (2026-08-19):
--   ledger_entries: id 10683 (A02, second-class-BoR), 8095 (A14, star-BoR),
--     9451 (B11, second-class-BoR), 9465 (D02, tenderfoot-BoR)
--   requirement_submissions: id 2 (A02, second-class-BoR, approved)
