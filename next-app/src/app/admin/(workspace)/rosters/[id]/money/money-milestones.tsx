'use client';

/**
 * Deposit schedule & deadlines on an event's Money tab — moved out of money-panel.tsx unchanged in behaviour
 * (Plans/Event-Money-Ledger-Redesign.md §6): the milestones, "N behind…" and the reminder email flow.
 */
import { useState } from 'react';
import { addMilestone, deleteMilestone, emailPaymentReminders } from '../../../events/actions';
import { money, type Milestone } from '@/lib/event-money';
import { fmtDate } from '@/lib/format-date';
import { EARLIEST_DATE } from '@/lib/date-entry';
import { Button } from '../../../../_components/button';
import styles from '../../../events/events-admin.module.css';

export interface BehindRow {
  entryId: number;
  name: string;
  shortBy: number;
  dueByToday: number;
}

export function MoneyMilestones({
  signupId,
  calendarEntryId,
  milestones,
  behind,
  pending,
  run,
  task
}: {
  signupId: number;
  calendarEntryId: number;
  milestones: Milestone[];
  behind: BehindRow[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;
  /** Runs work inside the panel's transition with its error/note lines (the reminder email reports a status). */
  task: (fn: (report: { error: (m: string) => void; note: (m: string) => void }) => Promise<void>) => void;
}) {
  const [mKind, setMKind] = useState<'payment' | 'registration' | 'form' | 'other'>('payment');
  const [mLabel, setMLabel] = useState('');
  const [mDue, setMDue] = useState('');
  const [mAmount, setMAmount] = useState('');
  const [mWho, setMWho] = useState<'scouts' | 'adults' | 'both'>('both');
  const [mailPreview, setMailPreview] = useState<string[] | null>(null);
  const reminders = behind.map((b) => ({ entryId: b.entryId, short: b.shortBy, due: b.dueByToday }));

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Deposit schedule &amp; deadlines</h2>
        <span className={styles.panelHint}>
          Shown on the public event page. Payment milestones drive the Behind badge: paid &lt; what the schedule asked
          for by today.
        </span>
      </div>
      {milestones.length > 0 && (
        <table className={styles.miniTable}>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id}>
                <td>{fmtDate(m.dueOn)}</td>
                <td>
                  <strong>{m.label}</strong>
                </td>
                <td>{m.kind}</td>
                <td>{m.amount != null ? money(m.amount) : '—'}</td>
                <td>{m.appliesTo}</td>
                <td>
                  <button
                    type="button"
                    className={styles.rowDel}
                    disabled={pending}
                    onClick={() => run(() => deleteMilestone(m.id, signupId, calendarEntryId))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.addRow}>
        <select aria-label="Milestone kind" value={mKind} onChange={(e) => setMKind(e.target.value as typeof mKind)}>
          <option value="payment">Payment due</option>
          <option value="registration">Registration deadline</option>
          <option value="form">Form due</option>
          <option value="other">Other</option>
        </select>
        <input placeholder="Label (e.g. Deposit)" aria-label="Milestone label" value={mLabel} onChange={(e) => setMLabel(e.target.value)} />
        <input type="date" min={EARLIEST_DATE} aria-label="Milestone due date" value={mDue} onChange={(e) => setMDue(e.target.value)} />
        {mKind === 'payment' && (
          <input
            type="number"
            min={0.01}
            step="0.01"
            placeholder="Amount"
            aria-label="Milestone amount"
            value={mAmount}
            onChange={(e) => setMAmount(e.target.value)}
          />
        )}
        <select aria-label="Milestone applies to" value={mWho} onChange={(e) => setMWho(e.target.value as typeof mWho)}>
          <option value="both">Everyone</option>
          <option value="scouts">Scouts</option>
          <option value="adults">Adults</option>
        </select>
        <Button
          variant="primary"
          disabled={pending || !mLabel.trim() || !mDue || (mKind === 'payment' && !mAmount)}
          onClick={() =>
            run(
              () =>
                addMilestone(signupId, calendarEntryId, {
                  kind: mKind,
                  label: mLabel,
                  dueOn: mDue,
                  amount: mKind === 'payment' ? Number(mAmount) : null,
                  appliesTo: mWho
                }),
              () => {
                setMLabel('');
                setMAmount('');
              }
            )
          }
        >
          Add milestone
        </Button>
      </div>
      {milestones.some((m) => m.kind === 'payment') && (
        <div className={styles.addRow}>
          <span className={styles.panelHint}>
            {behind.length === 0
              ? 'Nobody is behind on the schedule.'
              : `${behind.length} behind: ${behind.map((b) => `${b.name} (${money(b.shortBy)})`).join(', ')}`}
          </span>
          {behind.length > 0 && !mailPreview && (
            <button
              type="button"
              className={styles.rowEdit}
              disabled={pending}
              onClick={() =>
                task(async (report) => {
                  const res = await emailPaymentReminders(signupId, reminders, false);
                  if (!res.ok) report.error(res.error ?? 'Could not preview.');
                  else setMailPreview(res.to ?? []);
                })
              }
            >
              Preview reminder recipients
            </button>
          )}
          {mailPreview && (
            <>
              <span className={styles.panelHint}>To: {mailPreview.join(', ') || '(nobody)'}</span>
              <Button
                variant="primary"
                disabled={pending || mailPreview.length === 0}
                onClick={() =>
                  task(async (report) => {
                    const res = await emailPaymentReminders(signupId, reminders, true);
                    if (!res.ok) report.error(res.error ?? 'Could not send.');
                    else report.note(`Payment reminder ${res.status} to ${res.to?.length ?? 0} address(es).`);
                    setMailPreview(null);
                  })
                }
              >
                Send reminder
              </Button>
              <button type="button" className={styles.rowEdit} onClick={() => setMailPreview(null)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
