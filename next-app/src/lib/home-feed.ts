/**
 * Server loaders for the merged news feed (articles + promoted calendar
 * entries) — Plans/Event-News-Promotion.md, port of OMG D-011. Pure
 * merge/window logic lives in feed-logic.ts (unit-tested); this file is just
 * the Supabase queries, mirroring news-feed.ts's patterns.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { CalendarEntry, Media } from '@/lib/supabase/types';
import {
  isPromoActive,
  mergeFeed,
  pickHero,
  type FeedItem as FeedItemG
} from '@/lib/feed-logic';
import { loadHomeFeed as loadArticleFeed, type ArticleCard } from '@/lib/news-feed';

/** A promoted calendar entry as the feed renders it: full row + hero image. */
export type PromotedEntry = CalendarEntry & { hero_media: Media | null };

export type FeedItem = FeedItemG<ArticleCard, PromotedEntry>;

/**
 * Every calendar entry currently opted into the news surfaces and inside its
 * promo window. The candidate set is a handful of rows (partial index on
 * show_on_homepage), so the window filter runs in unit-tested code.
 */
export async function loadPromotedEntries(today: Date = new Date()): Promise<PromotedEntry[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select('*, hero_media:hero_media_id(*)')
    .eq('status', 'published')
    .eq('show_on_homepage', true);
  return ((data ?? []) as unknown as PromotedEntry[]).filter((e) => isPromoActive(e, today));
}

export interface MergedHomeFeed {
  hero: FeedItem | null;
  gridItems: FeedItem[];
  totalPages: number;
  page: number;
}

/**
 * The homepage in one call. Articles keep their existing featured/pagination
 * behaviour (news-feed.ts); promoted events merge into PAGE 1 ONLY, exempt
 * from pagination counts — same rule OMG locked (decision 2, 2026-08-08).
 * Hero: a featured in-window promoted event WINS for its window (Patrick,
 * 2026-08-08 — diverges from OMG's recency rule); the featured article
 * resumes when the window closes.
 */
export async function loadMergedHomeFeed(page: number): Promise<MergedHomeFeed> {
  const today = new Date();
  const [{ hero: articleHero, gridItems: articleGrid, totalPages }, promoted] = await Promise.all([
    loadArticleFeed(page),
    page === 1 ? loadPromotedEntries(today) : Promise.resolve([] as PromotedEntry[])
  ]);

  const hero = pickHero<ArticleCard, PromotedEntry>(articleHero ?? null, promoted, today);

  // When an event takes the hero, the hero-apparent article stays in the
  // grid (it lost the slot, not its place on the page); when the article IS
  // the hero it leaves the grid, as before. Promoted entries not chosen as
  // hero merge into the grid by date.
  const heroEntryId = hero?.kind === 'event' ? hero.entry.id : undefined;
  const gridArticles: ArticleCard[] =
    hero?.kind === 'event' && articleHero ? [articleHero, ...articleGrid] : articleGrid;
  const gridEntries = promoted.filter((e) => e.id !== heroEntryId);

  return { hero, gridItems: mergeFeed(gridArticles, gridEntries), totalPages, page };
}
