import Link from 'next/link';
import { Button } from '@/app/_components/button';
import { EmptyState } from '@/app/_components/empty-state';
import { TagFilter } from './tag-filter';
import controls from './news-controls.module.css';
import { loadNewsIndex, loadAllTags } from '@/lib/news-feed';
import { getIdentitySessionIfValid } from '@/lib/family-access';
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

  const [{ rows, totalPages }, tags, promoted, identity] = await Promise.all([
    loadNewsIndex(page, archive),
    loadAllTags(),
    !archive && page === 1 ? loadPromotedEntries() : Promise.resolve([]),
    getIdentitySessionIfValid()
  ]);

  // Same rule the submit page itself enforces: a VERIFIED person, adult or
  // scout. The troop password alone is not enough, because a story publishes
  // under the author's name.
  const canSubmit = identity !== null;

  const items: FeedItem[] = mergeFeed(rows, promoted);

  const pageHref = (n: number) => `/news?${archive ? 'archive=1&' : ''}page=${n}`;

  return (
    <>
      <div className={`${styles.sectionHeader} ${controls.headerRow}`}>
        <span className={styles.sectionLabel}>{archive ? 'News Archive' : 'News & Events'}</span>

        <span className={controls.headerControls}>
          {/* Filter and submit both sit on this line now, rather than a wall of
              tag pills stacked above the stories (Patrick, 2026-08-16). */}
          {tags.length > 0 && !archive && <TagFilter tags={tags} />}

          <Link href={archive ? '/news' : '/news?archive=1'} className={controls.archiveLink}>
            {archive ? '← Back to current news' : 'View archive →'}
          </Link>

          {/* Signed-in members only. The earlier version showed this to
              everyone on the theory that a scout who has never signed in would
              not otherwise discover it; Patrick's call is that a prominent
              button beats a discoverable-but-dead link, and a visitor who
              cannot submit should not be offered the option. */}
          {canSubmit && !archive && (
            <Button variant="primary" size="sm" href="/news/submit" className={controls.headerCta}>
              Submit a Story
            </Button>
          )}
        </span>
      </div>

      <main className={styles.mainContent}>

        {items.length === 0 ? (
          <EmptyState>
            {archive ? 'Nothing archived yet.' : 'No news published yet — check back soon.'}
          </EmptyState>
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
