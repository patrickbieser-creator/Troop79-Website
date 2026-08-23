'use client';

/**
 * "Saving changes…" → "Done" (Patrick, 2026-08-23: "pop open a dialog that
 * stays open briefly … so that the user really knows what's going on").
 *
 * The sign-up forms are server actions that redirect back with ?saved=1, so
 * the two halves live on two page loads:
 *   SavingOverlay — rendered by the form the moment it submits (and stays up
 *     while the browser navigates); the label follows the submitter
 *     (data-intent="cancel" on the cancel button → "Cancelling…").
 *   SavedFlash   — rendered by the page when ?saved=1 / ?cancelled=1 is in
 *     the URL; shows "Done" for a moment and dismisses itself. The permanent
 *     green Notice under it stays, so the flash is a confirmation, not the
 *     only record.
 * Both are role="status" + aria-live so a screen reader hears them too.
 */

import { useEffect, useState } from 'react';
import styles from './event-detail.module.css';

export type SaveIntent = 'save' | 'cancel';

/** Reads the submitter's data-intent so the overlay can say the right verb. */
export function intentOf(e: React.FormEvent<HTMLFormElement>): SaveIntent {
  const submitter = (e.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLElement | null | undefined;
  return submitter?.dataset.intent === 'cancel' ? 'cancel' : 'save';
}

export function SavingOverlay({ intent }: { intent: SaveIntent | null }) {
  if (!intent) return null;
  return (
    <div className={styles.saveOverlay} role="status" aria-live="assertive">
      <div className={styles.saveDialog}>
        <span className={styles.saveSpinner} aria-hidden="true" />
        <strong>{intent === 'cancel' ? 'Cancelling your signup…' : 'Saving changes…'}</strong>
      </div>
    </div>
  );
}

export function SavedFlash({ what = 'Your changes are saved.', ms = 1800 }: { what?: string; ms?: number }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  if (!open) return null;
  return (
    <div className={styles.saveOverlay} role="status" aria-live="polite">
      <div className={`${styles.saveDialog} ${styles.saveDone}`}>
        <span className={styles.saveCheck} aria-hidden="true">✓</span>
        <strong>Done</strong>
        <span>{what}</span>
      </div>
    </div>
  );
}
