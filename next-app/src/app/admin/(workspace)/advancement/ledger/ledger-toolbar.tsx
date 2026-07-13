'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState(q);
  const [, startTransition] = useTransition();
  // True while the user is actively editing the search input. Disables the
  // URL→state resync (otherwise the server's lagging response clobbers
  // mid-flight keystrokes — the classic "every other letter disappears" bug).
  const inputFocusedRef = useRef(false);

  // Sync local state with URL only when the input is NOT focused. That
  // covers external navigation (browser back, pasted URL) without fighting
  // active typing.
  useEffect(() => {
    if (!inputFocusedRef.current) setText(q);
  }, [q]);

  function push(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    }
    params.delete('page'); // any filter change resets to page 1
    startTransition(() => {
      router.push(
        `/admin/advancement/ledger${params.toString() ? `?${params.toString()}` : ''}`
      );
    });
  }

  // Debounced search push. 450ms gives a comfortable buffer for round-trip
  // re-render before the next push fires.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => push({ q: text }), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        className={styles.input}
        placeholder="Search code, scout, label…"
        aria-label="Search ledger"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          inputFocusedRef.current = true;
        }}
        onBlur={() => {
          inputFocusedRef.current = false;
        }}
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
