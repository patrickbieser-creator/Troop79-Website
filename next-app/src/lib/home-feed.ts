/**
 * Server loaders for the merged news feed (articles + promoted calendar
 * entries) — Plans/Event-News-Promotion.md, port of OMG D-011. Pure
 * merge/window logic lives in feed-logic.ts (unit-tested); this file is just
 * the Supabase queries, mirroring news-feed.ts's patterns.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { mustList } from '@/lib/db';
import type { CalendarEntry, Media } from '@/lib/supabase/types';
import { isPromoActive, orderFrontPage, pickHero, type FeedItem as FeedItemG } from '@/lib/feed-logic';
import { loadHomeArticles, type ArticleCard } from '@/lib/news-feed';

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
  const res = await supabase
    .from('calendar_entries')
    .select('*, hero_media:hero_media_id(*)')
    .eq('status', 'published')
    .eq('show_on_homepage', true);
  return (mustList(res, 'homepage: promoted entries') as unknown as PromotedEntry[]).filter((e) =>
    isPromoActive(e, today)
  );
}

export interface MergedHomeFeed {
  hero: FeedItem | null;
  gridItems: FeedItem[];
  totalPages: number;
  page: number;
}

/**
 * The homepage in one call. Page 1 = the FRONT-PAGE ORDER (feed-logic
 * orderFrontPage): every featured article plus the in-window promoted events,
 * in the admin's arranged order, then the newest unfeatured articles; the
 * hero is the first card. Pages 2+ are the remaining articles by date
 * (events live on page 1 only, exempt from pagination — OMG decision 2).
 */
export async function loadMergedHomeFeed(page: number): Promise<MergedHomeFeed> {
  const today = new Date();
  const [{ articles, totalPages }, promoted] = await Promise.all([
    loadHomeArticles(page),
    page === 1 ? loadPromotedEntries(today) : Promise.resolve([] as PromotedEntry[])
  ]);
  const items = orderFrontPage<ArticleCard, PromotedEntry>(articles, promoted, today);
  const hero = pickHero(items);
  return { hero, gridItems: hero ? items.slice(1) : [], totalPages, page };
}
