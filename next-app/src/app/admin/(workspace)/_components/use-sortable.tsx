'use client';

import { useMemo, useState } from 'react';
import styles from './use-sortable.module.css';

/*
 * Shared column sorting for admin tables (promoted from
 * advancement/roster/use-sortable.tsx, 2026-08-21 — the Section 2
 * consistency-sweep item). Client-side toggle sorting; finance's
 * URL-param-driven SortHeader is a different, server-sorted mechanism and
 * deliberately not this component.
 *
 * Deliberately not the windowing/search hook the Lookups tables used
 * (use-lookup-table.tsx): these tables show their whole dataset at once.
 */

export type SortDir = 'asc' | 'desc';

/**
 * Nulls always sort last, in BOTH directions. An empty cell means the
 * information is missing, not that it belongs at the low end of the range —
 * flipping to descending shouldn't fill the top of a roster with blanks.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  // numeric:true so "10th" sorts after "9th" and BSA ids compare sensibly.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * `getValue` must be defined OUTSIDE the calling component (module scope) —
 * a fresh closure each render would rebuild the sort on every keystroke
 * elsewhere on the page.
 */
export function useSortable<T, K extends string>(
  rows: T[],
  getValue: (row: T, key: K) => unknown,
  /** `null` = keep the input order until the user first clicks a header —
   *  for tables whose default order is deliberate (server order, compound
   *  grouping) and must survive adoption byte-for-byte. */
  initialKey: K | null,
  initialDir: SortDir = 'asc'
) {
  const [key, setKey] = useState<K | null>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(() => {
    if (key === null) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const r = compareValues(getValue(a, key), getValue(b, key));
      return dir === 'asc' ? r : -r;
    });
    return copy;
  }, [rows, key, dir, getValue]);

  function toggle(next: K) {
    if (next === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setKey(next);
      setDir('asc');
    }
  }

  return { sorted, sortKey: key, sortDir: dir, toggle };
}

/** A clickable column header. `aria-sort` is what a screen reader announces,
 *  so it carries the state rather than the arrow glyph alone. */
export function SortHeader<K extends string>({
  label,
  colKey,
  sortKey,
  sortDir,
  toggle,
  align
}: {
  label: string;
  colKey: K;
  sortKey: K | null;
  sortDir: SortDir;
  toggle: (k: K) => void;
  align?: 'right';
}) {
  const active = sortKey === colKey;
  return (
    <th
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? styles.alignRight : undefined}
    >
      <button type="button" className={styles.sortBtn} onClick={() => toggle(colKey)}>
        {label}
        <span className={active ? styles.sortArrow : styles.sortArrowIdle} aria-hidden="true">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
