'use client';

/**
 * SearchField + useTableSearch — the one name search for in-memory lists
 * (Patrick, 2026-08-25: "add a search for name to every screen on roster.
 * Put it in the same place … a consistent pattern and reusable UX
 * component"; Jenna's pass).
 *
 * Two canons exist on purpose: server-listed screens (Calendar, News, Ledger)
 * keep their URL-debounced `q` so tab counts reflect the filter and the view
 * is linkable; small, already-fetched tables (the roster tabs, lookups) filter
 * instantly on the client. This is the client one. It sits in the table's
 * toolbar row — left of the spacer, after any sub-tab strip or count, before
 * the Add button — on every screen that has it.
 *
 *   const { q, setQ, visible } = useTableSearch(rows, (r) => [r.display_name]);
 *   <SearchField value={q} onChange={setQ} label="Search scouts" resultCount={visible.length} totalCount={rows.length} />
 */
import { useMemo, useState } from 'react';
import styles from './search-field.module.css';

/** Case-insensitive substring match over the fields the matcher returns. */
export function useTableSearch<T>(rows: T[], fields: (row: T) => (string | null | undefined)[]) {
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => fields(r).some((f) => (f ?? '').toLowerCase().includes(term)));
  }, [rows, q, fields]);
  return { q, setQ, visible };
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder = 'Search by name…',
  resultCount,
  totalCount,
  className
}: {
  value: string;
  onChange: (next: string) => void;
  /** The accessible name — say what is being searched ("Search scouts"). */
  label: string;
  placeholder?: string;
  /** With totalCount, shows "N of M" beside the field (announced politely). */
  resultCount?: number;
  totalCount?: number;
  className?: string;
}) {
  return (
    <span className={`${styles.wrap} ${className ?? ''}`}>
      <input
        type="search"
        className={styles.input}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Esc clears (browsers do this for type=search, but not all of them
          // fire change for it — do it ourselves so the list updates).
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
      />
      {resultCount !== undefined && totalCount !== undefined && (
        <span className={styles.count} aria-live="polite">
          {value.trim() ? `${resultCount} of ${totalCount}` : `${totalCount}`}
        </span>
      )}
    </span>
  );
}
