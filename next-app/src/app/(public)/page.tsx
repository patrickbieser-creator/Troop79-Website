import Link from 'next/link';
import { loadAllTags, articleTypeLabel, formatDateLong } from '@/lib/news-feed';
import type { ArticleCard } from '@/lib/news-feed';
import { loadMergedHomeFeed, type FeedItem, type PromotedEntry } from '@/lib/home-feed';
import { eventCardExcerpt } from '@/lib/feed-logic';
import { loadCalendarEntries, formatCalendarDateParts } from '@/lib/calendar';
import type { Media } from '@/lib/supabase/types';
import styles from '../_components/news-cards.module.css';

/*
 * The homepage feed merges ARTICLES and PROMOTED CALENDAR ENTRIES
 * (Plans/Event-News-Promotion.md) — an event opts into these surfaces from
 * the calendar editor; nobody writes a duplicate article for it. Event cards
 * link to /events/[id], where the live signup is. The Upcoming Events
 * sidebar reads the real calendar (every category — Patrick, 2026-08-08),
 * replacing the old event-articles source that only knew about events
 * someone had hand-written an article for.
 */

function catClass(type: ArticleCard['type'] | 'event'): string {
  if (type === 'news') return styles.catNews;
  if (type === 'event') return styles.catEvents;
  return styles.catRecognition;
}

function articleOf(item: FeedItem & { kind: 'article' }): ArticleCard {
  return item.article as unknown as ArticleCard;
}

function entryHeroMedia(entry: PromotedEntry): Media | null {
  return (entry.hero_media as Media | null) ?? null;
}

/** Card date line for a promoted event: the event's own date, not a publish date. */
function entryDateLine(entry: PromotedEntry): string {
  return formatDateLong(`${entry.entry_date}T12:00:00`);
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);

  const [{ hero, gridItems, totalPages }, { upcoming }, tags] = await Promise.all([
    loadMergedHomeFeed(page),
    loadCalendarEntries(),
    loadAllTags()
  ]);
  const sidebarEvents = upcoming.slice(0, 5);

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
              {hero.kind === 'article' ? (
                (() => {
                  const a = articleOf(hero as FeedItem & { kind: 'article' });
                  return (
                    <article className={styles.heroStory}>
                      {a.heroMedia && (
                        <Link href={`/news/${a.slug}`} className={styles.storyImg}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.heroMedia.cdn_url} alt={a.heroMedia.alt_text ?? ''} />
                        </Link>
                      )}
                      <span className={`${styles.catTag} ${catClass(a.type)}`}>{articleTypeLabel(a.type)}</span>
                      <h2 className={styles.heroHeadline}>
                        <Link href={`/news/${a.slug}`}>{a.title}</Link>
                      </h2>
                      <p className={styles.storyByline}>
                        By <strong>{a.author_name}</strong> &nbsp;&middot;&nbsp;{' '}
                        {formatDateLong(a.published_at ?? a.created_at)}
                      </p>
                      {a.excerpt && <p className={styles.heroSummary}>{a.excerpt}</p>}
                      <Link href={`/news/${a.slug}`} className={styles.readMore}>
                        Read Full Story →
                      </Link>
                    </article>
                  );
                })()
              ) : (
                (() => {
                  const e = hero.entry;
                  const media = entryHeroMedia(e);
                  const excerpt = eventCardExcerpt(e);
                  return (
                    <article className={styles.heroStory}>
                      {media && (
                        <Link href={`/events/${e.id}`} className={styles.storyImg}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={media.cdn_url} alt={media.alt_text ?? ''} />
                        </Link>
                      )}
                      <span className={`${styles.catTag} ${catClass('event')}`}>{e.category}</span>
                      <h2 className={styles.heroHeadline}>
                        <Link href={`/events/${e.id}`}>{e.title}</Link>
                      </h2>
                      <p className={styles.storyByline}>{entryDateLine(e)}</p>
                      {excerpt && <p className={styles.heroSummary}>{excerpt}</p>}
                      <Link href={`/events/${e.id}`} className={styles.readMore}>
                        Details &amp; Signup →
                      </Link>
                    </article>
                  );
                })()
              )}

              <aside className={styles.sidebar}>
                <div className={styles.sidebarModule}>
                  <h3 className={styles.sidebarModuleTitle}>Upcoming Events</h3>
                  {sidebarEvents.length === 0 ? (
                    <p className={styles.eventMeta}>Nothing on the calendar yet.</p>
                  ) : (
                    <ul className={styles.eventList}>
                      {sidebarEvents.map((ev) => {
                        const { month, day } = formatCalendarDateParts(ev.entry_date);
                        return (
                          <li key={ev.id} className={styles.eventItem}>
                            <div className={styles.eventDateBlock}>
                              <div className={styles.eMonth}>{month}</div>
                              <div className={styles.eDay}>{day}</div>
                            </div>
                            <div>
                              <p className={styles.eventTitle}>
                                {ev.hasSignup ? (
                                  <Link href={`/events/${ev.id}`}>{ev.title}</Link>
                                ) : (
                                  ev.title
                                )}
                              </p>
                              {ev.location && <p className={styles.eventMeta}>{ev.location}</p>}
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
                  {gridItems.map((item) =>
                    item.kind === 'article' ? (
                      (() => {
                        const a = articleOf(item as FeedItem & { kind: 'article' });
                        return (
                          <Link key={`a${a.id}`} href={`/news/${a.slug}`} className={styles.storyCard}>
                            {a.heroMedia && (
                              <div className={styles.storyCardImg}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={a.heroMedia.cdn_url} alt={a.heroMedia.alt_text ?? ''} />
                              </div>
                            )}
                            <div className={styles.storyCardBody}>
                              <span className={`${styles.catTag} ${catClass(a.type)}`}>
                                {articleTypeLabel(a.type)}
                              </span>
                              <h3 className={styles.cardHeadline}>{a.title}</h3>
                              {a.excerpt && <p className={styles.cardSummary}>{a.excerpt}</p>}
                              <p className={styles.cardMeta}>{formatDateLong(a.published_at ?? a.created_at)}</p>
                            </div>
                          </Link>
                        );
                      })()
                    ) : (
                      (() => {
                        const e = item.entry;
                        const media = entryHeroMedia(e);
                        const excerpt = eventCardExcerpt(e);
                        return (
                          <Link key={`e${e.id}`} href={`/events/${e.id}`} className={styles.storyCard}>
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
                      })()
                    )
                  )}
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
