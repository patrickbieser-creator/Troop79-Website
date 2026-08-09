import Link from 'next/link';
import { loadNewsIndex, loadAllTags } from '@/lib/news-feed';
import { loadPromotedEntries, type FeedItem } from '@/lib/home-feed';
import { mergeFeed } from '@/lib/feed-logic';
import { FeedCard } from '../../_components/feed-cards';
import styles from '../../_components/news-cards.module.css';

/*
 * "News & Events" — the browsable index the homepage feed was standing in
 * for. Everything publishable that is NOT a troop calendar event lives here
 * as an article (external merit badge clinics, service project opportunities,
 * announcements), alongside promoted calendar events, exactly the shape
 * OMG's /news page has: flat chronological grid, tag chips, pagination, and
 * a public archive toggle (?archive=1 — the articles_archived view's first
 * consumer). Promoted events merge into page 1 of the live view only and are
 * exempt from tags/pagination counts (OMG decision 2, carried over).
 */

export const metadata = {
  title: 'News & Events — Troop 79',
  description: 'Troop 79 news, announcements, and upcoming opportunities.'
};

export default async function NewsIndexPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; archive?: string }>;
}) {
  const { page: pageRaw, archive: archiveRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
  const archive = archiveRaw === '1';

  const [{ rows, totalPages }, tags, promoted] = await Promise.all([
    loadNewsIndex(page, archive),
    loadAllTags(),
    !archive && page === 1 ? loadPromotedEntries() : Promise.resolve([])
  ]);

  const items: FeedItem[] = mergeFeed(rows, promoted);

  const pageHref = (n: number) => `/news?${archive ? 'archive=1&' : ''}page=${n}`;

  return (
    <>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>{archive ? 'News Archive' : 'News & Events'}</span>
        <Link href={archive ? '/news' : '/news?archive=1'} className={styles.viewAllLink}>
          {archive ? '← Back to current news' : 'View archive →'}
        </Link>
      </div>

      <main className={styles.mainContent}>
        {tags.length > 0 && !archive && (
          <div className={styles.tagListSidebar} style={{ marginBottom: 18 }}>
            {tags.map((t) => (
              <Link key={t.id} href={`/tags/${t.slug}`} className={styles.tagChipSidebar}>
                {t.name}
              </Link>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <p className={styles.empty}>
            {archive ? 'Nothing archived yet.' : 'No news published yet — check back soon.'}
          </p>
        ) : (
          <div className={styles.storyGrid}>
            {items.map((item) => (
              <FeedCard
                key={item.kind === 'article' ? `a${item.article.id}` : `e${item.entry.id}`}
                item={item}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className={styles.pager}>
            <Link
              href={pageHref(page - 1)}
              className={`${styles.pagerBtn} ${page <= 1 ? styles.pagerBtnDisabled : ''}`}
              aria-disabled={page <= 1}
            >
              ← Newer
            </Link>
            <span>
              Page {page} of {totalPages}
            </span>
            <Link
              href={pageHref(page + 1)}
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
