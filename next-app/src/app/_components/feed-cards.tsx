import Link from 'next/link';
import { formatDateLong } from '@/lib/news-feed';
import type { ArticleCard } from '@/lib/news-feed';
import type { FeedItem, PromotedEntry } from '@/lib/home-feed';
import { articleCategoryLabel, eventCardExcerpt } from '@/lib/feed-logic';
import type { Media } from '@/lib/supabase/types';
import styles from './news-cards.module.css';

/**
 * The one grid-card renderer for merged-feed items (articles + promoted
 * calendar entries) — shared by the homepage grid and /news so the two
 * surfaces can't drift apart. Hero treatments stay page-local; only the
 * card is common.
 */

/** One chip style for every card — articles and events share the ONE
 *  taxonomy now (2026-08-21), so the chip means the same thing on both. The
 *  type argument is kept for the legacy 'recognition' rows only. */
export function catClass(type: ArticleCard['type'] | 'event'): string {
  if (type === 'recognition') return styles.catRecognition;
  return styles.catEvents;
}

export function entryHeroMedia(entry: PromotedEntry): Media | null {
  return (entry.hero_media as Media | null) ?? null;
}

/** Card date line for a promoted event: the event's own date, not a publish date. */
export function entryDateLine(entry: PromotedEntry): string {
  return formatDateLong(`${entry.entry_date}T12:00:00`);
}

export function FeedCard({ item }: { item: FeedItem }) {
  if (item.kind === 'article') {
    const a = item.article;
    return (
      <Link href={`/news/${a.slug}`} className={styles.storyCard}>
        {a.heroMedia && (
          <div className={styles.storyCardImg}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.heroMedia.cdn_url} alt={a.heroMedia.alt_text ?? ''} />
          </div>
        )}
        <div className={styles.storyCardBody}>
          <span className={`${styles.catTag} ${catClass(a.type)}`}>{articleCategoryLabel(a.categories)}</span>
          <h3 className={styles.cardHeadline}>{a.title}</h3>
          {a.excerpt && <p className={styles.cardSummary}>{a.excerpt}</p>}
          <p className={styles.cardMeta}>{formatDateLong(a.published_at ?? a.created_at)}</p>
        </div>
      </Link>
    );
  }

  const e = item.entry;
  const media = entryHeroMedia(e);
  const excerpt = eventCardExcerpt(e);
  return (
    <Link href={`/events/${e.id}`} className={styles.storyCard}>
      {media && (
        <div className={styles.storyCardImg}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.cdn_url} alt={media.alt_text ?? ''} />
        </div>
      )}
      <div className={styles.storyCardBody}>
        <span className={`${styles.catTag} ${catClass('event')}`}>{e.category}</span>
        <h3 className={styles.cardHeadline}>{e.title}</h3>
        {excerpt && <p className={styles.cardSummary}>{excerpt}</p>}
        <p className={styles.cardMeta}>{entryDateLine(e)}</p>
      </div>
    </Link>
  );
}
