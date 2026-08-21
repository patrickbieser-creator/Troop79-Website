'use client';

/**
 * "I need to drill in to see the details of any activities in the report"
 * (Patrick, 2026-08-19). Dedicated modal (Patrick's explicit pick over a
 * filtered-ledger navigation) — fetches on open, not pre-loaded with the
 * report, since most activities are never drilled into.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ActivityDrilldownRow } from '../actions';
import parentStyles from '../finance.module.css';
import styles from './report.module.css';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { Notice } from '../../_components/notice';

function money(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

export function ActivityDrilldownButton({
  activityLabel,
  getActivityTransactions
}: {
  activityLabel: string;
  getActivityTransactions: (activityLabel: string) => Promise<ActivityDrilldownRow[]>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ActivityDrilldownRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  function openDrilldown() {
    setOpen(true);
    setError(null);
    setRows(null);
    getActivityTransactions(activityLabel)
      .then(setRows)
      .catch(() => setError('Could not load transactions for this activity.'));
  }

  return (
    <>
      <button type="button" className={parentStyles.pagerBtn} onClick={openDrilldown}>
        View transactions →
      </button>
      <Dialog
        ref={dialogRef}
        className={parentStyles.editDialog}
        onClose={() => setOpen(false)}
      >
        <DialogHeader title={activityLabel} />
        <DialogBody>
          {error && <Notice>{error}</Notice>}
          {!error && rows === null && <p className={parentStyles.empty}>Loading…</p>}
          {rows && rows.length === 0 && <p className={parentStyles.empty}>No transactions found.</p>}
          {rows && rows.length > 0 && (
            <ul className={styles.drilldownList}>
              {rows.map((r) => (
                <li key={r.id} className={r.voided_at ? styles.drilldownVoided : undefined}>
                  <span className={styles.drilldownDate}>{r.occurred_on}</span>
                  <span>{r.account}</span>
                  <span>{r.kind}</span>
                  <span>{r.personName ?? '—'}</span>
                  <span className={styles.drilldownMemo}>{r.memo ?? '—'}</span>
                  <span className={styles.numCell}>{money(r.amount)}</span>
                  {r.eventHref ? (
                    <Link href={r.eventHref} className={styles.drilldownEventLink}>
                      View event →
                    </Link>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogActions>
          <form method="dialog">
            <button type="submit" className={parentStyles.pagerBtn}>
              Close
            </button>
          </form>
        </DialogActions>
      </Dialog>
    </>
  );
}
