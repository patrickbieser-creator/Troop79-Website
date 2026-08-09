-- Event → News promotion, Migration B of two: drop the legacy event-article
-- machinery (Plans/Event-News-Promotion.md).
--
-- APPLY ONLY AFTER (a) the new code is live — old code joins through
-- calendar_entries.article_id and filters articles on event_start — and
-- (b) every live type='event' article has been promoted-or-archived by hand.
-- The guard below enforces (b) mechanically rather than trusting a checklist
-- (same guarded pattern as 20260720210000's NOT NULL migration): converting
-- a still-live future event-article would silently destroy the only record
-- of its start time and registration URL, since calendar_entries carries no
-- time column by design.

do $$
declare v_live int;
begin
  select count(*) into v_live
  from public.articles
  where type = 'event'
    and status = 'published'
    and archived_at is null
    and event_start is not null
    and event_start > now();
  if v_live > 0 then
    raise exception 'articles: % live future-dated type=''event'' article(s) remain — promote their calendar entries and archive them before dropping the event columns', v_live;
  end if;
end $$;

-- Views froze their column lists over the doomed columns (`select *`), and
-- Postgres refuses to drop columns a view depends on — so: drop, alter,
-- recreate. Same predicates as Migration A.
drop view if exists public.articles_public;
drop view if exists public.articles_archived;

-- Historical event-articles become plain news (their event_* data has been
-- superseded per row by the manual step above; past ones need no promotion).
update public.articles set type = 'news' where type = 'event';

alter table public.articles drop constraint if exists articles_type_check;
alter table public.articles
  add constraint articles_type_check check (type in ('news', 'recognition'));

alter table public.articles
  drop column if exists event_start,
  drop column if exists event_end,
  drop column if exists event_location,
  drop column if exists event_registration_url;

-- Promotion replaces the "read the full story" link (OMG decision 3).
alter table public.calendar_entries drop column if exists article_id;

create view public.articles_public as
  select * from public.articles
  where status = 'published'
    and archived_at is null
    and (auto_archive_at is null or auto_archive_at > current_date);

create view public.articles_archived as
  select * from public.articles
  where status = 'published'
    and (archived_at is not null or auto_archive_at <= current_date);
