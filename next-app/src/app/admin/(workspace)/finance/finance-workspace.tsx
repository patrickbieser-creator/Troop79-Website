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
 * The four write surfaces (Record, Transfer, Reconciliation, Manage Kinds)
 * live behind ONE "Actions" pull-down at the top (Patrick, 2026-08-20:
 * "too many buttons if we keep adding functionality") rather than their own
 * button/section each — picking one opens it in a shared modal. Adding a
 * fifth surface later means one more <option>, not one more permanent
 * on-page control.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ACCOUNTS,
  TRANSACTION_METHODS,
  type Account,
  type TransactionKind,
  type TransactionKindRow,
  type TransactionMethod
} from '@/lib/finance';
import {
  addTransactionAction,
  voidTransactionAction,
  editTransactionAction,
  bulkReassignAction,
  createTransactionKindAction,
  addTransferAction,
  addReconciliationAction,
  type LedgerRow,
  type LedgerSortKey,
  type ReconciliationSummaryRow
} from './actions';
import { MemoCell } from './memo-cell';
import { EnteredByCell } from './entered-by-cell';
import { EditTransactionDialog } from './edit-transaction-dialog';
import { KindManager } from './kind-manager';
import { ActionsMenu } from '../_components/actions-menu';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../_components/dialog';
import styles from './finance.module.css';

type FinanceModal = 'record' | 'transfer' | 'reconcile' | 'kinds';
const MODAL_TITLES: Record<FinanceModal, string> = {
  record: 'Record a transaction',
  transfer: 'Transfer between checking and savings',
  reconcile: 'Monthly reconciliation',
  kinds: 'Manage Kinds'
};

const TODAY = () => new Date().toISOString().slice(0, 10);

