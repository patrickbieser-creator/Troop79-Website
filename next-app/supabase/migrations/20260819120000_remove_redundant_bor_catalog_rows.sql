-- Remove the redundant "BoR" catalog leaf on all 6 ranks that have a real
-- Board of Review (Patrick, 2026-08-19).
--
-- WHY IT EXISTED: 20260712040000_auto_rank_award_on_bor.sql built a
-- convenience mechanism — recording a `rank_requirement` ledger row coded
-- `<rank>-BoR` auto-creates the matching `rank_award` row, so a leader
-- wouldn't need "a second manual ledger entry." That trigger performs NO
-- leaf-satisfaction check at all (see its own header comment: idempotent,
-- one-way, no recursion — nothing about checking other requirements).
--
-- Separately, Fast Entry's picker ALSO synthesizes its own "Board of
-- Review" row (kind: 'rank_award', not tied to this catalog row at all —
-- see picker.tsx's rankAwardItem/showAward), gated by validateAwardRows()
-- in fast-entry/actions.ts, which DOES require every other requirement
-- satisfied first.
--
-- Net effect: two independent, differently-labeled "Board of Review" rows
-- rendered in the same picker (one at the top from RankPanel's showAward
-- block, one at the bottom as an ordinary tree leaf from this catalog row)
-- — and only one of them enforces "every requirement must be done first."
-- Checking the bottom (catalog) row was a complete side door around the
-- rule Patrick stated explicitly: "There's never a scenario where a
-- requirement is missing and a BoR is valid."
--
-- WHY DELETE RATHER THAN GATE IT TOO: the top row already IS the correct,
-- fully-gated mechanism. The bottom row is not a second legitimate way to
-- record a BoR — it's a leftover from before the top row existed. The
-- `bor-requirements` audit check (checks/bor-requirements.ts) already had to
-- hand-filter this exact row out of its own catalog read ("that's a display
-- artifact for the award itself, not a real requirement") — independent
-- confirmation this was never meant to be a real requirement leaf.
--
-- WHAT THIS DOES NOT TOUCH, and why it's safe (verified against real data
-- before writing this migration, not assumed):
--   * ledger_entries — 4 historical `rank_requirement` rows with a `-BoR`
--     code exist (scouts A02, A14, B11, D02). Every one of them ALREADY has
--     a real, correctly-dated `rank_award` row (the trigger fired
--     successfully at the time) — current_rank and every display that reads
--     it are completely independent of this catalog row and unaffected.
--     These 4 ledger rows become unreferenced by the catalog (no crash risk
--     — `ledger_entries.code` has no FK to rank_requirements) rather than
--     orphaned in any harmful sense; they simply stop being expected/shown
--     as a checklist item anywhere, which is correct — they were never a
--     real requirement to begin with.
--   * requirement_submissions — 1 row (scout A02, approved, linked to
--     ledger_entry_id 10683) references target_key 'second-class-BoR'.
--     Left in place as historical record. The admin Proof Queue's display
--     (library/page.tsx, resolveRequirementLabel) already falls back to a
--     raw "Rank req {key}" label when a catalog lookup misses — verified in
--     the source, not assumed — so this degrades gracefully, doesn't error.
--   * library_placements — checked, zero rows reference a `-BoR` target_key.
--     Nothing to clean up there.
--
-- requirement_official_text rows for these same (rank, 'BoR') keys ARE
-- deleted below, unlike the ledger/submission data above — that table is
-- pure admin-editable descriptive text with no historical/audit value of
-- its own (unlike a ledger entry or an approved family submission), and
-- once the catalog row is gone there is no UI path left to ever view, edit,
-- or delete it again. Leaving it would be silent dead data for no reason,
-- not a preserved record.

delete from public.requirement_official_text
 where source = 'rank'
   and code = 'BoR'
   and parent_id in ('tenderfoot', 'second-class', 'first-class', 'star', 'life', 'eagle');

delete from public.rank_requirements
 where code = 'BoR'
   and rank_id in ('tenderfoot', 'second-class', 'first-class', 'star', 'life', 'eagle');
