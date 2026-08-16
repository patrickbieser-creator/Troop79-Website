-- Publishing is a filter, not a permission
-- (Plans/Unified-Identity-And-Capabilities.md, Patrick 2026-08-16).
--
-- WHY
-- Whether something is live is a property of the RECORD, not of the person who
-- created it. A scout proposes a news article from the public side; it saves
-- not-live; a leader flips it live from the admin — and can, because admin
-- access is itself the gate. Nothing about that needs a second capability.
--
-- This is not a new mechanism. It is the one this app already uses everywhere
-- except the two tables below:
--
--   change_requests       pending | approved | rejected      (D-055)
--   library_submissions   pending | published | archived     (20260721100000)
--   requirement proofs    pending | approved | returned      (20260721100000)
--   meeting_plans         draft | published, RLS hides drafts (20260711000000)
--
-- A family proposing a demographics change and a scout proposing a news story
-- are the same shape of act. These two tables are the odd ones out; this is
-- catching up, not inventing.

-- ── articles: gains 'pending' ───────────────────────────────────────────────
-- 'draft'     a leader's own work in progress
-- 'pending'   proposed from the public side, awaiting review
-- 'published' live
--
-- The public-side editor writes 'pending' and is structurally incapable of
-- writing anything else, so a forgotten permission check can at worst create
-- a row nobody sees. That is the whole security argument for doing review
-- this way rather than with a news.publish capability.
alter table public.articles drop constraint articles_status_check;
alter table public.articles
  add constraint articles_status_check
  check (status in ('pending', 'draft', 'published'));

-- ── calendar_entries: gains status ──────────────────────────────────────────
-- 'draft' | 'published' ONLY — deliberately NOT symmetrical with articles.
--
-- There is no public proposal surface for calendar entries and there will not
-- be one (Patrick, 2026-08-16): event suggestions arrive by email and Band,
-- and a web form for them would go unused. Adding 'pending' here would be a
-- state with no writer.
--
-- The state earns its place for a different reason: a leader can now stage an
-- entry — a campout with dates still moving, a fundraiser being negotiated —
-- without it appearing on the family-facing calendar. Today an entry is live
-- the instant it is saved.
--
-- Defaults to 'published' so every existing row and every current leader
-- workflow behaves exactly as it does now.
alter table public.calendar_entries
  add column if not exists status text not null default 'published'
  check (status in ('draft', 'published'));

-- DO NOT overload on_calendar to mean "approved" or "live".
-- on_calendar (20260809120000) is a DISPLAY filter — it is how a news-shaped
-- entry stays off the month grid while remaining a real, published entry (the
-- D-011 feed-merge work, v1.28–v1.30). The two axes are independent:
--
--                     status='published'                 status='draft'
--   on_calendar=true  normal event: grid, list, page     invisible everywhere
--   on_calendar=false news-shaped: feed + own page       invisible everywhere
--
-- The top-right cell is a normal case with real rows in it today. Collapsing
-- the axes would silently un-publish every one of them.

comment on column public.calendar_entries.status is
  'draft = staged by a leader, invisible on every public surface. published = live. '
  'Independent of on_calendar, which controls month-grid display only.';

-- Partial index for the common public read: published entries by date.
create index if not exists calendar_entries_published_date_idx
  on public.calendar_entries (entry_date)
  where status = 'published';

create index if not exists articles_pending_idx
  on public.articles (created_at desc)
  where status = 'pending';
