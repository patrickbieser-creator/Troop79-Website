/**
 * Current / Archived tabs for the News list.
 *
 * Replaces a "Show archived" checkbox that MIXED archived posts into the
 * current list rather than switching to them — so the only way to see the
 * archive was to also see everything else, and there was no way to look at just
 * what had been archived. Tabs say which set you are in, and give each a count.
 *
 * Deliberately the same shape as the Calendar's Upcoming/Past strip: same
 * markup, same class names, same counts-in-pills. Two list screens that behave
 * the same way should look the same.
 *
 * Server Component — list state lives in the URL on this screen (bookmarkable,
 * same convention as the ledger), so these are links, not buttons, and no
 * client JS is involved.
 */

import Link from 'next/link';
import styles from './articles.module.css';

interface Props {
  archived: boolean;
  currentCount: number;
  archivedCount: number;
  /** Current query string, so switching tabs keeps search and status. */
  hrefFor: (archived: boolean) => string;
}

export function ArticlesTabs({ archived, currentCount, archivedCount, hrefFor }: Props) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Post archive state">
      <Link
        href={hrefFor(false)}
        role="tab"
        aria-selected={!archived}
        className={`${styles.tab} ${!archived ? styles.tabOn : ''}`}
      >
        Current <span className={styles.tabCount}>{currentCount}</span>
      </Link>
      <Link
        href={hrefFor(true)}
        role="tab"
        aria-selected={archived}
        className={`${styles.tab} ${archived ? styles.tabOn : ''}`}
      >
        Archived <span className={styles.tabCount}>{archivedCount}</span>
      </Link>
    </div>
  );
}
