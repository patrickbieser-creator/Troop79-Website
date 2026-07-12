-- Public-launch hardening: lock the anon key out of PII and drafts.
--
-- Context: every page in the app is server-rendered and (as of this change)
-- reads through the service-role client, which bypasses RLS. The anon key —
-- which ships to every browser via NEXT_PUBLIC_* — no longer needs to read
-- anything sensitive. These policies existed for dev convenience only.
--
-- Tables that KEEP anonymous read (harmless catalogs / already-scoped):
--   ranks, merit_badges, rank_requirements, merit_badge_requirements,
--   activity_types, events, service_projects, leadership_positions,
--   skills, leader_skills, scout_instructors, merit_badge_counselors,
--   media, tags, article_tags, calendar_entries,
--   meeting_plans (already published-only).

-- ── PII tables: no anonymous reads at all ─────────────────────────────────
-- scouts: addresses, phones, emails, health-form dates (minors!)
drop policy if exists ref_read_all on public.scouts;
-- scout_parents: parent names + contact info + addresses
drop policy if exists scout_parents_read_all on public.scout_parents;
-- leaders: adult contact info + health-form dates
drop policy if exists ref_read_all on public.leaders;

-- ── ledger + COH history: notes may contain free-text about scouts ────────
drop policy if exists ledger_read_all on public.ledger_entries;
drop policy if exists ref_read_all on public.coh_history;

-- ── articles: drafts were readable via the read-all policy ────────────────
drop policy if exists articles_read_all on public.articles;
create policy articles_read_published on public.articles
  for select using (status = 'published' and archived_at is null);

-- Note: `ledger_active` / `scout_summary` / `mb_progress` are owner-defined
-- views, so they still resolve for anon (Postgres definer semantics).
-- `scout_summary` and `mb_progress` expose aggregates/ids only.
-- `ledger_active` exposes ledger rows; the app doesn't read it as anon, but
-- to fully close it we set security_invoker so base-table RLS applies:
alter view public.ledger_active set (security_invoker = on);
