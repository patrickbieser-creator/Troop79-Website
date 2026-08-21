import Link from 'next/link';
import { loadAllTags, articleTypeLabel, formatDateLong } from '@/lib/news-feed';
import { loadMergedHomeFeed } from '@/lib/home-feed';
import { eventCardExcerpt } from '@/lib/feed-logic';
import { loadCalendarEntries, formatCalendarDateParts } from '@/lib/calendar';
import { FeedCard, catClass, entryHeroMedia, entryDateLine } from '../_components/feed-cards';
import { SectionDivider } from '../_components/section-divider';
import { EmptyState } from '../_components/empty-state';
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
          <EmptyState>No articles published yet — check back soon.</EmptyState>
        ) : (
          <>
            <div className={styles.heroLayout}>
              {hero.kind === 'article' ? (
                (() => {
                  const a = hero.article;
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
                  /*
                   * THE HERO PRINTS THE DESCRIPTION IN FULL (Patrick,
                   * 2026-08-15). Everywhere else an event summary is one line
                   * in a row of many and has to be cut to fit; the hero is a
                   * single story given the width of the page, so cutting it at
                   * 160 characters was rationing space that isn't scarce.
                   *
                   * Description first, card summary only as a fallback: the
                   * summary field exists to give SHORT surfaces something
                   * tighter than the description, which is the opposite of
                   * what this position wants.
                   */
                  const summary = e.description?.trim() || eventCardExcerpt(e);
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
                      {summary && <p className={styles.heroSummary}>{summary}</p>}
                      <Link href={`/events/${e.id}`} className={styles.readMore}>
                        Details &amp; Signup →
                      </Link>
                    </article>
                  );
                })()
              )}

              <aside className={styles.sidebar}>
                <div className={styles.sidebarModule}>
                  <h3 className={styles.sidebarModuleTitle}>Troop Calendar</h3>
                  {sidebarEvents.length === 0 ? (
                    <p className={styles.eventMeta}>Nothing on the calendar yet.</p>
                  ) : (
                    <ul className={styles.eventList}>
                      {sidebarEvents.map((ev) => {
                        const { month, day } = formatCalendarDateParts(ev.entry_date);
                        return (
                          /*
                           * The WHOLE item is the link — date block, title and
                           * location (Patrick, 2026-08-15). Only entries with a
                           * signup used to be clickable, and only on their
                           * title, so a meeting in this teaser led nowhere.
                           *
                           * Same stretched-link shape as the calendar list: one
                           * real <a> on the title supplies the accessible name,
                           * its ::after covers the row, and the rest is plain
                           * text under a transparent overlay — clickable
                           * without becoming a second tab stop.
                           */
                          <li key={ev.id} className={styles.eventItem}>
                            <div className={styles.eventDateBlock}>
                              <div className={styles.eMonth}>{month}</div>
                              <div className={styles.eDay}>{day}</div>
                            </div>
                            <div>
                              <p className={styles.eventTitle}>
                                <Link href={`/events/${ev.id}`} className={styles.stretchItem}>
                                  {ev.title}
                                </Link>
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
                <SectionDivider label="More This Week" />
                <div className={styles.storyGrid}>
                  {gridItems.map((item) => (
                    <FeedCard
                      key={item.kind === 'article' ? `a${item.article.id}` : `e${item.entry.id}`}
                      item={item}
                    />
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
