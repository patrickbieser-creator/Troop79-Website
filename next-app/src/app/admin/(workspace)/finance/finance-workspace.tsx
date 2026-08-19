'use client';

/**
 * Treasurer write surface (Plans/Troop-Finances.md Phase 2): record a
 * transaction, transfer between checking/savings, reconcile against a bank
 * statement, and void mistakes — plus the ledger table itself (void buttons
 * live on each row). Everything here is a no-op UI shell for a
 * finance.view-only actor; canManage gates every write affordance, and the
 * server actions re-check the capability regardless (this hiding a button
 * is convenience, not the security boundary).
 *
 * <details> elements for the three forms, not a JS-driven accordion —
 * keyboard-fast (Tab/Enter reach everything), no extra state to manage, and
 * it matches this codebase's plain-HTML-first bias elsewhere in /admin.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ACCOUNTS,
  TRANSACTION_KINDS,
  TRANSACTION_METHODS,
  type Account,
  type TransactionKind,
  type TransactionMethod
} from '@/lib/finance';
import {
  addTransactionAction,
  voidTransactionAction,
  editTransactionAction,
  addTransferAction,
  addReconciliationAction,
  type LedgerRow,
  type LedgerSortKey,
  type ReconciliationSummaryRow
} from './actions';
import { MemoCell } from './memo-cell';
import { EditTransactionDialog } from './edit-transaction-dialog';
import styles from './finance.module.css';

const TODAY = () => new Date().toISOString().slice(0, 10);

/** Sortable column header — a plain link (URL-driven sort, matches the
 *  Universal Ledger's convention), not a client-side sort, so the 50-row
 *  page and the 1000-row PostgREST cap stay someone else's problem. */
function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  sortUrl,
  numeric
}: {
  label: string;
  sortKey: LedgerSortKey;
  currentSort: LedgerSortKey;
  currentDir: 'asc' | 'desc';
  sortUrl: (key: LedgerSortKey) => string;
  numeric?: boolean;
}) {
  const active = currentSort === sortKey;
  return (
    <th className={numeric ? styles.numCell : undefined}>
      <Link href={sortUrl(sortKey)} className={active ? (currentDir === 'asc' ? styles.sortAsc : styles.sortDesc) : undefined}>
        {label}
      </Link>
    </th>
  );
}

