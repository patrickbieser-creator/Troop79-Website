-- Menu Monster release C, last slice: drop mm_menus.free_items. The Phase 2
-- design's typed-in envelope never got a write path; release C reuses 4B's real
-- typed-in ingredients instead (Plans/Menu-Monster-Scout-Workspace.md,
-- "Release C design"). Verified empty in production 2026-10-03 (0 of 1 rows).
--
-- DEPLOY ORDER: CODE-FIRST. The release C code no longer selects the column;
-- push this only after that deploy is live, or the old code's select fails.

alter table public.mm_menus drop column if exists free_items;
