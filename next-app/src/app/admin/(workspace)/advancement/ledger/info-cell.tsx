'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ledger.module.css';

interface Props {
  short: string;
  full: string | null | undefined;
  /** Optional secondary lines shown inside the popup (e.g. archive/delete reasons). */
  notes?: string | null;
}

/**
 * Renders the row's Description cell: a short label inline, plus a small (i)
 * button that opens a popup with the full requirement text. The (i) only
 * appears when the full text differs from the short one.
 */
export function InfoCell({ short, full, notes }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showInfo = !!full && full.trim() !== '' && full !== short;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <span className={styles.infoCell}>
      <span className={styles.infoCellShort}>{short}</span>
      {showInfo && (
        <button
          type="button"
          className={styles.infoBubble}
          aria-label="Show full requirement"
          title="Show full requirement"
          onClick={() => setOpen(true)}
        >
          i
        </button>
      )}
      {notes && (
        <span className={styles.infoCellNote}>{notes}</span>
      )}
      {showInfo && (
        <dialog
          ref={dialogRef}
          className={styles.infoDialog}
          onClose={() => setOpen(false)}
          onClick={(e) => {
            // Click-outside-content (on the backdrop) closes the dialog.
            if (e.target === dialogRef.current) setOpen(false);
          }}
        >
          <div className={styles.infoDialogInner}>
            <p className={styles.infoDialogShort}>{short}</p>
            <p className={styles.infoDialogFull}>{full}</p>
            <form method="dialog" className={styles.infoDialogActions}>
              <button type="submit" className={styles.infoDialogClose}>
                Close
              </button>
            </form>
          </div>
        </dialog>
      )}
    </span>
  );
}
