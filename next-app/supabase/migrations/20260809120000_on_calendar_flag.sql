-- Being an EVENT and being ON THE TROOP CALENDAR are two different facts
-- (Patrick, 2026-08-09 — the refinement to Plans/Event-News-Promotion.md's
-- one-spine model). A merit badge clinic run by another district has a date,
-- a time, and a location — and no business on the troop calendar. It still
-- gets an /events/[id] page and can promote itself into the news feed, where
-- the promo window's through-event-date default makes the announcement
-- expire by itself.
--
-- Deliberately NOT touched here: the category CHECK. New categories for the
-- off-calendar population ("Merit Badge Opportunity" and friends) arrive
-- with the calendar_categories LOOKUP TABLE (Patrick, 2026-08-09: no more
-- hardcoded category lists — see Plans/Event-News-Promotion.md follow-ups),
-- which replaces the CHECK entirely. Until then, off-calendar entries use
-- whichever existing category fits best.
alter table public.calendar_entries
  add column if not exists on_calendar boolean not null default true;

comment on column public.calendar_entries.on_calendar is
  'On the troop calendar/ICS/homepage-sidebar. Off = external opportunity: keeps its /events page and news-feed promotion, never appears in calendar surfaces.';
