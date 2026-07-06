import { createClient } from '@/lib/supabase/server';
import type { Article, Media, Tag } from '@/lib/supabase/types';

const PAGE_SIZE = 10;

export interface ArticleCard extends Article {
  heroMedia: Media | null;
  tags: Tag[];
}

type RawArticleRow = Article & {
  hero_media: Media | null;
  article_tags: { tags: Tag | null }[];
};

function toCard(row: RawArticleRow): ArticleCard {
  const { hero_media, article_tags, ...rest } = row;
  return {
    ...rest,
    heroMedia: hero_media,
    tags: (article_tags ?? []).map((at) => at.tags).filter((t): t is Tag => !!t)
  };
}

const CARD_SELECT = '*, hero_media:hero_media_id(*), article_tags(tags(*))';

export async function loadHomeFeed(page: number) {
  const supabase = await createClient();

  const [featuredRes, restCountRes] = await Promise.all([
    supabase
      .from('articles_public')
      .select(CARD_SELECT)
      .eq('featured', true)
      .order('featured_order', { ascending: true }),
    supabase.from('articles_public').select('id', { count: 'exact', head: true }).eq('featured', false)
  ]);
  const featured = ((featuredRes.data ?? []) as RawArticleRow[]).map(toCard);
  const featuredIds = new Set(featured.map((a) => a.id));

  const from = (page - 1) * PAGE_SIZE;
  const { data: restData } = await supabase
    .from('articles_public')
    .select(CARD_SELECT)
    .eq('featured', false)
    .order('published_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const rest = ((restData ?? []) as RawArticleRow[]).map(toCard);

  const combined = page === 1 ? [...featured, ...rest] : rest;
  const [hero, ...gridItems] = combined;
  const total = (restCountRes.count ?? 0) + (page === 1 ? featuredIds.size : 0);
  const totalPages = Math.max(1, Math.ceil((restCountRes.count ?? 0) / PAGE_SIZE));

  return { hero, gridItems, totalPages, page, total };
}

export async function loadUpcomingEvents(limit = 5) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('articles_public')
    .select('*')
    .eq('type', 'event')
    .gte('event_start', new Date().toISOString())
    .order('event_start', { ascending: true })
    .limit(limit);
  return (data ?? []) as Article[];
}

export async function loadAllTags() {
  const supabase = await createClient();
  const { data } = await supabase.from('tags').select('*').order('name');
  return (data ?? []) as Tag[];
}

export async function loadArticleBySlug(slug: string): Promise<ArticleCard | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles_public')
    .select(CARD_SELECT)
    .eq('slug', slug)
    .single();
  if (error || !data) return null;
  return toCard(data as RawArticleRow);
}

export async function loadArticlesByTag(slug: string, page: number) {
  const supabase = await createClient();
  const { data: tag } = await supabase.from('tags').select('*').eq('slug', slug).single();
  if (!tag) return { tag: null, rows: [] as ArticleCard[], totalPages: 1 };

  const { data: tagged } = await supabase.from('article_tags').select('article_id').eq('tag_id', tag.id);
  const articleIds = (tagged ?? []).map((t) => t.article_id);
  if (articleIds.length === 0) return { tag: tag as Tag, rows: [] as ArticleCard[], totalPages: 1 };

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await supabase
    .from('articles_public')
    .select(CARD_SELECT, { count: 'exact' })
    .in('id', articleIds)
    .order('published_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const rows = ((data ?? []) as RawArticleRow[]).map(toCard);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  return { tag: tag as Tag, rows, totalPages };
}

export async function loadEvents() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase
      .from('articles_public')
      .select(CARD_SELECT)
      .eq('type', 'event')
      .gte('event_start', nowIso)
      .order('event_start', { ascending: true }),
    supabase
      .from('articles_public')
      .select(CARD_SELECT)
      .eq('type', 'event')
      .lt('event_start', nowIso)
      .order('event_start', { ascending: false })
  ]);
  return {
    upcoming: ((upcoming ?? []) as RawArticleRow[]).map(toCard),
    past: ((past ?? []) as RawArticleRow[]).map(toCard)
  };
}

export function articleTypeLabel(type: Article['type']): string {
  if (type === 'news') return 'News';
  if (type === 'event') return 'Events';
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
