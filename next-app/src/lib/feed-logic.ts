/**
 * Pure logic for the merged news feed (articles + promoted calendar entries)
 * — Plans/Event-News-Promotion.md, a port of OMG-Website's D-011 ("merge at
 * the feed, not the tables"). No Supabase/Next imports so it stays
 * unit-testable; the server loaders live in home-feed.ts.
 *
 * Generic over minimal base shapes rather than the concrete DB types, for
 * two reasons: the tests build small literals without dragging the whole
 * CalendarEntry row in, and callers keep their richer types (ArticleCard,
 * CalendarEntry & hero_media) through the merge without casts.
 *
 * Divergences from the OMG original, all deliberate:
 *  - No `active`/`is_recurring` checks — those columns don't exist here, and
 *    every calendar entry is dated, so a null promo_end means "through
 *    end_date ?? entry_date".
 *  - The hero used to be EVENT-WINS-WHILE-IN-WINDOW (Patrick, 2026-08-08);
 *    since 2026-08-21 the page follows an explicit FRONT-PAGE ORDER
 *    (orderFrontPage): the featured set — events and articles together — in
 *    the order the admin arranged, then everything else by date; the hero is
 *    simply the first card.
 */

export interface FeedArticleBase {
  id: number;
  published_at: string | null;
  created_at: string;
  /** Front-page curation (2026-08-21): featured + order = the curated slot. */
  featured: boolean;
  featured_order: number | null;
}

/** The promotion-relevant slice of a calendar_entries row. */
export interface PromotedEntryBase {
  id: number;
  entry_date: string;
  end_date: string | null;
  description: string | null;
  show_on_homepage: boolean;
  featured: boolean;
  featured_order: number | null;
  promo_start: string | null;
  promo_end: string | null;
  excerpt: string | null;
  auto_archive_at: string | null;
  created_at: string;
}

export type FeedItem<A extends FeedArticleBase, E extends PromotedEntryBase> =
  | { kind: 'article'; article: A }
  | { kind: 'event'; entry: E };

/** Parse a Postgres `date` string as a LOCAL calendar date — `new Date(iso)`
 *  would parse as UTC midnight and land a day early west of UTC (the same
 *  off-by-one OMG documented as D-009 and this repo dodges in
 *  date-picker-field's parseISO). */
function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local midnight of `d` — all window math runs at day granularity. */
function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * True once `dateStr` (auto_archive_at) is today or earlier — the row's first
 * hidden day. Mirrors the articles_public/articles_archived view predicate
 * (`auto_archive_at <= current_date`).
 */
export function isAutoArchivedOn(dateStr: string | null, today: Date): boolean {
  if (!dateStr) return false;
  return parseDateOnly(dateStr).getTime() <= dayStart(today);
}

/**
 * Is this calendar entry in the news surfaces today? Opt-in + not
 * auto-archived + inside the promo window. Null promo_end = through the
 * event's last day (end_date ?? entry_date).
 */
export function isPromoActive(entry: PromotedEntryBase, today: Date): boolean {
  if (!entry.show_on_homepage) return false;
  if (isAutoArchivedOn(entry.auto_archive_at, today)) return false;

  const todayMs = dayStart(today);
  if (entry.promo_start && parseDateOnly(entry.promo_start).getTime() > todayMs) return false;
  if (entry.promo_end) return parseDateOnly(entry.promo_end).getTime() >= todayMs;

  const lastDay = entry.end_date ?? entry.entry_date;
  return parseDateOnly(lastDay).getTime() >= todayMs;
}

/** Feed sort instant for an event card: promo_start day, else created_at. */
function entryFeedMs(entry: PromotedEntryBase): number {
  if (entry.promo_start) return parseDateOnly(entry.promo_start).getTime();
  return new Date(entry.created_at).getTime();
}

function feedItemMs(item: FeedItem<FeedArticleBase, PromotedEntryBase>): number {
  if (item.kind === 'article') {
    const a = item.article;
    return new Date(a.published_at ?? a.created_at).getTime();
  }
  return entryFeedMs(item.entry);
}

