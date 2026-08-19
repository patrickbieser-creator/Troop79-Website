'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setEntryFlag, cancelEntry, restoreEntry } from '../../events/actions';
import { recordEventFeePaymentAction, voidEventFeePaymentAction } from '../../finance/actions';
import type { TransactionMethod } from '@/lib/finance';
import type { RosterRow } from './page';
import styles from '../../events/events-admin.module.css';

/** Roster table with leader-managed slip/payment ticks and a CSV export.
 *  One troop-wide list — no patrol grouping (see page.tsx). */
export function RosterTable({
  rows,
  removedRows,
  signupId,
  calendarEntryId,
  showSlip
}: {
  rows: RosterRow[];
  removedRows: RosterRow[];
  signupId: number;
  calendarEntryId: number;
  showSlip: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Two-click confirm rather than a modal: a stray click shouldn't drop
  // someone from a trip, but a dialog for every removal is heavy.
  const [confirming, setConfirming] = useState<number | null>(null);

  // Marking payment received needs a method + amount, which a bare
  // checkbox can't collect (Plans/Troop-Finances.md Phase 2 event-fee
  // integration) — checking the box opens this dialog instead of writing
  // the flag directly; un-checking voids the linked transaction and needs
  // no prompt.
  const [payingRow, setPayingRow] = useState<RosterRow | null>(null);
  const [payMethod, setPayMethod] = useState<TransactionMethod>('venmo');
  const [payAmountText, setPayAmountText] = useState('');
  const payDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = payDialogRef.current;
    if (!dlg) return;
    if (payingRow && !dlg.open) dlg.showModal();
    if (!payingRow && dlg.open) dlg.close();
  }, [payingRow]);

  function openPayDialog(r: RosterRow) {
    setPayMethod('venmo');
    setPayAmountText(String(r.owed));
    setPayingRow(r);
  }

  function confirmPayment() {
    if (!payingRow) return;
    const amount = Number(payAmountText);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const row = payingRow;
    start(async () => {
      setError(null);
      try {
        // requireAnyOf() throws (rather than returning ok:false) when the
        // actor lacks calendar.write/finance.manage entirely — a leader
        // without either capability shouldn't see this button, but the
        // server action re-checks regardless, and a bare throw here would
        // otherwise surface as an unhandled rejection instead of the same
        // friendly error banner every other failure uses.
        const res = await recordEventFeePaymentAction({
          signupEntryId: row.id,
          amount,
          method: payMethod,
          signupId
        });
        if (!res.ok) setError(res.error ?? 'Could not record payment.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record payment.');
      }
      setPayingRow(null);
      router.refresh();
    });
  }

  function unmarkPayment(r: RosterRow) {
    start(async () => {
      setError(null);
      try {
        const res = await voidEventFeePaymentAction(r.id, signupId);
        if (!res.ok) setError(res.error ?? 'Could not undo payment.');
        else router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not undo payment.');
      }
    });
  }

  const sorted = [...rows].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  );

  const exportCsv = () => {
    const head = [
      'Type', 'Name', 'Household', 'Status', 'Participation', 'Tier', 'Days',
      'Owed', 'Guests', 'Guest note', 'Driving there', 'Driving back',
      'Slip', 'Paid', 'Jobs', 'Answers', 'Notes'
    ];
    const body = sorted.map((r) => [
      r.kind, r.name, r.household, r.status, r.participation, r.tierLabel ?? '',
      r.days ?? '', r.owed, r.guests, r.guestNote ?? '',
      r.drivesOut ? (r.seatsOut ?? '') : '', r.drivesBack ? (r.seatsBack ?? '') : '',
      r.slipReceived ? 'Y' : 'N', r.paymentReceived ? 'Y' : 'N',
      r.claimsDisplay.join(' | '), r.answers.join(' | '), r.notes ?? ''
    ]);
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-roster-${signupId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (r: RosterRow, field: 'permission_slip_received' | 'payment_received', v: boolean) =>
    start(async () => {
      setError(null);
      const res = await setEntryFlag(r.id, field, v, signupId, calendarEntryId);
      if (!res.ok) setError(res.error ?? 'Could not save.');
      else router.refresh();
    });

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Everyone signed up ({rows.length})</h2>
        <div>
          <button type="button" className={styles.enableBtn} onClick={() => window.print()}>
            Print
          </button>{' '}
          <button type="button" className={styles.enableBtn} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
      {error && <p className={styles.err}>{error}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Household</th>
            <th scope="col">Status</th>
            <th scope="col">Owed</th>
            <th scope="col">Driving</th>
            <th scope="col">Jobs</th>
            {showSlip && <th scope="col">Slip</th>}
            <th scope="col">Paid</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className={r.status === 'waitlist' ? styles.waitRow : undefined}>
              <td>
                <span className={styles.evTitle}>{r.name}</span>
                <span className={styles.evCat}>
                  {r.kind}
                  {r.participation !== 'full' && ` · ${r.participation.replace('_', ' ')}`}
                  {r.guests > 0 && ` · +${r.guests} guests`}
                </span>
                {r.notes && <span className={styles.rowNote}>{r.notes}</span>}
                {r.answers.length > 0 && (
                  <span className={styles.rowAnswers}>{r.answers.join(' · ')}</span>
                )}
              </td>
              <td>{r.household}</td>
              <td className={styles.nowrap}>
                {r.status === 'waitlist' ? <strong>Waitlist</strong> : r.status}
              </td>
              <td className={styles.nowrap}>
                {r.owed > 0 ? `$${r.owed}` : '—'}
                {r.days ? <span className={styles.evCat}>{r.days} days</span> : null}
              </td>
              <td className={styles.nowrap}>
                {r.drivesOut || r.drivesBack
                  ? [r.drivesOut && `there ${r.seatsOut}`, r.drivesBack && `back ${r.seatsBack}`]
                      .filter(Boolean)
                      .join(' · ')
                  : '—'}
              </td>
              <td>{r.claimsDisplay.join(', ') || '—'}</td>
              {showSlip && (
                <td>
                  <input
                    type="checkbox"
                    checked={r.slipReceived}
                    disabled={pending || r.kind !== 'scout'}
                    aria-label={`Permission slip received — ${r.name}`}
                    onChange={(e) => toggle(r, 'permission_slip_received', e.target.checked)}
                  />
                </td>
              )}
              <td>
                <input
                  type="checkbox"
                  checked={r.paymentReceived}
                  disabled={pending || r.owed === 0}
                  aria-label={`Payment received — ${r.name}`}
                  onChange={(e) => (e.target.checked ? openPayDialog(r) : unmarkPayment(r))}
                />
              </td>
              <td className={styles.nowrap}>
                {confirming === r.id ? (
                  <>
                    <button
                      type="button"
                      className={styles.rowDel}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const res = await cancelEntry(r.id, signupId, calendarEntryId);
                          if (!res.ok) setError(res.error ?? 'Could not remove.');
                          setConfirming(null);
                          router.refresh();
                        })
                      }
                    >
                      Confirm
                    </button>{' '}
                    <button
                      type="button"
                      className={styles.rowEdit}
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.rowDel}
                    disabled={pending}
                    onClick={() => setConfirming(r.id)}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showSlip ? 9 : 8} className={styles.empty}>
                Nobody has signed up yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {removedRows.length > 0 && (
        <div className={styles.removedBlock}>
          <p className={styles.panelHint}>
            <strong>Removed ({removedRows.length}).</strong> Their spots are already back in the
            pool — restore anyone taken off by mistake.
          </p>
          <ul className={styles.coverList}>
            {removedRows.map((r) => (
              <li key={r.id}>
                <span>
                  {r.name} <span className={styles.evCat}>{r.household}</span>
                </span>
                <button
                  type="button"
                  className={styles.rowEdit}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const res = await restoreEntry(r.id, signupId, calendarEntryId);
                      if (!res.ok) setError(res.error ?? 'Could not restore.');
                      router.refresh();
                    })
                  }
                >
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dialog
        ref={payDialogRef}
        className={styles.payDialog}
        onClose={() => setPayingRow(null)}
        onClick={(e) => {
          if (e.target === payDialogRef.current) setPayingRow(null);
        }}
      >
        {payingRow && (
          <div className={styles.payDialogInner}>
            <h3>Record payment — {payingRow.name}</h3>
            <label className={styles.payField}>
              Method
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as TransactionMethod)}>
                <option value="venmo">Venmo</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="scout_account">Scout account balance</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className={styles.payField}>
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmountText}
                onChange={(e) => setPayAmountText(e.target.value)}
              />
            </label>
            <div className={styles.payDialogActions}>
              <button type="button" className={styles.rowEdit} onClick={() => setPayingRow(null)}>
                Cancel
              </button>
              <button type="button" className={styles.enableBtn} disabled={pending} onClick={confirmPayment}>
                Record payment
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
