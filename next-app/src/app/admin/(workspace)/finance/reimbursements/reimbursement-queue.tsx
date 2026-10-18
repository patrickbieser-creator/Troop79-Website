'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveReimbursementAction,
  denyReimbursementAction,
  linkReimbursementPaymentAction,
  markReimbursementPaidAction,
  type ReimbursementQueueRow
} from '../actions';
import { TRANSACTION_METHODS, TRANSACTION_METHOD_LABEL, type TransactionMethod } from '@/lib/finance';
import styles from '../finance.module.css';
import { fmtDate } from '@/lib/format-date';
import { Button } from '../../../_components/button';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';

const methodLabel = (m: string | null) => (m ? (TRANSACTION_METHOD_LABEL[m as TransactionMethod] ?? m) : 'Method not recorded');

export function ReimbursementQueue({ requests }: { requests: ReimbursementQueueRow[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<ReimbursementQueueRow | null>(null);
  const payRef = useRef<HTMLDialogElement>(null);
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

  function openPay(r: ReimbursementQueueRow) {
    setPaying(r);
    requestAnimationFrame(() => payRef.current?.showModal());
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
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => approve(r.id)}>
                        Approve
                      </Button>{' '}
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => deny(r.id)}>
                        Deny
                      </Button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => openPay(r)}>
                      Mark paid
                    </Button>
                  )}
                  {/* Settled: how it ended, not a button (Patrick, 2026-10-17 — same rule as the event Money tab). */}
                  {r.status === 'paid' && (
                    <span className={styles.muted}>{r.payment ? `${fmtDate(r.payment.occurredOn)} · ${methodLabel(r.payment.method)}` : r.paid_at ? fmtDate(r.paid_at) : ''}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog ref={payRef} onClose={() => setPaying(null)}>
        <DialogHeader title={paying ? `Mark $${paying.amount.toFixed(2)} paid` : 'Mark paid'} sub={paying ? `${paying.requesterName} · ${paying.description}` : undefined} />
        {paying && (
          <PayForm
            key={paying.id}
            request={paying}
            onDone={() => {
              payRef.current?.close();
              router.refresh();
            }}
            onCancel={() => payRef.current?.close()}
          />
        )}
      </Dialog>
    </>
  );
}

/**
 * Mark paid (Patrick, 2026-10-18): when the ledger already holds a live, unlinked payout of exactly this amount — the
 * money was Venmo'd and booked by hand — it is offered first and preselected, so closing the request links that row
 * instead of booking the payout twice. "Record a new payout" books one today, as before.
 */
function PayForm({ request: r, onDone, onCancel }: { request: ReimbursementQueueRow; onDone: () => void; onCancel: () => void }) {
  const [choice, setChoice] = useState<number | 'new'>(r.paymentCandidates[0]?.id ?? 'new');
  const [method, setMethod] = useState<TransactionMethod>('venmo');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const res = choice === 'new' ? await markReimbursementPaidAction(r.id, method) : await linkReimbursementPaymentAction(r.id, choice);
      if (!res.ok) setError(res.error ?? 'Could not mark paid.');
      else onDone();
    });
  }

  const methodSelect = (
    <select aria-label="How it was paid" className={styles.select} value={method} onChange={(e) => setMethod(e.target.value as TransactionMethod)}>
      {TRANSACTION_METHODS.filter((m) => m !== 'card').map((m) => (
        <option key={m} value={m}>
          {TRANSACTION_METHOD_LABEL[m]}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <DialogBody>
        {r.paymentCandidates.length > 0 ? (
          <fieldset className={styles.payChoices}>
            <legend>Already in the Financial Ledger?</legend>
            {r.paymentCandidates.map((c) => (
              <label key={c.id} className={styles.payChoice}>
                <input type="radio" name="pay" checked={choice === c.id} onChange={() => setChoice(c.id)} />
                <span>
                  {fmtDate(c.occurredOn)} · {methodLabel(c.method)}
                  {c.memo && <span className={styles.muted}> · {c.memo}</span>}
                </span>
              </label>
            ))}
            <label className={styles.payChoice}>
              <input type="radio" name="pay" checked={choice === 'new'} onChange={() => setChoice('new')} />
              <span>Record a new payout today</span>
            </label>
            {choice === 'new' && <div className={styles.payMethod}>{methodSelect}</div>}
          </fieldset>
        ) : (
          <label className={styles.payChoice}>
            <span>How it was paid</span>
            {methodSelect}
          </label>
        )}
        {error && <p className={styles.empty}>{error}</p>}
      </DialogBody>
      <DialogActions>
        <Button variant="primary" disabled={pending} onClick={save}>
          {pending ? 'Marking…' : 'Mark paid'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </DialogActions>
    </>
  );
}
