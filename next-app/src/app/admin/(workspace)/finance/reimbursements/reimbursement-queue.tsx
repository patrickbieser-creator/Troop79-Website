'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveReimbursementAction,
  denyReimbursementAction,
  markReimbursementPaidAction,
  type ReimbursementQueueRow
} from '../actions';
import { TRANSACTION_METHODS, type TransactionMethod } from '@/lib/finance';
import styles from '../finance.module.css';
import { fmtDate } from '@/lib/format-date';

export function ReimbursementQueue({ requests }: { requests: ReimbursementQueueRow[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function approve(id: number) {
    start(async () => {
      setError(null);
      const res = await approveReimbursementAction(id);
      if (!res.ok) setError(res.error ?? 'Could not approve.');
      else router.refresh();
    });
  }

  function deny(id: number) {
    const reason = window.prompt('Reason for denying this request — the family will see it:');
    if (reason === null) return; // cancelled
    start(async () => {
      setError(null);
      const res = await denyReimbursementAction(id, reason);
      if (!res.ok) setError(res.error ?? 'Could not deny.');
      else router.refresh();
    });
  }

  function markPaid(id: number) {
    const method = window.prompt(`How was this paid? (${TRANSACTION_METHODS.join(', ')})`, 'venmo');
    if (method === null) return;
    if (!(TRANSACTION_METHODS as readonly string[]).includes(method)) {
      setError(`"${method}" isn't a recognized method — try one of: ${TRANSACTION_METHODS.join(', ')}.`);
      return;
    }
    start(async () => {
      setError(null);
      const res = await markReimbursementPaidAction(id, method as TransactionMethod);
      if (!res.ok) setError(res.error ?? 'Could not mark paid.');
      else router.refresh();
    });
  }

  if (requests.length === 0) {
    return <p className={styles.empty}>No reimbursement requests yet.</p>;
  }

  return (
    <>
      {error && <p className={styles.empty}>{error}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Scout/Adult</th>
              <th>Description</th>
              <th className={styles.numCell}>Amount</th>
              <th>Status</th>
              <th>Receipt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className={styles.nowrap}>{fmtDate(r.created_at)}</td>
                <td>{r.requesterName}</td>
                <td>
                  {r.description}
                  {r.status === 'denied' && r.denial_reason && (
                    <div className={styles.balanceSubtext}>Denied: {r.denial_reason}</div>
                  )}
                </td>
                <td className={styles.numCell}>${r.amount.toFixed(2)}</td>
                <td>
                  <span className={styles.kindPill}>{r.status}</span>
                </td>
                <td>
                  {r.receiptUrl ? (
                    <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer">
                      View
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={styles.nowrap}>
                  {r.status === 'submitted' && (
                    <>
                      <button type="button" className={styles.pagerBtn} disabled={pending} onClick={() => approve(r.id)}>
                        Approve
                      </button>{' '}
                      <button type="button" className={styles.pagerBtn} disabled={pending} onClick={() => deny(r.id)}>
                        Deny
                      </button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <button type="button" className={styles.pagerBtn} disabled={pending} onClick={() => markPaid(r.id)}>
                      Mark paid
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
