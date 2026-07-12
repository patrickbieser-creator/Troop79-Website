-- Public calendar: the full "everything on the calendar" list (Troop
-- Meetings, Committee Meetings, No-Meeting weeks, Campouts, Fundraisers,
-- etc.), distinct from both:
--   * articles (type='event') — the curated, written-up News CMS pieces
--     (Court of Honor recap, a big trip's story). Rich content, occasional.
--   * public.events — an unrelated ledger-classification lookup used only by
--     Fast Entry's Campout/Hike/Day Outing/Fundraiser dropdown; nothing to do
--     with the public calendar.
--
-- Self-contained by design: article_id is an OPTIONAL "read the full story"
-- link, not a sync source. A calendar_entries row keeps its own date/title
-- even when linked — no derived/synced fields from the article, so the
-- calendar stays simple to query (one table, no join-dependent branching).
--
-- No time-of-day column: matches the source data this replaces (the Bugle's
-- calendar sheet), which never stored per-entry times either — routine
-- categories like Troop Meeting have an institutionally-known time that
-- doesn't vary per row. Multi-day entries (a weekend Campout) use end_date.
--
-- RLS: open reads (matches every other reference/content table in this
-- repo); all writes go through Server Actions using the service-role
-- client, gated by the app-level ensureRole() check, not by RLS.

create table public.calendar_entries (
  id bigserial primary key,
  entry_date date not null,
  end_date date,
  day_note text,
  category text not null check (category in (
    'Troop Meeting', 'No Meeting', 'Campout', 'High Adventure', 'Summer Camp',
    'Service Project', 'Outing', 'Fundraiser', 'Court of Honor', 'Committee Meeting'
  )),
  title text not null,
  description text,
  location text,
  article_id bigint references public.articles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_entries_date_idx on public.calendar_entries (entry_date);

alter table public.calendar_entries enable row level security;
create policy calendar_entries_read_all on public.calendar_entries for select using (true);
