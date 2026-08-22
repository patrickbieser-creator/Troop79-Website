-- ONE taxonomy for events AND news + front-page ordering (Patrick, 2026-08-21:
-- "One taxonomy for both, please. And #1 for ordering.")
--
-- Before: calendar entries (and photo albums) pick a Calendar Category
-- (calendar_categories: label/color/sort_order/behavior); news articles carry
-- free "tags" (tags + article_tags). Two vocabularies, two Lookups cards, and
-- the home feed labelled event cards by category but article cards by a
-- vestigial type field — so a brand-new tag looked like it had hijacked a
-- card. After: calendar_categories IS the vocabulary for everything. News
-- articles join to it through article_categories (by label, rename-cascading
-- exactly like calendar_entries.category). tags/article_tags are gone.
--
-- Mapping of the 11 production tags → categories (exact, case-insensitive
-- matches merge; the obvious synonyms map; the rest become categories):
--   High Adventure   → High Adventure      (exact)
--   Service Project  → Service Project     (exact)
--   Fundraising      → Fundraiser
--   Camping          → Campout / Overnight
--   Recruiting       → Recruiting / Outreach
--   Court of Honor   → Ceremony / Recognition
--   Advancement      → Advancement Event
--   Meetings         → Troop Meeting
--   Community, Merit Badges, Scout News → NEW categories (gray, sort 200+)
-- Anything else that exists at migration time follows the same rules.
--
-- Front-page order: calendar_entries gains featured_order (articles already
-- had it). The ordered featured set — articles and promoted events together
-- — is the home page's curated order; the first is the hero; everything not
-- featured follows by date (src/lib/feed-logic.ts).

-- ── 1. Categories get a URL slug (stored generated column, always in sync
--       with the label, so a rename never leaves a stale slug) ──────────────
alter table public.calendar_categories
  add column if not exists slug text generated always as (
    nullif(btrim(lower(regexp_replace(label, '[^a-zA-Z0-9]+', '-', 'g')), '-'), '')
  ) stored;
create unique index if not exists calendar_categories_slug_key on public.calendar_categories (slug);

-- ── 2. article_categories — the news side of the one vocabulary ──────────
create table if not exists public.article_categories (
  article_id     bigint not null references public.articles(id) on delete cascade,
  category_label text   not null references public.calendar_categories(label)
                        on update cascade on delete restrict,
  primary key (article_id, category_label)
);
alter table public.article_categories enable row level security;
drop policy if exists article_categories_read_all on public.article_categories;
create policy article_categories_read_all on public.article_categories for select using (true);
comment on table public.article_categories is
  'News article ↔ category (the ONE taxonomy shared with calendar entries and photo albums). Replaces article_tags/tags (2026-08-21).';

-- ── 3. Migrate tags → categories ─────────────────────────────────────────
do $$
declare
  t record;
  target text;
  next_sort int;
begin
  if to_regclass('public.tags') is null then
    return;
  end if;

  select coalesce(max(sort_order), 0) + 10 into next_sort from public.calendar_categories;

  for t in select id, name from public.tags order by name loop
    -- exact, case-insensitive match first
    select label into target from public.calendar_categories where lower(label) = lower(t.name) limit 1;

    if target is null then
      target := case lower(t.name)
        when 'fundraising'    then 'Fundraiser'
        when 'camping'        then 'Campout / Overnight'
        when 'recruiting'     then 'Recruiting / Outreach'
        when 'court of honor' then 'Ceremony / Recognition'
        when 'advancement'    then 'Advancement Event'
        when 'meetings'       then 'Troop Meeting'
        else null
      end;
      -- the synonym target must actually exist; otherwise fall through
      if target is not null and not exists (select 1 from public.calendar_categories where label = target) then
        target := null;
      end if;
    end if;

    if target is null then
      -- brand-new category carrying the tag's name; neutral gray, sorted after
      -- the event kinds, and an 'announcement' template (it came from news,
      -- not from an activity — every category must carry a template).
      insert into public.calendar_categories (label, color, sort_order, behavior, template)
      values (t.name, '#6d7580', next_sort, null, 'announcement')
      on conflict (label) do nothing;
      target := t.name;
      next_sort := next_sort + 10;
    end if;

    insert into public.article_categories (article_id, category_label)
    select at.article_id, target from public.article_tags at where at.tag_id = t.id
    on conflict do nothing;
  end loop;
end $$;

drop table if exists public.article_tags;
drop table if exists public.tags;

-- ── 4. Front-page order for promoted calendar entries ────────────────────
alter table public.calendar_entries
  add column if not exists featured_order int;
comment on column public.calendar_entries.featured_order is
  'Position in the home page''s curated order (with articles.featured_order); null = not ordered. Only meaningful while featured.';
