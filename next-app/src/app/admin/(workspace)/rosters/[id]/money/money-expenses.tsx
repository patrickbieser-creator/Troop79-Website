'use client';

/**
 * Expenses & reimbursements on an event's Money tab — moved out of money-panel.tsx unchanged in behaviour
 * (Plans/Event-Money-Ledger-Redesign.md §6). The header's "+ Add expense" focuses this section's first field
 * (EXPENSE_FIRST_FIELD_ID).
 */
import { useState } from 'react';
import { addEventExpenseAction, type EventMoneyData } from '../../../finance/actions';
import { TRANSACTION_METHODS, type TransactionMethod } from '@/lib/finance';
import { methodLabel, money } from '@/lib/event-money';
import { fmtDate } from '@/lib/format-date';
import { EARLIEST_DATE } from '@/lib/date-entry';
import { Badge } from '../../../_components/badge';
import { Button } from '../../../../_components/button';
import styles from '../../../events/events-admin.module.css';

export const EXPENSE_SECTION_ID = 'event-money-expenses';
export const EXPENSE_FIRST_FIELD_ID = 'event-money-expense-date';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined);

export function MoneyExpenses({
  signupId,
  calendarEntryId,
  data,
  adults,
  today,
  pending,
  run
}: {
  signupId: number;
  calendarEntryId: number;
  data: EventMoneyData;
  adults: { personId: number; name: string }[];
  today: string;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;
}) {
  const [xDate, setXDate] = useState(today);
  const [xAmount, setXAmount] = useState('');
  const [xMemo, setXMemo] = useState('');
  // Who paid (always an adult leader) + with what money: troop funds → an
  // expense row naming them; their own → a reimbursement request (Patrick, 2026-08-22).
  const [xPayer, setXPayer] = useState<string>('');
  const [xPaidBy, setXPaidBy] = useState<'troop' | 'own'>('own');
  const [xMethod, setXMethod] = useState<TransactionMethod>('bank');

  return (
    <section className={styles.panel} id={EXPENSE_SECTION_ID}>
      <div className={styles.panelHead}>
        <h2>Expenses &amp; reimbursements</h2>
        <span className={styles.panelHint}>
          Every expense names the leader who paid. Troop funds → an expense row now. Their own money → a
          reimbursement request; the expense lands when the treasurer pays it out.
        </span>
      </div>
      {data.expenses.length === 0 && data.reimbursements.length === 0 ? (
        <p className={styles.empty}>No expenses recorded for this event yet.</p>
      ) : (
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Who paid</th>
              <th>Kind</th>
              <th>Method / status</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            {data.expenses.map((e) => (
              <tr key={`x${e.id}`} className={e.voidedAt ? styles.cellMuted : undefined}>
                <td>{fmtDate(e.occurredOn)}</td>
                <td>{money(Math.abs(e.amount))}</td>
                <td>{e.voidedAt ? 'voided' : (e.personName ?? '')}</td>
                <td>{e.kind}</td>
                <td>{methodLabel(e.method)}</td>
                <td>{e.memo ?? ''}</td>
              </tr>
            ))}
            {data.reimbursements.map((r) => (
              <tr key={`r${r.id}`}>
                <td>{fmtDate(r.createdAt)}</td>
                <td>{money(r.amount)}</td>
                <td>{r.requesterName}</td>
                <td>reimbursement</td>
                <td>
                  <Badge variant={r.status === 'paid' ? 'success' : r.status === 'denied' ? 'danger' : 'warning'}>{r.status}</Badge>
                </td>
                <td>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.addRow}>
        <input
          id={EXPENSE_FIRST_FIELD_ID}
          type="date"
          min={EARLIEST_DATE}
          aria-label="Expense date"
          value={xDate}
          onChange={(e) => setXDate(e.target.value)}
        />
        <input
          type="number"
          min={0.01}
          step="0.01"
          placeholder="Amount"
          aria-label="Expense amount"
          value={xAmount}
          onChange={(e) => setXAmount(e.target.value)}
        />
        <select aria-label="Who paid" value={xPayer} onChange={(e) => setXPayer(e.target.value)}>
          <option value="">Who paid…</option>
          {adults.map((a) => (
            <option key={a.personId} value={String(a.personId)}>
              {a.name}
            </option>
          ))}
        </select>
        <select aria-label="Paid with" value={xPaidBy} onChange={(e) => setXPaidBy(e.target.value as 'troop' | 'own')}>
          <option value="own">their own money (reimburse)</option>
          <option value="troop">troop funds (check / card / bank)</option>
        </select>
        {xPaidBy === 'troop' && (
          <select aria-label="Expense method" value={xMethod} onChange={(e) => setXMethod(e.target.value as TransactionMethod)}>
            {TRANSACTION_METHODS.filter((m) => m !== 'scout_account').map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </select>
        )}
        {/* Inputs follow the column order above: Date · Amount · Who paid · Paid with · What (Patrick, 2026-08-22). */}
        <input placeholder="What for (e.g. Food — Pick n Save)" aria-label="Expense memo" value={xMemo} onChange={(e) => setXMemo(e.target.value)} />
        <Button
          variant="primary"
          disabled={pending || !xAmount || !xMemo.trim() || !xPayer}
          onClick={() =>
            run(
              () =>
                addEventExpenseAction({
                  signupId,
                  calendarEntryId,
                  occurredOn: xDate,
                  amount: Number(xAmount),
                  memo: xMemo,
                  paidBy: xPaidBy === 'troop' ? 'troop' : Number(xPayer),
                  payerPersonId: Number(xPayer),
                  method: xPaidBy === 'troop' ? xMethod : 'other',
                  idempotencyKey: newKey()
                }),
              () => {
                setXAmount('');
                setXMemo('');
              }
            )
          }
        >
          Add expense
        </Button>
      </div>
    </section>
  );
}
