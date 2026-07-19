'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setEntryFlag } from '../../actions';
import type { RosterRow } from './page';
import styles from '../../events-admin.module.css';

/** Roster table with leader-managed slip/payment ticks and a CSV export.
 *  One troop-wide list — no patrol grouping (see page.tsx). */
export function RosterTable({
  rows,
  signupId,
  calendarEntryId,
  showSlip
}: {
  rows: RosterRow[];
  signupId: number;
  calendarEntryId: number;
  showSlip: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const sorted = [...rows].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  );

  const exportCsv = () => {
    const head = [
      'Type', 'Name', 'Household', 'Status', 'Participation', 'Tier', 'Days',
      'Owed', 'Guests', 'Guest note', 'Driving there', 'Driving back',
      'Slip', 'Paid', 'Jobs', 'Notes'
    ];
    const body = sorted.map((r) => [
      r.kind, r.name, r.household, r.status, r.participation, r.tierLabel ?? '',
      r.days ?? '', r.owed, r.guests, r.guestNote ?? '',
      r.drivesOut ? (r.seatsOut ?? '') : '', r.drivesBack ? (r.seatsBack ?? '') : '',
      r.slipReceived ? 'Y' : 'N', r.paymentReceived ? 'Y' : 'N',
      r.claims.join(' | '), r.notes ?? ''
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
              <td>{r.claims.join(', ') || '—'}</td>
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
                  onChange={(e) => toggle(r, 'payment_received', e.target.checked)}
                />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showSlip ? 8 : 7} className={styles.empty}>
                Nobody has signed up yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