/** Articles + promoted entries as one feed, newest first. */
export function mergeFeed<A extends FeedArticleBase, E extends PromotedEntryBase>(
  articles: A[],
  entries: E[]
): FeedItem<A, E>[] {
  const items: FeedItem<A, E>[] = [
    ...articles.map((article) => ({ kind: 'article', article }) as FeedItem<A, E>),
    ...entries.map((entry) => ({ kind: 'event', entry }) as FeedItem<A, E>)
  ];
  return items.sort((x, y) => feedItemMs(y) - feedItemMs(x));
}

/**
 * The FRONT-PAGE ORDER (Patrick, 2026-08-21: "We clearly need a way to change
 * the display order of news on the home page"): the featured set — articles
 * AND promoted events together — comes first in featured_order (ordered ones
 * before unordered, then newest first), and everything else follows by date,
 * newest first. A featured event counts as featured only inside its promo
 * window; outside it, it's just a dated card (its flag is dormant, not wrong).
 * The admin News page's "Front page order" panel writes featured/featured_order;
 * this is the one place that reads them.
 */
export function orderFrontPage<A extends FeedArticleBase, E extends PromotedEntryBase>(
  articles: A[],
  entries: E[],
  today: Date
): FeedItem<A, E>[] {
  const items: FeedItem<A, E>[] = [
    ...articles.map((article) => ({ kind: 'article', article }) as FeedItem<A, E>),
    ...entries.map((entry) => ({ kind: 'event', entry }) as FeedItem<A, E>)
  ];
  const isFeatured = (it: FeedItem<A, E>) =>
    it.kind === 'article' ? it.article.featured : it.entry.featured && isPromoActive(it.entry, today);
  const orderOf = (it: FeedItem<A, E>) =>
    it.kind === 'article' ? it.article.featured_order : it.entry.featured_order;
  return items.sort((x, y) => {
    const fx = isFeatured(x);
    const fy = isFeatured(y);
    if (fx !== fy) return fx ? -1 : 1;
    if (fx && fy) {
      const ox = orderOf(x);
      const oy = orderOf(y);
      if (ox != null && oy != null && ox !== oy) return ox - oy;
      if (ox != null && oy == null) return -1;
      if (ox == null && oy != null) return 1;
    }
    return feedItemMs(y) - feedItemMs(x);
  });
}

/** Homepage hero = the first card of the front-page order (the top of the
 *  curated list when anything is featured; otherwise simply the newest). */
export function pickHero<A extends FeedArticleBase, E extends PromotedEntryBase>(
  items: FeedItem<A, E>[]
): FeedItem<A, E> | null {
  return items[0] ?? null;
}

/** Chip text for an article card: its first category from the ONE taxonomy
 *  (shared with calendar entries), or "News" when uncategorized — so article
 *  and event cards read the same way (Patrick, 2026-08-21). */
export function articleCategoryLabel(categories: readonly { label: string }[]): string {
  return categories[0]?.label ?? 'News';
}

const EXCERPT_MAX = 160;

/**
 * Any multi-line, possibly-marked-up text as one flat line, cut at a word
 * boundary. The `\s+` collapse is what makes it safe for single-line
 * surfaces — descriptions have been free-length since the admin field became
 * a textarea (2026-08-15), so newlines reach here routinely.
 *
 * Exported because a `<meta name="description">` needs exactly the same
 * treatment as a homepage card and for the same reason: both are one line of
 * summary, not the place to print the whole thing.
 */
export function plainSummary(text: string | null, max = EXCERPT_MAX): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const plain = trimmed
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/[*_`>#|]/g, '') // emphasis/quote/table chars
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  if (plain.length <= max) return plain;

  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`;
}

/**
 * Card summary for a promoted entry: the explicit excerpt, else the
 * description flattened to plain text and truncated at a word boundary.
 */
export function eventCardExcerpt(entry: PromotedEntryBase): string | null {
  if (entry.excerpt?.trim()) return entry.excerpt.trim();
  return plainSummary(entry.description);
}
