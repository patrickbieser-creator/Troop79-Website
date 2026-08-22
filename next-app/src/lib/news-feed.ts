import { createAdminClient } from '@/lib/supabase/server';
import { mustList } from '@/lib/db';
import type { Article, Media } from '@/lib/supabase/types';

const PAGE_SIZE = 10;

/** A category from the ONE taxonomy (calendar_categories) as news renders it
 *  (Patrick, 2026-08-21: "One taxonomy for both"). */
export interface NewsCategory {
  label: string;
  slug: string;
  color: string;
}

export interface ArticleCard extends Article {
  heroMedia: Media | null;
  /** The article's categories — the same vocabulary calendar entries use. */
  categories: NewsCategory[];
}

type RawArticleRow = Article & {
  hero_media: Media | null;
  article_categories: { calendar_categories: NewsCategory | null }[];
};

function toCard(row: RawArticleRow): ArticleCard {
  const { hero_media, article_categories, ...rest } = row;
  return {
    ...rest,
    heroMedia: hero_media,
    categories: (article_categories ?? [])
      .map((ac) => ac.calendar_categories)
      .filter((c): c is NewsCategory => !!c)
  };
}

const CARD_SELECT = '*, hero_media:hero_media_id(*), article_categories(calendar_categories(label, slug, color))';

/**
 * Articles for the homepage: page 1 carries EVERY featured article (the
 * curated set — order is applied by feed-logic orderFrontPage, not here) plus
 * the newest unfeatured page; pages 2+ are unfeatured articles only.
 */
export async function loadHomeArticles(page: number) {
  const supabase = createAdminClient();

  const [featuredRes, restCountRes] = await Promise.all([
    page === 1
      ? supabase.from('articles_public').select(CARD_SELECT).eq('featured', true)
      : Promise.resolve({ data: [] as RawArticleRow[] }),
    supabase.from('articles_public').select('id', { count: 'exact', head: true }).eq('featured', false)
  ]);
  const featured = ((featuredRes.data ?? []) as RawArticleRow[]).map(toCard);

  const from = (page - 1) * PAGE_SIZE;
  const { data: restData } = await supabase
    .from('articles_public')
    .select(CARD_SELECT)
    .eq('featured', false)
    .order('published_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const rest = ((restData ?? []) as RawArticleRow[]).map(toCard);

  const restCount = restCountRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(restCount / PAGE_SIZE));
  return { articles: [...featured, ...rest], totalPages, page, total: restCount + featured.length };
}

/* loadUpcomingEvents is GONE (Event→News promotion): it read event-ARTICLES,
   so the homepage sidebar only knew about events someone had hand-written a
   duplicate article for. The sidebar now reads the real calendar
   (loadCalendarEntries().upcoming). */

/**
 * The /news index ("News & Events"): a flat, paginated article list —
 * featured articles are NOT split out (that's homepage curation; here
 * everything reads chronologically). `archive` flips to the
 * articles_archived view (manual + auto-archived, still published) — the
 * public archive surface OMG has at /news?archive=1, ported.
 */
export async function loadNewsIndex(page: number, archive: boolean) {
  const supabase = createAdminClient();
  const view = archive ? 'articles_archived' : 'articles_public';
  const from = (page - 1) * PAGE_SIZE;
  const res = await supabase
    .from(view)
    .select(CARD_SELECT, { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const { count } = res;
  return {
    rows: mustList<RawArticleRow>(res, `news: ${archive ? 'archive' : 'index'} page ${page}`).map(toCard),
    totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))
  };
}

/** One entry of the "Browse by category" cloud — only categories that have
 *  something to show, with live counts (Patrick, 2026-08-21: "dynamically
 *  updated… news, event, and resources could all be tagged"). */
export interface CategoryCloudEntry extends NewsCategory {
  articles: number;
  events: number;
  resources: number;
}

