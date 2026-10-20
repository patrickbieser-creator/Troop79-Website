-- Drop person_merge_candidate_detail (Patrick, 2026-10-20): an import-era view that
-- nothing reads since Roster Import and its staging tables were removed
-- (20261124100000). No view or function depends on it.

drop view if exists public.person_merge_candidate_detail;
