'use client';

import Link from 'next/link';
import styles from './snapshot.module.css';

/** Screen-only header on the snapshot document; hidden by @media print. */
export function SnapshotToolbar({ signupId }: { signupId: number }) {
  return (
    <div className={styles.toolbar}>
      <p>
        <strong>To save a PDF:</strong> Print, then choose &ldquo;Save as PDF&rdquo;. Letter portrait, 0.5&Prime; margins;
        each section starts its own page, so the SPL can get just the roster and cars.
      </p>
      <div className={styles.toolbarActions}>
        <Link href={`/admin/rosters/${signupId}`} className={styles.backLink}>
          &larr; Back to roster
        </Link>
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
    </div>
  );
}