export async function loadCategoryCloud(): Promise<CategoryCloudEntry[]> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const [cats, arts, evs, res] = await Promise.all([
    supabase.from('calendar_categories').select('label, slug, color, sort_order, behavior').order('sort_order'),
    supabase.from('article_categories').select('category_label, articles_public!inner(id)'),
    supabase
      .from('calendar_entries')
      .select('category')
      .eq('status', 'published')
      .gte('entry_date', today),
    supabase.from('library_resources').select('category_label').eq('status', 'published').not('category_label', 'is', null)
  ]);
  const count = (rows: { [k: string]: unknown }[] | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = String(r[key] ?? '');
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const a = count(arts.data as { category_label: string }[] | null, 'category_label');
  const e = count(evs.data as { category: string }[] | null, 'category');
  const r = count(res.data as { category_label: string }[] | null, 'category_label');
  // The two BEHAVIOR categories (the weekly meeting / a cancelled week) are
  // operational, not topics — a "No Meeting" browse page helps nobody.
  return ((cats.data ?? []) as (NewsCategory & { sort_order: number; behavior: string | null })[])
    .filter((c) => !c.behavior)
    .map((c) => ({
      label: c.label,
      slug: c.slug,
      color: c.color,
      articles: a.get(c.label) ?? 0,
      events: e.get(c.label) ?? 0,
      resources: r.get(c.label) ?? 0
    }))
    .filter((c) => c.articles + c.events + c.resources > 0);
}

export async function loadArticleBySlug(slug: string): Promise<ArticleCard | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('articles_public')
    .select(CARD_SELECT)
    .eq('slug', slug)
    .single();
  if (error || !data) return null;
  return toCard(data as RawArticleRow);
}

export interface CategoryEvent {
  id: number;
  title: string;
  entry_date: string;
  end_date: string | null;
  location: string | null;
  category: string;
}
export interface CategoryResource {
  id: number;
  title: string;
  blurb: string | null;
  kind: string;
  url: string | null;
}

/**
 * /tags/[slug] — a search-result view of one category across the whole site
 * (Patrick, 2026-08-21): upcoming and recent events, news articles (paged),
 * and resources (when they carry a category — none do yet, by design).
 */
export async function loadCategoryPage(slug: string, page: number) {
  const supabase = createAdminClient();
  const { data: category } = await supabase
    .from('calendar_categories')
    .select('label, slug, color')
    .eq('slug', slug)
    .maybeSingle();
  if (!category) return null;
  const cat = category as NewsCategory;
  const today = new Date().toISOString().slice(0, 10);

  const [linksRes, upcomingRes, pastRes, resourcesRes] = await Promise.all([
    supabase.from('article_categories').select('article_id').eq('category_label', cat.label),
    supabase
      .from('calendar_entries')
      .select('id, title, entry_date, end_date, location, category')
      .eq('status', 'published')
      .eq('category', cat.label)
      .gte('entry_date', today)
      .order('entry_date', { ascending: true })
      .limit(10),
    supabase
      .from('calendar_entries')
      .select('id, title, entry_date, end_date, location, category')
      .eq('status', 'published')
      .eq('category', cat.label)
      .lt('entry_date', today)
      .order('entry_date', { ascending: false })
      .limit(5),
    supabase
      .from('library_resources')
      .select('id, title, blurb, kind, url')
      .eq('status', 'published')
      .eq('visibility', 'public')
      .eq('category_label', cat.label)
      .order('title')
  ]);

  const articleIds = ((linksRes.data ?? []) as { article_id: number }[]).map((t) => t.article_id);
  let rows: ArticleCard[] = [];
  let totalPages = 1;
  if (articleIds.length > 0) {
    const from = (page - 1) * PAGE_SIZE;
    const res = await supabase
      .from('articles_public')
      .select(CARD_SELECT, { count: 'exact' })
      .in('id', articleIds)
      .order('published_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    rows = mustList<RawArticleRow>(res, `news: category page ${page}`).map(toCard);
    totalPages = Math.max(1, Math.ceil((res.count ?? 0) / PAGE_SIZE));
  }
  return {
    category: cat,
    rows,
    totalPages,
    upcoming: (upcomingRes.data ?? []) as CategoryEvent[],
    past: (pastRes.data ?? []) as CategoryEvent[],
    resources: (resourcesRes.data ?? []) as CategoryResource[]
  };
}
export function articleTypeLabel(type: Article['type']): string {
  if (type === 'news') return 'News';
  // Legacy 'event' rows may exist until the drop_legacy migration converts
  // them; label them as news rather than crashing or lying.
  if ((type as string) === 'event') return 'News';
  return 'Recognition';
}

const TIME_ZONE = 'America/Chicago';

export function formatEventDateParts(iso: string): { month: string; day: string } {
  const d = new Date(iso);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: TIME_ZONE }).format(d).toUpperCase();
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: TIME_ZONE }).format(d);
  return { month, day };
}

export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE
  }).format(new Date(iso));
}

export function formatEventDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE
  }).format(new Date(iso));
}
