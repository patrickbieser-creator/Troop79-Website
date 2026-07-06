import Link from 'next/link';
import { loadHomeFeed, loadUpcomingEvents, loadAllTags, articleTypeLabel, formatEventDateParts, formatDateLong } from '@/lib/news-feed';
import type { ArticleCard } from '@/lib/news-feed';
import styles from '../_components/news-cards.module.css';

function catClass(type: ArticleCard['type']): string {
  if (type === 'news') return styles.catNews;
  if (type === 'event') return styles.catEvents;
  return styles.catRecognition;
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);

  const [{ hero, gridItems, totalPages }, upcomingEvents, tags] = await Promise.all([
    loadHomeFeed(page),
    loadUpcomingEvents(5),
    loadAllTags()
  ]);

  return (
    <>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>This Week in Troop 79</span>
        <span className={styles.sectionDate}>{formatDateLong(new Date().toISOString())}</span>
      </div>

      <main className={styles.mainContent}>
        {!hero ? (
          <p className={styles.empty}>No articles published yet — check back soon.</p>
        ) : (
          <>
            <div className={styles.heroLayout}>
              <article className={styles.heroStory}>
                {hero.heroMedia && (
                  <div className={styles.storyImg}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hero.heroMedia.cdn_url} alt={hero.heroMedia.alt_text ?? ''} />
                  </div>
                )}
                <span className={`${styles.catTag} ${catClass(hero.type)}`}>{articleTypeLabel(hero.type)}</span>
                <h2 className={styles.heroHeadline}>
                  <Link href={`/news/${hero.slug}`}>{hero.title}</Link>
                </h2>
                <p className={styles.storyByline}>
                  By <strong>{hero.author_name}</strong> &nbsp;&middot;&nbsp;{' '}
                  {formatDateLong(hero.published_at ?? hero.created_at)}
                </p>
                {hero.excerpt && <p className={styles.heroSummary}>{hero.excerpt}</p>}
                <Link href={`/news/${hero.slug}`} className={styles.readMore}>
                  Read Full Story →
                </Link>
              </article>

              <aside className={styles.sidebar}>
                <div className={styles.sidebarModule}>
                  <h3 className={styles.sidebarModuleTitle}>Upcoming Events</h3>
                  {upcomingEvents.length === 0 ? (
                    <p className={styles.eventMeta}>No upcoming events posted yet.</p>
                  ) : (
                    <ul className={styles.eventList}>
                      {upcomingEvents.map((ev) => {
                        const { month, day } = formatEventDateParts(ev.event_start!);
                        return (
                          <li key={ev.id} className={styles.eventItem}>
                            <div className={styles.eventDateBlock}>
                              <div className={styles.eMonth}>{month}</div>
                              <div className={styles.eDay}>{day}</div>
                            </div>
                            <div>
                              <p className={styles.eventTitle}>
                                <Link href={`/news/${ev.slug}`}>{ev.title}</Link>
                              </p>
                              {ev.event_location && <p className={styles.eventMeta}>{ev.event_location}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link href="/events" className={styles.viewAllLink}>
                    View all events →
                  </Link>
                </div>

                {tags.length > 0 && (
                  <div className={styles.sidebarModule}>
                    <h3 className={styles.sidebarModuleTitle}>Browse by Tag</h3>
                    <div className={styles.tagListSidebar}>
                      {tags.map((t) => (
                        <Link key={t.id} href={`/tags/${t.slug}`} className={styles.tagChipSidebar}>
                          {t.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>

            {gridItems.length > 0 && (
              <section aria-label="More stories">
                <div className={styles.sectionDivider}>
                  <span className={styles.divLabel}>More This Week</span>
                  <span className={styles.divRule} aria-hidden="true" />
                </div>
                <div className={styles.storyGrid}>
                  {gridItems.map((a) => (
                    <Link key={a.id} href={`/news/${a.slug}`} className={styles.storyCard}>
                      {a.heroMedia && (
                        <div className={styles.storyCardImg}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.heroMedia.cdn_url} alt={a.heroMedia.alt_text ?? ''} />
                        </div>
                      )}
                      <div className={styles.storyCardBody}>
                        <span className={`${styles.catTag} ${catClass(a.type)}`}>{articleTypeLabel(a.type)}</span>
                        <h3 className={styles.cardHeadline}>{a.title}</h3>
                        {a.excerpt && <p className={styles.cardSummary}>{a.excerpt}</p>}
                        <p className={styles.cardMeta}>{formatDateLong(a.published_at ?? a.created_at)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {totalPages > 1 && (
              <div className={styles.pager}>
                <Link
                  href={`/?page=${page - 1}`}
                  className={`${styles.pagerBtn} ${page <= 1 ? styles.pagerBtnDisabled : ''}`}
                  aria-disabled={page <= 1}
                >
                  ← Newer
                </Link>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Link
                  href={`/?page=${page + 1}`}
                  className={`${styles.pagerBtn} ${page >= totalPages ? styles.pagerBtnDisabled : ''}`}
                  aria-disabled={page >= totalPages}
                >
                  Older →
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
