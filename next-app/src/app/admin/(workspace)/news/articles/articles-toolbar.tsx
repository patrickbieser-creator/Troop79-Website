'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState(q);
  const [, startTransition] = useTransition();
  const inputFocusedRef = useRef(false);

  useEffect(() => {
    if (!inputFocusedRef.current) setText(q);
  }, [q]);

  function push(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    }
    params.delete('page');
    startTransition(() => {
      router.push(`/admin/news/articles${params.toString() ? `?${params.toString()}` : ''}`);
    });
  }

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
        placeholder="Search title, excerpt…"
        aria-label="Search articles"
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
