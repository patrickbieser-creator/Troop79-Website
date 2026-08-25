'use client';

import Link from 'next/link';
import { ROSTER_ORDERS, ROSTER_ORDER_LABEL, type RosterOrder } from '@/lib/event-snapshot';
import styles from './snapshot.module.css';
import { Button } from '../../_components/button';

/** Screen-only header on the snapshot document; hidden by @media print.
 *  Carries the roster print-order switch (Patrick, 2026-08-22): by patrol —
 *  the sheet's shape — or A–Z by last name. The order is a URL param so the
 *  printed copy matches what is on screen. */
export function SnapshotToolbar({ signupId, order }: { signupId: number; order: RosterOrder }) {
  const orderLink = (key: RosterOrder, label: string) => (
    <Link
      href={`/admin/snapshot/${signupId}${key === 'patrol' ? '' : `?order=${key}`}`}
      className={`${styles.orderLink}${order === key ? ` ${styles.orderOn}` : ''}`}
      aria-current={order === key ? 'page' : undefined}
    >
      {label}
    </Link>
  );
  return (
    <div className={styles.toolbar}>
      <p>
        <strong>To save a PDF:</strong> Print, then choose &ldquo;Save as PDF&rdquo;. Letter portrait, 0.5&Prime; margins;
        each section starts its own page, so the SPL can get just the roster and cars.
      </p>
      <div className={styles.toolbarActions}>
        <span className={styles.orderLinks} aria-label="Roster order">
          {ROSTER_ORDERS.map((o) => orderLink(o, ROSTER_ORDER_LABEL[o]))}
        </span>
        <Link href={`/admin/rosters/${signupId}`} className={styles.backLink}>
          &larr; Back to roster
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}
