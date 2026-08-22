-- Library resources join the one taxonomy (Patrick, 2026-08-21: "news,
-- event, and resources could all be tagged" — the category page becomes a
-- search-result view across all three). Optional: a resource may carry one
-- category; the Resource Library's own structure (rank/MB ledger codes)
-- is unchanged.
alter table public.library_resources
  add column if not exists category_label text
    references public.calendar_categories(label) on update cascade on delete set null;
create index if not exists library_resources_category_idx
  on public.library_resources (category_label) where category_label is not null;
comment on column public.library_resources.category_label is
  'Optional category from the ONE taxonomy (calendar_categories) — surfaces the resource on /tags/<slug> beside news and events.';
