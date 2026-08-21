'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './finance.module.css';
import { Dialog, DialogBody, DialogActions } from '../_components/dialog';

const TRUNCATE_AT = 40;

/**
 * Renders a ledger row's Memo cell: truncated inline, with a small (i)
 * button opening the full text in a popup when it's long enough to need
 * one. Mirrors advancement/ledger/info-cell.tsx's exact pattern (Patrick,
 * 2026-08-18 — "longer memos... probably a click to pop it open").
 */
export function MemoCell({ memo }: { memo: string | null }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const text = memo?.trim() || '';
  const needsPopup = text.length > TRUNCATE_AT;
  const short = needsPopup ? `${text.slice(0, TRUNCATE_AT)}…` : text || '—';

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <span className={styles.infoCell}>
      <span>{short}</span>
      {needsPopup && (
        <button
          type="button"
          className={styles.infoBubble}
          aria-label="Show full memo"
          title="Show full memo"
          onClick={() => setOpen(true)}
        >
          i
        </button>
      )}
      {needsPopup && (
        <Dialog ref={dialogRef} onClose={() => setOpen(false)}>
          <DialogBody>
            <p className={styles.infoDialogFull}>{text}</p>
          </DialogBody>
          <DialogActions>
            <form method="dialog">
              <button type="submit" className={styles.infoDialogClose}>
                Close
              </button>
            </form>
          </DialogActions>
        </Dialog>
      )}
    </span>
  );
}
