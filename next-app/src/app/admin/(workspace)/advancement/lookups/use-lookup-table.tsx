'use client';

/**
 * Shared row-windowing + search for Lookups tables.
 *
 * Collapsed card: 15 rows, with a "Show all N" text toggle.
 * Expanded card (LookupCardContext): every matching row, scrollable.
 * Search input renders automatically once a table crosses SEARCH_THRESHOLD
 * rows (50) — filters on the strings `searchText` extracts from a row.
 *
 * Usage in an editor:
 *   const t = useLookupTable(rows, (r) => `${r.name} ${r.code}`);
 *   ...
 *   {t.searchEl}
 *   <div className={t.scrollClass}><table>…{t.rows.map(...)}…</table></div>
 *   {t.footerEl}
 */

import { useMemo, useState } from 'react';
import { useLookupCard } from './lookup-card';
import styles from './lookups.module.css';

const COLLAPSED_ROWS = 15;
const SEARCH_THRESHOLD = 50;

export function useLookupTable<T>(all: T[], searchText: (row: T) => string) {
  const { expanded } = useLookupCard();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const searchable = all.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();

  const matching = useMemo(
    () => (searchable && q ? all.filter((r) => searchText(r).toLowerCase().includes(q)) : all),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchText is a render-stable lambda
    [all, q, searchable]
  );

  const unlimited = expanded || showAll || (searchable && q !== '');
  const rows = unlimited ? matching : matching.slice(0, COLLAPSED_ROWS);
  const hidden = matching.length - rows.length;

  const searchEl = searchable ? (
    <input
      type="search"
      className={styles.tableSearch}
      placeholder={`Search ${all.length} rows…`}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      aria-label="Search this table"
    />
  ) : null;

  const footerEl =
    hidden > 0 ? (
      <p className={styles.summary}>
        Showing {rows.length} of {matching.length}.{' '}
        <button type="button" className={styles.linkBtn} onClick={() => setShowAll(true)}>
          Show all
        </button>
      </p>
    ) : !expanded && showAll && matching.length > COLLAPSED_ROWS ? (
      <p className={styles.summary}>
        <button type="button" className={styles.linkBtn} onClick={() => setShowAll(false)}>
          Show first {COLLAPSED_ROWS} only
        </button>
      </p>
    ) : searchable && q ? (
      <p className={styles.summary}>
        {matching.length} match{matching.length === 1 ? '' : 'es'}.
      </p>
    ) : null;

  return {
    rows,
    searchEl,
    footerEl,
    /** Wrap the <table> in a div with this class — scrolls when unlimited. */
    scrollClass: unlimited ? styles.scrollWrap : ''
  };
}