/** Sortable column header — a plain link (URL-driven sort, matches the
 *  Advancement Ledger's convention), not a client-side sort, so the 50-row
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
  activityLabels,
  kinds
}: {
  canManage: boolean;
  rows: LedgerRow[];
  people: { id: number; display_name: string }[];
  reconciliation: ReconciliationSummaryRow[];
  sort: LedgerSortKey;
  dir: 'asc' | 'desc';
  filters: {
    account?: string;
    kind?: string;
    person?: string;
    activity?: string;
    dateFrom?: string;
    dateTo?: string;
    amountMin?: string;
    amountMax?: string;
  };
  activityLabels: string[];
  kinds: TransactionKindRow[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<LedgerRow | null>(null);
  const router = useRouter();

  // The single Actions modal (Record/Transfer/Reconcile/Manage Kinds) —
  // same imperative <dialog> sync pattern as edit-transaction-dialog.tsx's
  // own useEffect: no setState-in-effect, just mirroring `activeModal` onto
  // the DOM element's real open/closed state.
  const [activeModal, setActiveModal] = useState<FinanceModal | null>(null);
  const actionModalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = actionModalRef.current;
    if (!dlg) return;
    if (activeModal && !dlg.open) dlg.showModal();
    if (!activeModal && dlg.open) dlg.close();
  }, [activeModal]);

  // kinds is the DB-loaded, governed vocabulary (transaction_kinds,
  // 2026-08-20) — no more hardcoded TRANSACTION_KIND_LABELS. `?? code` keeps
  // any already-selected/optimistic value legible even before a refresh
  // catches up (e.g. right after createKind, below).
  const kindLabel = (code: string) => kinds.find((k) => k.code === code)?.label ?? code;

  /**
   * Bulk Kind reassignment — built for retiring the 'income'/'expense' Kind
   * values (Patrick, 2026-08-20): filter to Kind=income or Kind=expense,
   * select a page's worth, reassign to a real category, repeat until both
   * are empty. Selection is page-scoped on purpose — it clears on a
   * successful apply rather than trying to survive a page/filter change,
   * since the whole workflow is "select what's visible, act, move on".
   */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkKind, setBulkKind] = useState<TransactionKind | ''>('');
  const [bulkActivity, setBulkActivity] = useState('');
  const [bulkStatus, setBulkStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  // "+ New Kind" — the governed list is extensible without a deploy
  // (Patrick, 2026-08-20), same as calendar_categories: add a row, it's
  // immediately selectable. No local optimistic list — router.refresh()
  // re-loads `kinds` from the DB, same as every other write on this page.
  const [addingKind, setAddingKind] = useState(false);
  const [newKindName, setNewKindName] = useState('');
  function createKind() {
    const name = newKindName.trim();
    if (!name) return;
    const fd = new FormData();
    fd.set('code', name);
    fd.set('label', name);
    start(async () => {
      const res = await createTransactionKindAction(fd);
      if (!res.ok) {
        setBulkStatus({ kind: 'err', msg: res.error ?? 'Could not add Kind.' });
        return;
      }
      setNewKindName('');
      setAddingKind(false);
      if (res.code) setBulkKind(res.code);
      router.refresh();
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function applyBulkReassign() {
    const trimmedActivity = bulkActivity.trim();
    if ((!bulkKind && !trimmedActivity) || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBulkStatus(null);
    start(async () => {
      const res = await bulkReassignAction(ids, {
        ...(bulkKind ? { kind: bulkKind } : {}),
        ...(trimmedActivity ? { activityLabel: trimmedActivity } : {})
      });
      if (!res.ok) {
        setBulkStatus({ kind: 'err', msg: res.error ?? 'Could not reassign.' });
        return;
      }
      const parts: string[] = [];
      if (bulkKind) parts.push(`Kind → ${kindLabel(bulkKind)}`);
      if (trimmedActivity) parts.push(`Activity → "${trimmedActivity}"`);
      setSelectedIds(new Set());
      setBulkKind('');
      setBulkActivity('');
      setBulkStatus({ kind: 'ok', msg: `Updated ${res.updated}: ${parts.join(', ')}.` });
      router.refresh();
    });
  }

  // Plain values in, string built here — a Server Component can't hand a
  // Client Component a closure (functions aren't serializable across the
  // RSC boundary), so the URL gets built on this side instead of passed in.
  function sortUrl(key: LedgerSortKey): string {
    const nextDir = sort === key && dir === 'desc' ? 'asc' : 'desc';
    const params = new URLSearchParams();
    if (filters.account) params.set('account', filters.account);
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.person) params.set('person', filters.person);
    if (filters.activity) params.set('activity', filters.activity);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.amountMin) params.set('amountMin', filters.amountMin);
    if (filters.amountMax) params.set('amountMax', filters.amountMax);
    params.set('sort', key);
    params.set('dir', nextDir);
    return `/admin/finance?${params.toString()}`;
  }

  return (
    <>
      {error && <p className={styles.empty}>{error}</p>}

      {canManage && (
        <div className={styles.actionsBar}>
          {/* Activity Report and Reimbursements dropped 2026-08-20 — both
              duplicate the main nav's Finance section already. Everything
              left here is a write action, so the whole bar is canManage-only
              now (a finance.view-only actor has nothing left to pick here;
              Activity Report is still reachable — see Backlog re: the
              sub-nav's finance.view visibility gap). Prefixed values
              navigate (router.push); bare values open the modal below. */}
          <ActionsMenu
            ariaLabel="Finance actions"
            options={[
              { value: 'record', label: 'Record a transaction' },
              { value: 'transfer', label: 'Transfer between accounts' },
              { value: 'reconcile', label: 'Monthly reconciliation' },
              { value: 'kinds', label: 'Manage Kinds' },
              { value: 'nav:/admin/finance/export', label: 'Export CSV (backup)' }
            ]}
            onAction={(v) => {
              if (v.startsWith('nav:')) {
                router.push(v.slice(4));
                return;
              }
              setActiveModal(v as FinanceModal);
            }}
          />
        </div>
      )}

      {canManage && (
        <Dialog
          ref={actionModalRef}
          className={styles.actionModal}
          onClose={() => setActiveModal(null)}
        >
          <DialogHeader title={activeModal ? MODAL_TITLES[activeModal] : ''} />
          <DialogBody>
            {activeModal === 'record' && (
              <RecordTransactionForm
                people={people}
                activityLabels={activityLabels}
                kinds={kinds}
                pending={pending}
                onSubmit={(input) =>
                  start(async () => {
                    setError(null);
                    const res = await addTransactionAction(input);
                    if (!res.ok) setError(res.error ?? 'Could not record transaction.');
                    else {
                      setActiveModal(null);
                      router.refresh();
                    }
                  })
                }
              />
            )}
            {activeModal === 'transfer' && (
              <TransferForm
                pending={pending}
                onSubmit={(input) =>
                  start(async () => {
                    setError(null);
                    const res = await addTransferAction(input);
                    if (!res.ok) setError(res.error ?? 'Could not record transfer.');
                    else {
                      setActiveModal(null);
                      router.refresh();
                    }
                  })
                }
              />
            )}
            {activeModal === 'reconcile' && (
              <ReconciliationPanel
                summary={reconciliation}
                pending={pending}
                onSubmit={(input) =>
                  start(async () => {
                    setError(null);
                    const res = await addReconciliationAction(input);
                    if (!res.ok) setError(res.error ?? 'Could not save reconciliation.');
                    else {
                      setActiveModal(null);
                      router.refresh();
                    }
                  })
                }
              />
            )}
            {activeModal === 'kinds' && <KindManager kinds={kinds} />}
          </DialogBody>
          <DialogActions>
            <button type="button" className={styles.saveBtnAlt} onClick={() => setActiveModal(null)}>
              Close
            </button>
          </DialogActions>
        </Dialog>
      )}

      {canManage && selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span>{selectedIds.size} selected</span>
          {addingKind ? (
            <>
              <input
                type="text"
                placeholder="New Kind name"
                value={newKindName}
                autoFocus
                onChange={(e) => setNewKindName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createKind();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setAddingKind(false);
                    setNewKindName('');
                  }
                }}
              />
              <button
                type="button"
                className={styles.saveBtn}
                onClick={createKind}
                disabled={!newKindName.trim() || pending}
              >
                Add
              </button>
              <button type="button" className={styles.saveBtnAlt} onClick={() => setAddingKind(false)} disabled={pending}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <select value={bulkKind} onChange={(e) => setBulkKind(e.target.value)}>
                <option value="">Reassign Kind to…</option>
                {kinds.map((k) => (
                  <option key={k.code} value={k.code}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button type="button" className={styles.saveBtnAlt} onClick={() => setAddingKind(true)} disabled={pending}>
                + New Kind
              </button>
              <input
                type="text"
                list="activity-labels"
                placeholder="Reassign Activity to…"
                value={bulkActivity}
                onChange={(e) => setBulkActivity(e.target.value)}
              />
              <button
                type="button"
                className={styles.saveBtn}
                onClick={applyBulkReassign}
                disabled={(!bulkKind && !bulkActivity.trim()) || pending}
              >
                {pending ? '…' : 'Apply'}
              </button>
              <button
                type="button"
                className={styles.saveBtnAlt}
                onClick={() => setSelectedIds(new Set())}
                disabled={pending}
              >
                Clear selection
              </button>
            </>
          )}
          {bulkStatus && <span className={bulkStatus.kind === 'ok' ? styles.statusOk : styles.statusErr}>{bulkStatus.msg}</span>}
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {canManage && (
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                  />
                </th>
              )}
              <SortHeader label="Date" sortKey="date" currentSort={sort} currentDir={dir} sortUrl={sortUrl} />
              <SortHeader label="Account" sortKey="account" currentSort={sort} currentDir={dir} sortUrl={sortUrl} />
              <SortHeader label="Kind" sortKey="kind" currentSort={sort} currentDir={dir} sortUrl={sortUrl} />
              <th>Scout/Adult</th>
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
                <td colSpan={canManage ? 9 : 7} className={styles.empty}>
                  No transactions match this filter.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={r.voided_at ? styles.voidedRow : undefined}>
                {canManage && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      aria-label={`Select transaction ${r.id}`}
                    />
                  </td>
                )}
                <td className={styles.nowrap}>
                  <EnteredByCell occurredOn={r.occurred_on} enteredByName={r.enteredByName} createdAt={r.created_at} />
                </td>
                <td>{r.account}</td>
                <td>
                  <span className={styles.kindPill}>{kindLabel(r.kind)}</span>
                </td>
                <td>{r.personName ?? '—'}</td>
                <td>{r.activity_label || '—'}</td>
                <td>
                  <MemoCell memo={r.memo} />
                </td>
                <td className={r.amount < 0 ? `${styles.numCell} ${styles.amountOut}` : styles.numCell}>
                  {r.amount < 0 ? `($${Math.abs(r.amount).toFixed(2)})` : `$${r.amount.toFixed(2)}`}
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
          activityLabels={activityLabels}
          kinds={kinds}
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

export function RecordTransactionForm({
  people,
  activityLabels,
  kinds,
  pending,
  onSubmit
}: {
  people: { id: number; display_name: string }[];
  activityLabels: string[];
  kinds: TransactionKindRow[];
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
      // Who applies beyond scout_account — see edit-transaction-dialog.tsx's
      // matching comment (2026-08-19).
      personId: f.personId ? Number(f.personId) : null,
      memo: f.memo.trim() || null,
      activityLabel: f.activity.trim() || null
    });
    setF((s) => ({ ...s, amountText: '', memo: '', activity: '' }));
  };

  return (
    <>
      <form className={styles.formGrid} onSubmit={submit}>
        <label className="adminLabel">
          Date
          <input
            type="date"
            required
            value={f.occurredOn}
            onChange={(e) => setF((s) => ({ ...s, occurredOn: e.target.value }))}
          />
        </label>
        <label className="adminLabel">
          Account
          <select value={f.account} onChange={(e) => setF((s) => ({ ...s, account: e.target.value as Account }))}>
            {ACCOUNTS.filter((a) => a !== 'sofi').map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="adminLabel">
          Scout/Adult
          <select
            required={f.account === 'scout_account'}
            value={f.personId}
            onChange={(e) => setF((s) => ({ ...s, personId: e.target.value }))}
          >
            <option value="">{f.account === 'scout_account' ? 'Select a scout…' : '— unattributed —'}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="adminLabel">
          Kind
          <select
            value={f.kind}
            onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as TransactionKind }))}
          >
            {kinds.map((k) => (
              <option key={k.code} value={k.code}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adminLabel">
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
        <label className="adminLabel">
          Direction
          <select value={f.sign} onChange={(e) => setF((s) => ({ ...s, sign: e.target.value as 'in' | 'out' }))}>
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
            value={f.amountText}
            onChange={(e) => setF((s) => ({ ...s, amountText: e.target.value }))}
          />
        </label>
        <label className="adminLabel">
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
        <label className={`adminLabel ${styles.formGridWide}`}>
          Memo
          <textarea
            rows={2}
            value={f.memo}
            onChange={(e) => setF((s) => ({ ...s, memo: e.target.value }))}
          />
        </label>
        <button type="submit" className={styles.pagerBtn} disabled={pending}>
          Add transaction
        </button>
      </form>
    </>
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
    <>
      <form className={styles.formGrid} onSubmit={submit}>
        <label className="adminLabel">
          Date
          <input type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        <label className="adminLabel">
          From
          <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label className="adminLabel">
          To
          <select value={toAccount} onChange={(e) => setToAccount(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
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
        <label className={`adminLabel ${styles.formGridWide}`}>
          Memo
          <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <button type="submit" className={styles.pagerBtn} disabled={pending || fromAccount === toAccount}>
          Record transfer
        </button>
      </form>
    </>
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
    <>
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
        <label className="adminLabel">
          Account
          <select value={account} onChange={(e) => setAccount(e.target.value as 'checking' | 'savings')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
        <label className="adminLabel">
          As of
          <input type="date" required value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="adminLabel">
          Statement balance
          <input
            type="number"
            required
            step="0.01"
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
          />
        </label>
        <label className={`adminLabel ${styles.formGridWide}`}>
          Note
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className={styles.pagerBtn} disabled={pending}>
          Save reconciliation
        </button>
      </form>
    </>
  );
}
