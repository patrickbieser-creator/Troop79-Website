'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './finance.module.css';
import { Dialog, DialogBody, DialogActions } from '../_components/dialog';
import { fmtDate, fmtDateTime } from '@/lib/format-date';
import { Button } from '../../_components/button';

/**
 * Ledger Date cell — surfaces who entered the row and when (2026-08-19),
 * without widening the table with a dedicated column. Same info-cell/popup
 * pattern as memo-cell.tsx: a small (i) bubble next to the date, shown only
 * when there's something to show. Historical import rows have no
 * entered-by stamp (the import script never set one, correctly — "existing
 * entries that are blank are fine," Patrick) and render the plain date with
 * no bubble at all, rather than a popup that just says "unknown."
 */
export function EnteredByCell({
  occurredOn,
  enteredByName,
  createdAt
}: {
  occurredOn: string;
  enteredByName: string | null;
  createdAt: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  if (!enteredByName) return <>{fmtDate(occurredOn)}</>;

  const enteredOn = fmtDateTime(createdAt);

  return (
    <span className={styles.infoCell}>
      <span>{fmtDate(occurredOn)}</span>
      <button
        type="button"
        className={styles.infoBubble}
        aria-label="Show who entered this transaction"
        title="Show who entered this transaction"
        onClick={() => setOpen(true)}
      >
        i
      </button>
      <Dialog ref={dialogRef} onClose={() => setOpen(false)}>
        <DialogBody>
          <p className={styles.infoDialogFull}>
            Entered by {enteredByName} on {enteredOn}.
          </p>
        </DialogBody>
        <DialogActions>
          <form method="dialog">
            <Button variant="primary" type="submit">
              Close
            </Button>
          </form>
        </DialogActions>
      </Dialog>
    </span>
  );
}
