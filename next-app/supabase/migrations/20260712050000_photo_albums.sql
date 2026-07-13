-- Photo Albums: an index of the troop's public Google Photos albums
-- (Plans idea approved 2026-07-12; design validated in
-- prototypes/photo-albums/index.html).
--
-- Design notes:
--   * Albums live on Google Photos ("Gallery Link" pattern — the site links
--     out, never embeds). A row here is just the index card: title, date,
--     category, share URL, optional cover/description/count.
--   * `category` reuses the calendar_entries vocabulary verbatim — shared
--     taxonomy, no parallel lookup table (house decision: the kind/category
--     value alone carries classification).
--   * Cover images come from the existing Bunny-backed media library
--     (cover_media_id → media). Google-hosted image URLs aren't stable
--     long-term; one uploaded cover per album is cheap and reliable.
--     Null cover renders the monogram fallback tile.
--   * photo_count is leader-maintained and optional; shared albums grow, so
--     the page treats it as approximate.
--   * Everything in this table is inherently public (the albums themselves
--     are anyone-with-link), so RLS is open-read like other reference
--     tables. Writes go through leader-gated Server Actions.

create table public.photo_albums (
  id bigint generated always as identity primary key,
  title text not null,
  event_date date not null,
  category text not null check (category in (
    'Troop Meeting', 'No Meeting', 'Campout', 'High Adventure', 'Summer Camp',
    'Service Project', 'Outing', 'Fundraiser', 'Court of Honor', 'Committee Meeting', 'Ceremony'
  )),
  google_url text not null,
  cover_media_id bigint references public.media(id) on delete set null,
  description text,
  photo_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index photo_albums_event_date_idx on public.photo_albums (event_date desc);

alter table public.photo_albums enable row level security;
create policy photo_albums_read_all on public.photo_albums for select using (true);
