'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ledger.module.css';
import { Dialog, DialogBody, DialogActions } from '../../_components/dialog';
import { Button } from '../../../_components/button';

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
        <Dialog ref={dialogRef} onClose={() => setOpen(false)}>
          <DialogBody>
            <p className={`adminLabel ${styles.infoDialogShort}`}>{short}</p>
            <p className={styles.infoDialogFull}>{full}</p>
          </DialogBody>
          <DialogActions>
            <form method="dialog">
              <Button type="submit" variant="primary">
                Close
              </Button>
            </form>
          </DialogActions>
        </Dialog>
      )}
    </span>
  );
}
