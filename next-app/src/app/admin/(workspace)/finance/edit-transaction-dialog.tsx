'use client';

/**
 * In-place transaction correction (Patrick, 2026-08-18: "typos happen all
 * the time"). A <dialog> pre-filled with the row's current values, same
 * pattern as roster-table.tsx's payment dialog. Warns — doesn't block —
 * when the row's date falls on or before the account's last reconciliation,
 * since editing it means a past reconciliation snapshot no longer matches
 * (Plans/Troop-Finances.md's own risk note on this). The treasurer can still
 * save; it's a nudge toward re-reconciling after, not a lock.
 *
 * Field state lives in an inner component KEYED on row.id (React's own
 * "reset state via key" pattern — https://react.dev/learn/you-might-not-need-an-effect),
 * not synced through a useEffect that calls setState: eslint's
 * react-hooks/set-state-in-effect rule flags exactly that shape, and
 * remounting on key change is the recommended fix anyway — every field
 * initializes fresh from the new row with no cascading-render effect at all.
 */

import { useEffect, useRef, useState } from 'react';
import { SaveButton, useSavedSnapshot } from '../_components/save-state';
import {
  ACCOUNTS,
  TRANSACTION_METHODS,
  type Account,
  type TransactionKind,
  type TransactionKindRow,
  type TransactionMethod
} from '@/lib/finance';
import type { LedgerRow, ReconciliationSummaryRow } from './actions';
import { Dialog, DialogHeader, DialogBody } from '../_components/dialog';
import styles from './finance.module.css';

interface EditTransactionSaveInput {
  id: number;
  occurredOn: string;
  account: Account;
  amount: number;
  kind: TransactionKind;
  method: TransactionMethod | null;
  personId: number | null;
  memo: string | null;
  activityLabel: string | null;
}

export function EditTransactionDialog({
  row,
  people,
  reconciliation,
  activityLabels,
  kinds,
  pending,
  onClose,
  onSave
}: {
  row: LedgerRow | null;
  people: { id: number; display_name: string }[];
  reconciliation: ReconciliationSummaryRow[];
  activityLabels: string[];
  kinds: TransactionKindRow[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: EditTransactionSaveInput) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Pure DOM imperative sync — no setState here, so this effect is exactly
  // what useEffect is for (synchronizing React state to an external system,
  // the <dialog> element's own open/closed state).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (row && !dlg.open) dlg.showModal();
    if (!row && dlg.open) dlg.close();
  }, [row]);

  return (
    <Dialog ref={dialogRef} className={styles.editDialog} onClose={onClose}>
      <DialogHeader title="Edit transaction" />
      {row && (
        <EditTransactionForm
          key={row.id}
          row={row}
          people={people}
          reconciliation={reconciliation}
          activityLabels={activityLabels}
          kinds={kinds}
          pending={pending}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  );
}

function EditTransactionForm({
  row,
  people,
  reconciliation,
  activityLabels,
  kinds,
  pending,
  onClose,
  onSave
}: {
  row: LedgerRow;
  people: { id: number; display_name: string }[];
  reconciliation: ReconciliationSummaryRow[];
  activityLabels: string[];
  kinds: TransactionKindRow[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: EditTransactionSaveInput) => void;
}) {
  const [occurredOn, setOccurredOn] = useState(row.occurred_on);
  const [account, setAccount] = useState<Account>(row.account);
  const [amountText, setAmountText] = useState(String(Math.abs(row.amount)));
  const [sign, setSign] = useState<'in' | 'out'>(row.amount < 0 ? 'out' : 'in');
  const [kind, setKind] = useState<TransactionKind>(row.kind as TransactionKind);
  const [method, setMethod] = useState<TransactionMethod | ''>((row.method as TransactionMethod) ?? '');
  const [personId, setPersonId] = useState(row.person_id ? String(row.person_id) : '');
  const [memo, setMemo] = useState(row.memo ?? '');
  const [activity, setActivity] = useState(row.activity_label ?? '');
  // Save standard (2026-08-24): the whole draft against the row it opened with.
  const { dirty } = useSavedSnapshot(
    JSON.stringify({ occurredOn, account, amountText, sign, kind, method, personId, memo, activity })
  );

  const lastReconciled = reconciliation.find((r) => r.account === account)?.lastReconciledAt ?? null;
  const staleWarning = lastReconciled && row.occurred_on <= lastReconciled;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountAbs = Number(amountText);
    if (!Number.isFinite(amountAbs) || amountAbs <= 0) return;
    onSave({
      id: row.id,
      occurredOn,
      account,
      amount: sign === 'out' ? -amountAbs : amountAbs,
      kind,
      method: method || null,
      // Whatever's picked, regardless of account — Who applies beyond
      // scout_account (event-fee and reimbursement rows already carry it;
      // 2026-08-19's historical backfill gave 74 checking/savings rows a
      // real person too). Gating this on account === 'scout_account' used
      // to silently NULL OUT an existing Who the moment any other field on
      // a non-scout-account row was edited — exactly the rows that backfill
      // just populated.
      personId: personId ? Number(personId) : null,
      memo: memo.trim() || null,
      activityLabel: activity.trim() || null
    });
  }

  return (
    <DialogBody>
    <form className={styles.formGrid} onSubmit={submit}>
      {staleWarning && (
        <p className={`${styles.formGridWide} ${styles.staleWarnNote}`}>
          Reconciled on {lastReconciled} — saving will drift that reconciliation. Consider redoing it after.
        </p>
      )}
      <label className="adminLabel">
        Date
        <input type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
      </label>
      <label className="adminLabel">
        Account
        <select value={account} onChange={(e) => setAccount(e.target.value as Account)}>
          {ACCOUNTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="adminLabel">
        Scout/Adult
        <select required={account === 'scout_account'} value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">{account === 'scout_account' ? 'Select a scout…' : '— unattributed —'}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="adminLabel">
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind)}>
          {kinds.map((k) => (
            <option key={k.code} value={k.code}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="adminLabel">
        Method
        <select value={method} onChange={(e) => setMethod(e.target.value as TransactionMethod | '')}>
          <option value="">(none)</option>
          {TRANSACTION_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="adminLabel">
        Direction
        <select value={sign} onChange={(e) => setSign(e.target.value as 'in' | 'out')}>
          <option value="out">Money out (expense)</option>
          <option value="in">Money in (income)</option>
        </select>
      </label>
      <label className="adminLabel">
        Amount
        <input
          type="number"
          required
          min="0.01"
          step="0.01"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </label>
      <label className="adminLabel">
        Activity
        <input
          type="text"
          list="activity-labels-edit"
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
        />
        <datalist id="activity-labels-edit">
          {activityLabels.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      </label>
      <label className={`adminLabel ${styles.formGridWide}`}>
        Memo
        <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </label>
      <div className={styles.editDialogActions}>
        <button type="button" className={styles.pagerBtn} onClick={onClose}>
          Cancel
        </button>
        <SaveButton
          type="submit"
          className={styles.pagerBtn}
          dirty={dirty}
          pending={pending}
          blocked={!(Number(amountText) > 0)}
          blockedReason="Amount must be more than zero"
        />
      </div>
    </form>
    </DialogBody>
  );
}
