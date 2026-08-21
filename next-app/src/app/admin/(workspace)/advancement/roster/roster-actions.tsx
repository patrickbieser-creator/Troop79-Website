'use client';

/**
 * Actions ▾ (2026-08-20) — same shape as Finance's (D-156). Replaces the
 * standalone "Print Roster" button (print-button.tsx). "+ Add Scout" /
 * "+ Add Adult" stay as visible per-tab buttons on purpose (Patrick,
 * 2026-08-20): they're frequent, primary actions, unlike Finance's rare
 * treasurer actions — burying them here would slow down the common case.
 */

import styles from './roster.module.css';

export function RosterActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <select
        value=""
        className={styles.select}
        aria-label="Roster actions"
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = '';
          if (v === 'print') window.print();
        }}
      >
        <option value="">Actions…</option>
        <option value="print">Print Roster</option>
      </select>
    </div>
  );
}
