'use client';

import { useUrlSearch } from '../../_components/use-url-search';
import styles from './ledger.module.css';

interface Props {
  q: string;
  kind: string;
  hidden: boolean;
  sort: string;
  dir: string;
}

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All ledger types' },
  { value: 'rank_requirement', label: 'Rank requirement' },
  { value: 'rank_award', label: 'Rank award' },
  { value: 'merit_badge_requirement', label: 'MB requirement' },
  { value: 'merit_badge_award', label: 'MB award' },
  { value: 'service_hours', label: 'Service hours' },
  { value: 'camping_nights', label: 'Campout' },
  { value: 'hiking_miles', label: 'Hike' },
  { value: 'day_outing', label: 'Day Outing' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'award', label: 'Other award' },
  { value: 'meeting_attendance', label: 'Meeting attendance' }
];

export function LedgerToolbar({ q, kind, hidden, sort, dir }: Props) {
  // Debounce + focused-input guard live in useUrlSearch (2026-08-26).
  const { push, inputProps } = useUrlSearch({ path: '/admin/advancement/ledger', q, resetPage: true });

  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        className={styles.input}
        placeholder="Search code, scout, label…"
        aria-label="Search ledger"
        {...inputProps}
      />
      <select
        className={styles.select}
        aria-label="Filter by ledger type"
        value={kind}
        onChange={(e) => push({ kind: e.target.value })}
      >
        {KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label className={styles.toggleLabel}>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => push({ hidden: e.target.checked ? '1' : null })}
        />
        Show hidden rows
      </label>
      <span className={styles.spacer} />
      <span className={styles.meta}>
        sorted by {sort} {dir === 'asc' ? '↑' : '↓'}
      </span>
    </div>
  );
}
