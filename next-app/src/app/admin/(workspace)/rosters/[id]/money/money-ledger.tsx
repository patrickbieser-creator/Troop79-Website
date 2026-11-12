'use client';

/**
 * "Who owes what" — the Money tab's read-only ledger (Plans/Event-Money-Ledger-Redesign.md §4). No buttons in rows:
 * a row (its name is the real focus target) selects the person and the panel beside it does the work. ↑ ↓ move the
 * selection while the table has focus; Esc closes the panel.
 *
 * "Not going" is the sign-up status and rides on the name; the Status badge says what they owe — Not paying is
 * an amount, a separate fact (Patrick, 2026-11-12).
 */
import { useRef, type KeyboardEvent } from 'react';
import type { EventMoneyPerson } from '../../../finance/actions';
import { fmtDate } from '@/lib/format-date';
import { ledgerStatus, methodLabel, money, paymentSummary, type MilestoneStanding } from '@/lib/event-money';
import { Badge } from '../../../_components/badge';
import styles from './money.module.css';

const STATUS_CHIP: Record<string, string> = { no: 'Not going', maybe: 'maybe', waitlist: 'waitlist' };

export function statusChip(status: string): string | null {
  return status === 'yes' ? null : (STATUS_CHIP[status] ?? status);
}

export function MoneyLedger({
  people,
  standings,
  hasSchedule,
  selectedId,
  onSelect
}: {
  people: EventMoneyPerson[];
  standings: Map<number, { standing: MilestoneStanding; shortBy: number }>;
  hasSchedule: boolean;
  selectedId: number | null;
  onSelect: (entryId: number | null) => void;
}) {
  const nameRefs = useRef(new Map<number, HTMLButtonElement>());

  function move(delta: number) {
    if (people.length === 0) return;
    const at = people.findIndex((p) => p.entryId === selectedId);
    const next = people[Math.min(people.length - 1, Math.max(0, at < 0 ? 0 : at + delta))];
    onSelect(next.entryId);
    nameRefs.current.get(next.entryId)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Escape') {
      onSelect(null);
    }
  }

  const sum = (f: (p: EventMoneyPerson) => number) => Math.round(people.reduce((n, p) => n + f(p) * 100, 0)) / 100;
  const owing = people.filter((p) => p.owed > 0);
  const paidCount = owing.filter((p) => p.balance <= 0).length;
  const oweCount = owing.length - paidCount;
  const notPaying = people.filter((p) => p.owed === 0 && p.amountOverride != null).length;
  const balanceTotal = sum((p) => p.balance);

  return (
    <>
      <div className={styles.tableCard}>
        <table className={styles.ledger} onKeyDown={onKeyDown} aria-label="Who owes what">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className={styles.num}>
                Owes
              </th>
              <th scope="col" className={styles.num}>
                Paid
              </th>
              <th scope="col" className={styles.num}>
                Balance
              </th>
              <th scope="col">Method</th>
              <th scope="col">Paid on</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const on = p.entryId === selectedId;
              const how = paymentSummary(p.transactions);
              const s = standings.get(p.entryId) ?? { standing: 'n/a' as MilestoneStanding, shortBy: 0 };
              const badge = ledgerStatus(p, s.standing, s.shortBy, hasSchedule);
              const chip = statusChip(p.status);
              const tierNote = `Tier ${p.tierLabel ?? '—'} ${money(p.tierAmount)}`;
              return (
                <tr
                  key={p.entryId}
                  className={on ? `${styles.row} ${styles.rowOn}` : styles.row}
                  onClick={() => onSelect(p.entryId)}
                >
                  <td>
                    <button
                      type="button"
                      className={styles.nameBtn}
                      ref={(el) => {
                        if (el) nameRefs.current.set(p.entryId, el);
                        else nameRefs.current.delete(p.entryId);
                      }}
                      aria-pressed={on}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(p.entryId);
                      }}
                    >
                      {p.name}
                    </button>
                    {chip && <span className={styles.chip}>{chip}</span>}
                    {p.participation !== 'full' && <span className={styles.chip}>{p.participation.replace('_', ' ')}</span>}
                  </td>
                  <td className={styles.num}>
                    {money(p.owed)}
                    {p.amountOverride != null && (
                      <span className={styles.star} title={tierNote} aria-label={`custom amount; ${tierNote}`}>
                        *
                      </span>
                    )}
                  </td>
                  <td className={styles.num}>
                    {money(p.paid)}
                    {p.credited > 0 && <span className={styles.chip}>{money(p.credited)} credited to account</span>}
                  </td>
                  {/* Overpaid: red, parentheses, minus — all three (Patrick). */}
                  <td className={styles.num}>
                    {p.balance === 0 ? (
                      '—'
                    ) : p.balance < 0 ? (
                      <span className={styles.neg}>({money(p.balance)})</span>
                    ) : (
                      <span className={styles.bold}>{money(p.balance)}</span>
                    )}
                  </td>
                  <td>{how.methods.map(methodLabel).join(', ')}</td>
                  <td>{how.lastOn ? fmtDate(how.lastOn, { year: 'short' }) : ''}</td>
                  <td>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                {people.length} {people.length === 1 ? 'person' : 'people'}
              </td>
              <td className={styles.num}>{money(sum((p) => p.owed))}</td>
              <td className={styles.num}>{money(sum((p) => p.paid))}</td>
              <td className={`${styles.num} ${balanceTotal > 0 ? styles.gold : ''}`}>{money(balanceTotal)}</td>
              <td colSpan={3}>
                {paidCount} paid · {oweCount} owe{notPaying > 0 ? ` · ${notPaying} not paying` : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.foot}>
        Click a row, or use ↑ ↓, to open that person. * custom amount. A person paid in parts shows their latest
        payment.
      </p>
    </>
  );
}
