'use client';

import { useUrlSearch } from '../../_components/use-url-search';
import styles from './articles.module.css';

interface Props {
  q: string;
  type: string;
  status: string;
  sort: string;
  dir: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' }
];

export function ArticlesToolbar({ q, status, sort, dir }: Props) {
  const { push, inputProps } = useUrlSearch({ path: '/admin/news/articles', q, resetPage: true });

  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        className={styles.input}
        placeholder="Search title, excerpt…"
        aria-label="Search articles"
        {...inputProps}
      />
      <select
        className={styles.select}
        aria-label="Filter by status"
        value={status}
        onChange={(e) => push({ status: e.target.value })}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {/* The "Show archived" checkbox lived here and MIXED archived posts into
          the list rather than switching to them. It is now a Current/Archived
          tab pair above, matching the Calendar's Upcoming/Past. */}
      <span className={styles.spacer} />
      <span className={styles.meta}>
        sorted by {sort} {dir === 'asc' ? '↑' : '↓'}
      </span>
    </div>
  );
}