export function FinanceWorkspace({
  canManage,
  rows,
  people,
  reconciliation,
  sort,
  dir,
  filters,
  activityLabels
}: {
  canManage: boolean;
  rows: LedgerRow[];
  people: { id: number; display_name: string }[];
  reconciliation: ReconciliationSummaryRow[];
  sort: LedgerSortKey;
  dir: 'asc' | 'desc';
  filters: { account?: string; kind?: string; person?: string };
  activityLabels: string[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<LedgerRow | null>(null);
  const router = useRouter();

  // Plain values in, string built here — a Server Component can't hand a
  // Client Component a closure (functions aren't serializable across the
  // RSC boundary), so the URL gets built on this side instead of passed in.
  function sortUrl(key: LedgerSortKey): string {
    const nextDir = sort === key && dir === 'desc' ? 'asc' : 'desc';
    const params = new URLSearchParams();
    if (filters.account) params.set('account', filters.account);
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.person) params.set('person', filters.person);
    params.set('sort', key);
    params.set('dir', nextDir);
    return `/admin/finance?${params.toString()}`;
  }

  return (
    <>
      {error && <p className={styles.empty}>{error}</p>}

      {canManage && (
        <>
          <RecordTransactionForm
            people={people}
            activityLabels={activityLabels}
            pending={pending}
            onSubmit={(input) =>
              start(async () => {
                setError(null);
                const res = await addTransactionAction(input);
                if (!res.ok) setError(res.error ?? 'Could not record transaction.');
                else router.refresh();
              })
            }
          />
          <TransferForm
            pending={pending}
            onSubmit={(input) =>
              start(async () => {
                setError(null);
                const res = await addTransferAction(input);
                if (!res.ok) setError(res.error ?? 'Could not record transfer.');
                else router.refresh();
              })
            }
          />
          <ReconciliationPanel
            summary={reconciliation}
            pending={pending}
            onSubmit={(input) =>
              start(async () => {
                setError(null);
                const res = await addReconciliationAction(input);
                if (!res.ok) setError(res.error ?? 'Could not save reconciliation.');
                else router.refresh();
              })
            }
          />
        </>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortHeader label="Date" sortKey="date" currentSort={sort} currentDir={dir} sortUrl={sortUrl} />
              <SortHeader label="Account" sortKey="account" currentSort={sort} currentDir={dir} sortUrl={sortUrl} />
              <SortHeader label="Kind" sortKey="kind" currentSort={sort} currentDir={dir} sortUrl={sortUrl} />
              <th>Who</th>
              <th>Activity</th>
              <th>Memo</th>
              <SortHeader
                label="Amount"
                sortKey="amount"
                currentSort={sort}
                currentDir={dir}
                sortUrl={sortUrl}
                numeric
              />
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 8 : 7} className={styles.empty}>
                  No transactions match this filter.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={r.voided_at ? styles.voidedRow : undefined}>
                <td className={styles.nowrap}>{r.occurred_on}</td>
                <td>{r.account}</td>
                <td>
                  <span className={styles.kindPill}>{r.kind}</span>
                </td>
                <td>{r.personName ?? '—'}</td>
                <td>{r.activity_label || '—'}</td>
                <td>
                  <MemoCell memo={r.memo} />
                </td>
                <td className={styles.numCell}>
                  {r.amount < 0 ? `-$${Math.abs(r.amount).toFixed(2)}` : `$${r.amount.toFixed(2)}`}
                </td>
                {canManage && (
                  <td className={styles.numCell}>
                    {!r.voided_at && (
                      <>
                        <button
                          type="button"
                          className={styles.pagerBtn}
                          disabled={pending}
                          onClick={() => setEditingRow(r)}
                        >
                          Edit
                        </button>{' '}
                        <button
                          type="button"
                          className={styles.pagerBtn}
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              setError(null);
                              const res = await voidTransactionAction(r.id);
                              if (!res.ok) setError(res.error ?? 'Could not void.');
                              else router.refresh();
                            })
                          }
                        >
                          Void
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <EditTransactionDialog
          row={editingRow}
          people={people}
          reconciliation={reconciliation}
          pending={pending}
          onClose={() => setEditingRow(null)}
          onSave={(input) =>
            start(async () => {
              setError(null);
              const res = await editTransactionAction(input);
              if (!res.ok) setError(res.error ?? 'Could not save changes.');
              else {
                setEditingRow(null);
                router.refresh();
              }
            })
          }
        />
      )}
    </>
  );
}

interface TransactionFormState {
  occurredOn: string;
  account: Account;
  kind: TransactionKind;
  method: TransactionMethod | '';
  amountText: string;
  sign: 'in' | 'out';
  personId: string;
  memo: string;
  activity: string;
}

function RecordTransactionForm({
  people,
  activityLabels,
  pending,
  onSubmit
}: {
  people: { id: number; display_name: string }[];
  activityLabels: string[];
  pending: boolean;
  onSubmit: (input: {
    occurredOn: string;
    account: Account;
    amount: number;
    kind: TransactionKind;
    method: TransactionMethod | null;
    personId: number | null;
    memo: string | null;
    activityLabel: string | null;
  }) => void;
}) {
  const [f, setF] = useState<TransactionFormState>({
    occurredOn: TODAY(),
    account: 'checking',
    kind: 'expense',
    method: '',
    amountText: '',
    sign: 'out',
    personId: '',
    memo: '',
    activity: ''
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountAbs = Number(f.amountText);
    if (!Number.isFinite(amountAbs) || amountAbs <= 0) return;
    onSubmit({
      occurredOn: f.occurredOn,
      account: f.account,
      amount: f.sign === 'out' ? -amountAbs : amountAbs,
      kind: f.kind,
      method: f.method || null,
      personId: f.account === 'scout_account' && f.personId ? Number(f.personId) : null,
      memo: f.memo.trim() || null,
      activityLabel: f.activity.trim() || null
    });
    setF((s) => ({ ...s, amountText: '', memo: '', activity: '' }));
  };

  return (
    <details className={styles.formPanel}>
      <summary>Record a transaction</summary>
      <form className={styles.formGrid} onSubmit={submit}>
        <label>
          Date
          <input
            type="date"
            required
            value={f.occurredOn}
            onChange={(e) => setF((s) => ({ ...s, occurredOn: e.target.value }))}
          />
        </label>
        <label>
          Account
          <select value={f.account} onChange={(e) => setF((s) => ({ ...s, account: e.target.value as Account }))}>
            {ACCOUNTS.filter((a) => a !== 'sofi').map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {f.account === 'scout_account' && (
          <label>
            Scout
            <select required value={f.personId} onChange={(e) => setF((s) => ({ ...s, personId: e.target.value }))}>
              <option value="">Select a scout&hellip;</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Kind
          <select value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as TransactionKind }))}>
            {TRANSACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Method
          <select
            value={f.method}
            onChange={(e) => setF((s) => ({ ...s, method: e.target.value as TransactionMethod | '' }))}
          >
            <option value="">(none)</option>
            {TRANSACTION_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select value={f.sign} onChange={(e) => setF((s) => ({ ...s, sign: e.target.value as 'in' | 'out' }))}>
            <option value="out">Money out (expense)</option>
            <option value="in">Money in (income)</option>
          </select>
        </label>
        <label>
          Amount
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            value={f.amountText}
            onChange={(e) => setF((s) => ({ ...s, amountText: e.target.value }))}
          />
        </label>
        <label>
          Activity <span className={styles.optionalHint}>(for the report)</span>
          <input
            type="text"
            list="activity-labels"
            placeholder="e.g. Fall Campout '26"
            value={f.activity}
            onChange={(e) => setF((s) => ({ ...s, activity: e.target.value }))}
          />
          {/* Existing labels as a suggestion, not an enforced FK — typing a
              new one is always fine (Patrick, 2026-08-18: typo-resistance,
              not a normalized activities table). */}
          <datalist id="activity-labels">
            {activityLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </label>
        <label className={styles.formGridWide}>
          Memo
          <input type="text" value={f.memo} onChange={(e) => setF((s) => ({ ...s, memo: e.target.value }))} />
        </label>
        <button type="submit" className={styles.pagerBtn} disabled={pending}>
          Add transaction
        </button>
      </form>
    </details>
  );
}

function TransferForm({
  pending,
  onSubmit
}: {
  pending: boolean;
  onSubmit: (input: {
    occurredOn: string;
    fromAccount: 'checking' | 'savings';
    toAccount: 'checking' | 'savings';
    amount: number;
    memo: string | null;
  }) => void;
}) {
  const [occurredOn, setOccurredOn] = useState(TODAY());
  const [fromAccount, setFromAccount] = useState<'checking' | 'savings'>('checking');
  const [toAccount, setToAccount] = useState<'checking' | 'savings'>('savings');
  const [amountText, setAmountText] = useState('');
  const [memo, setMemo] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) return;
    onSubmit({ occurredOn, fromAccount, toAccount, amount, memo: memo.trim() || null });
    setAmountText('');
    setMemo('');
  };

  return (
    <details className={styles.formPanel}>
      <summary>Transfer between checking and savings</summary>
      <form className={styles.formGrid} onSubmit={submit}>
        <label>
          Date
          <input type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        <label>
          From
          <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label>
          To
          <select value={toAccount} onChange={(e) => setToAccount(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label>
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
        <label className={styles.formGridWide}>
          Memo
          <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <button type="submit" className={styles.pagerBtn} disabled={pending || fromAccount === toAccount}>
          Record transfer
        </button>
      </form>
    </details>
  );
}

function ReconciliationPanel({
  summary,
  pending,
  onSubmit
}: {
  summary: ReconciliationSummaryRow[];
  pending: boolean;
  onSubmit: (input: {
    account: 'checking' | 'savings';
    asOf: string;
    statementBalance: number;
    note: string | null;
  }) => void;
}) {
  const [account, setAccount] = useState<'checking' | 'savings'>('checking');
  const [asOf, setAsOf] = useState(TODAY());
  const [statementText, setStatementText] = useState('');
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const statementBalance = Number(statementText);
    if (!Number.isFinite(statementBalance)) return;
    onSubmit({ account, asOf, statementBalance, note: note.trim() || null });
    setStatementText('');
    setNote('');
  };

  return (
    <details className={styles.formPanel}>
      <summary>Monthly reconciliation</summary>
      <ul className={styles.reconList}>
        {summary.map((s) => (
          <li key={s.account}>
            <strong>{s.account}</strong>: computed ${s.computedBalance.toFixed(2)}
            {s.lastReconciledAt ? (
              <>
                {' '}
                — last reconciled {s.lastReconciledAt} at ${s.lastStatementBalance?.toFixed(2)}
                {s.drift != null && Math.abs(s.drift) > 0.01 && (
                  <span className={styles.driftWarn}> (drift ${s.drift.toFixed(2)})</span>
                )}
              </>
            ) : (
              ' — never reconciled'
            )}
          </li>
        ))}
      </ul>
      <form className={styles.formGrid} onSubmit={submit}>
        <label>
          Account
          <select value={account} onChange={(e) => setAccount(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label>
          As of
          <input type="date" required value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label>
          Statement balance
          <input
            type="number"
            required
            step="0.01"
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
          />
        </label>
        <label className={styles.formGridWide}>
          Note
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className={styles.pagerBtn} disabled={pending}>
          Save reconciliation
        </button>
      </form>
    </details>
  );
}
