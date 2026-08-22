import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCategoryPage, formatDateLong } from '@/lib/news-feed';
import { articleCategoryLabel } from '@/lib/feed-logic';
import { formatCalendarDateParts } from '@/lib/calendar-shared';
import styles from '../../../_components/news-cards.module.css';
import local from '../tags.module.css';
import { EmptyState } from '@/app/_components/empty-state';
import { SectionDivider } from '@/app/_components/section-divider';

/**
 * /tags/[slug] — ONE category across the whole site (Patrick, 2026-08-21:
 * "offer a search result sort of experience since news, event, and resources
 * could all be tagged"). Events (upcoming, then recent), news (paged), and
 * resources when any carry the category (none yet — by design; the column
 * is ready). The category is the same row calendar entries use.
 */
export default async function CategoryPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);

  const data = await loadCategoryPage(slug, page);
  if (!data) notFound();
  const { category, rows, totalPages, upcoming, past, resources } = data;
  const empty = rows.length === 0 && upcoming.length === 0 && past.length === 0 && resources.length === 0;

  return (
    <>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>Category: {category.label}</span>
        <Link href="/news" className={local.backLink}>
          ← All news &amp; events
        </Link>
      </div>
      <main className={styles.mainContent}>
        {empty && <EmptyState>Nothing in &ldquo;{category.label}&rdquo; yet.</EmptyState>}

        {(upcoming.length > 0 || past.length > 0) && (
          <section aria-label="Events">
            <SectionDivider label={upcoming.length > 0 ? 'Upcoming events' : 'Recent events'} />
            <ul className={local.eventList}>
              {[...upcoming, ...past].map((ev) => {
                const { month, day } = formatCalendarDateParts(ev.entry_date);
                return (
                  <li key={ev.id} className={local.eventItem}>
                    <div className={local.eventDate}>
                      <span className={local.eMonth}>{month}</span>
                      <span className={local.eDay}>{day}</span>
                    </div>
                    <div>
                      <Link href={`/events/${ev.id}`} className={local.eventTitle}>
                        {ev.title}
                      </Link>
                      {ev.location && <p className={local.eventMeta}>{ev.location}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {rows.length > 0 && (
          <section aria-label="News">
            <SectionDivider label="News" />
            <div className={`${styles.storyGrid} ${local.gridGapTop}`}>
              {rows.map((a) => (
                <Link key={a.id} href={`/news/${a.slug}`} className={styles.storyCard}>
                  {a.heroMedia && (
                    <div className={styles.storyCardImg}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.heroMedia.cdn_url} alt={a.heroMedia.alt_text ?? ''} />
                    </div>
                  )}
                  <div className={styles.storyCardBody}>
                    <span className={`${styles.catTag} ${styles.catEvents}`}>{articleCategoryLabel(a.categories)}</span>
                    <h3 className={styles.cardHeadline}>{a.title}</h3>
                    {a.excerpt && <p className={styles.cardSummary}>{a.excerpt}</p>}
                    <p className={styles.cardMeta}>{formatDateLong(a.published_at ?? a.created_at)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {resources.length > 0 && (
          <section aria-label="Resources">
            <SectionDivider label="Resources" />
            <ul className={local.resourceList}>
              {resources.map((r) => (
                <li key={r.id}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      {r.title}
                    </a>
                  ) : (
                    <Link href="/library">{r.title}</Link>
                  )}
                  {r.blurb && <span className={local.resourceBlurb}> — {r.blurb}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {totalPages > 1 && (
          <div className={styles.pager}>
            <Link
              href={`/tags/${slug}?page=${page - 1}`}
              className={`${styles.pagerBtn} ${page <= 1 ? styles.pagerBtnDisabled : ''}`}
              aria-disabled={page <= 1}
            >
              ← Newer
            </Link>
            <span>
              Page {page} of {totalPages}
            </span>
            <Link
              href={`/tags/${slug}?page=${page + 1}`}
              className={`${styles.pagerBtn} ${page >= totalPages ? styles.pagerBtnDisabled : ''}`}
              aria-disabled={page >= totalPages}
            >
              Older →
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
