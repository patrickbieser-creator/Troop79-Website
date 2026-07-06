-- News & Events CMS: media library, tag taxonomy, and articles (news/event/
-- recognition all share one table, distinguished by `type` — same "single
-- table, discriminator column" shape as ledger_entries). Event-specific
-- fields live directly on articles as nullable columns since only `event`
-- rows populate them; soft-hide via archived_at mirrors ledger_entries'
-- pattern rather than a hard delete.
--
-- RLS: open reads (matches every other reference/content table in this repo
-- so far); all writes go through Server Actions using the service-role
-- client, gated by the app-level ensureRole() check, not by RLS.

create table if not exists public.media (
  id bigserial primary key,
  bunny_path text not null,
  cdn_url text not null,
  alt_text text,
  caption text,
  uploaded_by text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table if not exists public.tags (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique
);

create table if not exists public.articles (
  id bigserial primary key,
  slug text not null unique,
  title text not null,
  type text not null check (type in ('news', 'event', 'recognition')),
  excerpt text,
  hero_media_id bigint references public.media(id) on delete set null,
  body text not null default '',

  status text not null default 'draft' check (status in ('draft', 'published')),
  author_name text not null,
  author_role text not null check (author_role in ('leader', 'scout')),
  published_at timestamptz,

  featured boolean not null default false,
  featured_order int,

  archived_at timestamptz,
  archived_by text,

  -- Only populated when type = 'event'.
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  event_registration_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists articles_status_published_idx
  on public.articles (status, published_at desc);
create index if not exists articles_type_event_start_idx
  on public.articles (type, event_start);
-- The common "what the public site shows" filter.
create index if not exists articles_public_idx
  on public.articles (published_at desc)
  where status = 'published' and archived_at is null;

create table if not exists public.article_tags (
  article_id bigint not null references public.articles(id) on delete cascade,
  tag_id bigint not null references public.tags(id) on delete cascade,
  primary key (article_id, tag_id)
);

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────

alter table public.media        enable row level security;
alter table public.tags         enable row level security;
alter table public.articles     enable row level security;
alter table public.article_tags enable row level security;

create policy media_read_all        on public.media        for select using (true);
create policy tags_read_all         on public.tags         for select using (true);
create policy articles_read_all     on public.articles     for select using (true);
create policy article_tags_read_all on public.article_tags for select using (true);

-- ─── HELPFUL VIEWS ──────────────────────────────────────────────────────────

-- What every public page queries: live, non-archived articles only.
create or replace view public.articles_public as
  select * from public.articles
  where status = 'published' and archived_at is null;

-- ─── SEED TAGS ──────────────────────────────────────────────────────────────

insert into public.tags (name, slug) values
  ('Advancement', 'advancement'),
  ('Camping', 'camping'),
  ('Service Project', 'service-project'),
  ('Fundraising', 'fundraising'),
  ('Court of Honor', 'court-of-honor'),
  ('Merit Badges', 'merit-badges'),
  ('Community', 'community'),
  ('High Adventure', 'high-adventure'),
  ('Meetings', 'meetings'),
  ('Recruiting', 'recruiting')
on conflict (name) do nothing;
