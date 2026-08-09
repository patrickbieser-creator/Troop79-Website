-- Event → News promotion, Migration A of two (Plans/Event-News-Promotion.md;
-- port of OMG-Website D-011: merge at the FEED, not the tables).
--
-- ADDITIVE ONLY. The legacy drops (calendar_entries.article_id, the four
-- articles event_* columns, the type CHECK tightening) live in Migration B
-- (drop_legacy), applied only after the new code is live and the existing
-- type='event' articles have been promoted/archived by hand — live code
-- joins through article_id ('*, articles(slug)') and filters on event_start,
-- and the conversion would otherwise destroy event data before its
-- replacement exists (tech-lead review, 2026-08-08).

-- ── articles: date-based auto-archive ───────────────────────────────────────
alter table public.articles
  add column if not exists auto_archive_at date;

comment on column public.articles.auto_archive_at is
  'Article auto-archives once this date passes — enforced in the views below, no cron. current_date is UTC, so the flip lands ~6-7pm Central the prior evening (accepted, as at OMG).';

-- Explicit CREATE OR REPLACE is load-bearing: a `select *` view freezes its
-- column list at creation, so without this, auto_archive_at would exist on
-- the table but never appear through the view — the exact bug this repo
-- already documented once (D-038, ledger_active).
create or replace view public.articles_public as
  select * from public.articles
  where status = 'published'
    and archived_at is null
    and (auto_archive_at is null or auto_archive_at > current_date);

-- Archived-but-published articles — no public surface consumes this yet (the
-- homepage IS the news index here; OMG's /news?archive=1 toggle has no
-- equivalent), created now so the archive semantics live in one migration.
create or replace view public.articles_archived as
  select * from public.articles
  where status = 'published'
    and (archived_at is not null or auto_archive_at <= current_date);

-- ── calendar_entries: promotion fields ──────────────────────────────────────
-- An event opts into the news surfaces (homepage hero/grid) for a window —
-- no companion article, ever. Cards link to /events/[id], which carries the
-- live Event Signup. "Create either a news item or an event — never both."
alter table public.calendar_entries
  add column if not exists show_on_homepage boolean not null default false,
  add column if not exists featured boolean not null default false,
  add column if not exists promo_start date,
  add column if not exists promo_end date,
  add column if not exists excerpt text,
  add column if not exists hero_media_id bigint references public.media(id) on delete set null,
  add column if not exists auto_archive_at date;

comment on column public.calendar_entries.show_on_homepage is
  'Opt-in to the news surfaces for the promo window. promo_end null = through end_date ?? entry_date.';
comment on column public.calendar_entries.featured is
  'A featured, in-window promoted event takes the homepage hero for its window (event-wins rule, 2026-08-08).';
comment on column public.calendar_entries.auto_archive_at is
  'Once passed: hidden from public lists/feeds/ICS. /events/[id] stays reachable by direct link — event pages carry live signups whose links circulate.';

-- The promoted set is a handful of rows at any time; the window filter runs
-- in unit-tested code (feed-logic.ts), this index just keeps the candidate
-- scan off the full calendar.
create index if not exists calendar_entries_promoted_idx
  on public.calendar_entries (promo_start)
  where show_on_homepage = true;
