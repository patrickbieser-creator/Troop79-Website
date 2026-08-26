'use client';

/**
 * Job coverage — the roster's job UX since 2026-08-25 (Patrick: the per-job
 * grid columns "will be a mess on the rummage sale and not useful"). One line
 * per job with its tally; clicking the job title opens a line under it naming
 * everyone signed up, comma-separated and wrapping as needed.
 */
import { useState } from 'react';
import styles from '../../events/events-admin.module.css';

export interface JobCoverageItem {
  label: string;
  filled: number;
  needed: number | null;
  /** Attending people who claimed this job, display names. */
  names: string[];
}

export function tally(c: { filled: number; needed: number | null }): string {
  if (c.needed == null) return `${c.filled} signed up`;
  if (c.filled >= c.needed) return `Full (${c.needed}/${c.needed})`;
  return `${c.filled} of ${c.needed} — ${c.needed - c.filled} more needed`;
}

export function JobCoverage({ items }: { items: JobCoverageItem[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  return (
    <ul className={styles.coverList}>
      {items.map((c) => {
        const isOpen = open.has(c.label);
        return (
          <li key={c.label} className={styles.covItem}>
            <div className={styles.covRow}>
              <button type="button" className={styles.covToggle} aria-expanded={isOpen} onClick={() => toggle(c.label)}>
                <span className={styles.covChevron} aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>{' '}
                {c.label}
              </button>
              <span className={c.needed != null && c.filled >= c.needed ? styles.covFull : styles.covShort}>{tally(c)}</span>
            </div>
            {isOpen && <p className={styles.covNames}>{c.names.length ? c.names.join(', ') : 'Nobody yet.'}</p>}
          </li>
        );
      })}
    </ul>
  );
}
