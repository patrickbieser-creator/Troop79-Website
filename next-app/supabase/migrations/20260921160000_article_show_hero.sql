-- Article Image Flexibility, step 1 (Plans/Article-Image-Flexibility.md, 2026-09-21).
--
-- "Show hero image at top of article." The hero keeps feeding the homepage
-- card thumbnail, og:image and JSON-LD whether or not it is displayed on the
-- article page itself — so hiding it is a flag beside hero_media_id, never a
-- reason to clear it (Jenna: Remove-only would silently kill the share
-- thumbnail for a volunteer author). Default true: no existing article
-- changes.
--
-- DEPLOY ORDER: DB-FIRST. The editor's save writes this column; code-first
-- would break every article save until the column landed (the v1.128.0
-- lesson, 2026-09-20).
alter table public.articles
  add column if not exists show_hero boolean not null default true;

-- articles_public / articles_archived are `select *` views (20260809010000).
-- Postgres expands `*` when the view is CREATED, so the new column is
-- invisible through them until the definition is replaced. `create or
-- replace` is allowed here because the column is appended at the end; it
-- keeps the views' grants. security_invoker is restated so the replace
-- cannot drop it (2026-08-25 security posture: every view is invoker).
create or replace view public.articles_public
  with (security_invoker = true) as
  select * from public.articles
  where status = 'published'
    and archived_at is null
    and (auto_archive_at is null or auto_archive_at > current_date);

create or replace view public.articles_archived
  with (security_invoker = true) as
  select * from public.articles
  where status = 'published'
    and (archived_at is not null or auto_archive_at <= current_date);
