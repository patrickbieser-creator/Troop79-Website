'use client';

/**
 * The screen-only header on the roster document. Hidden by @media print, so it
 * never appears on the sheet itself.
 *
 * Two controls, no more: print (which is also how you save a PDF — the browser
 * print dialog's "Destination: Save as PDF") and a way back to the roster.
 */

import Link from 'next/link';
import styles from './roster-print.module.css';
import { Button } from '../_components/button';

export function PrintToolbar() {
  return (
    <div className={styles.toolbar}>
      <p className={styles.toolbarNote}>
        <strong>To save a PDF:</strong> click Print, then choose &ldquo;Save as PDF&rdquo; as the
        destination. Letter portrait, 0.5&Prime; margins &mdash; leave &ldquo;Headers and
        footers&rdquo; off for a clean sheet.
      </p>
      <div className={styles.toolbarActions}>
        <Link href="/admin/advancement/roster" className={styles.backLink}>&larr; Back to roster</Link>
        <Button variant="primary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}
