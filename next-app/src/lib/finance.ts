/**
 * Troop Finances — shared vocabulary + balance derivation (Plans/Troop-Finances.md
 * Phase 1). Framework-agnostic, same split as lib/capabilities.ts: no
 * next/headers here, just the vocabulary and the pure math every screen needs.
 *
 * Balances are ALWAYS derived from transaction history — financial_transactions
 * has no stored running-balance column, on purpose (a maintained running
 * balance is exactly the reconciliation bug the old spreadsheet already has:
 * one out-of-order edit and every balance after it is silently wrong).
 */

/** Rows per page on the finance ledger view. Lives here, not in actions.ts —
 *  every export from a 'use server' file must be an async function, so a
 *  plain constant can't live alongside the Server Actions it's used with. */
export const FINANCE_PAGE_SIZE = 50;

/** Must stay in lockstep with financial_transactions' `account` check constraint. */
export const ACCOUNTS = ['checking', 'savings', 'scout_account', 'scholarship', 'sofi'] as const;
export type Account = (typeof ACCOUNTS)[number];

/** Must stay in lockstep with financial_transactions' `kind` check constraint. */
export const TRANSACTION_KINDS = [
  'event_fee',
  'fundraiser',
  'donation',
  'expense',
  'reimbursement',
  'transfer',
  'interest',
  'adjustment',
  'income'
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** Must stay in lockstep with financial_transactions' `method` check constraint.
 *  No 'online' value — no payment processing in this build (deferred, not rejected). */
export const TRANSACTION_METHODS = ['venmo', 'check', 'cash', 'scout_account', 'bank', 'other'] as const;
export type TransactionMethod = (typeof TRANSACTION_METHODS)[number];

export function isAccount(value: string): value is Account {
  return (ACCOUNTS as readonly string[]).includes(value);
}

export interface FinancialTransactionRow {
  account: Account;
  amount: number;
  person_id: number | null;
  voided_at: string | null;
}

/**
 * Sums signed transaction amounts for one account (and, for `scout_account`,
 * one person) into a balance in dollars.
 *
 * Accumulates in integer CENTS, not floating-point dollars — numeric(10,2)
 * values round-trip through supabase-js as JS numbers, and summing hundreds
 * of dollar-and-cent amounts as floats drifts (the classic 0.1 + 0.2 problem)
 * exactly the kind of silent-off-by-a-cent bug a ledger cannot tolerate.
 * Converting to cents, summing as integers, and dividing back to dollars at
 * the end keeps the result exact.
 */
export function computeBalance(
  transactions: readonly FinancialTransactionRow[],
  filter: { account: Account; personId?: number | null }
): number {
  const cents = transactions
    .filter((t) => t.voided_at === null)
    .filter((t) => t.account === filter.account)
    .filter((t) => filter.personId === undefined || t.person_id === filter.personId)
    .reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
  return cents / 100;
}

/**
 * Every scout with at least one `scout_account` transaction, and their
 * derived balance — the family/treasurer roster view. Excludes voided rows
 * the same way computeBalance does.
 */
export function computeScoutAccountBalances(
  transactions: readonly FinancialTransactionRow[]
): Map<number, number> {
  const balances = new Map<number, number>();
  for (const t of transactions) {
    if (t.voided_at !== null) continue;
    if (t.account !== 'scout_account') continue;
    if (t.person_id === null) continue;
    const priorCents = Math.round((balances.get(t.person_id) ?? 0) * 100);
    balances.set(t.person_id, (priorCents + Math.round(t.amount * 100)) / 100);
  }
  return balances;
}

/** One row as shown on the treasurer ledger and in the CSV export — the
 *  shared shape between the two so they can never silently drift apart. */
export interface LedgerCsvRow {
  occurred_on: string;
  account: Account;
  amount: number;
  kind: TransactionKind;
  method: TransactionMethod | null;
  personName: string | null;
  memo: string | null;
  activity_label: string | null;
  voided_at: string | null;
}

/** One field, RFC-4180 escaped: wrap in quotes and double any embedded
 *  quote whenever the value contains a quote, comma, or newline. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface ActivityTransactionRow {
  activity_label: string | null;
  amount: number;
  account: Account;
  voided_at: string | null;
  occurred_on: string;
}

export interface ActivitySummary {
  activityLabel: string;
  /** Blended across every account (checking, savings, scout_account,
   *  scholarship) — the true gross flow for the event. A Can Drive's troop
   *  cut and its per-scout allocations are both real money that moved
   *  because of that event; splitting them out would need transaction-level
   *  forensic work this import can't do reliably, so the summary shows the
   *  combined total and byAccount below it for a treasurer to eyeball the
   *  split themselves. */
  income: number;
  expense: number; // <= 0
  net: number;
  count: number;
  byAccount: Partial<Record<Account, number>>;
  /** occurred_on range across every non-voided row in this activity — same
   *  value for both when it's all one day. */
  firstDate: string;
  lastDate: string;
}

/**
 * Per-event/activity income-vs-expense report (Plans/Troop-Finances.md
 * Phase 6, Patrick 2026-08-18: "tie out between income and expenses...
 * on demand based on each event"). Groups every non-voided transaction that
 * carries an `activity_label` — populated on all 646 imported historical
 * rows already; app-entered rows need the same field set going forward for
 * this to stay useful (the Record a transaction form collects it).
 */
export function summarizeByActivity(transactions: readonly ActivityTransactionRow[]): ActivitySummary[] {
  interface Acc {
    incomeCents: number;
    expenseCents: number;
    count: number;
    byAccountCents: Partial<Record<Account, number>>;
    firstDate: string;
    lastDate: string;
  }
  const map = new Map<string, Acc>();

  for (const t of transactions) {
    if (t.voided_at !== null) continue;
    const label = t.activity_label?.trim();
    if (!label) continue;

    const entry = map.get(label) ?? {
      incomeCents: 0,
      expenseCents: 0,
      count: 0,
      byAccountCents: {},
      firstDate: t.occurred_on,
      lastDate: t.occurred_on
    };
    const cents = Math.round(t.amount * 100);
    if (cents > 0) entry.incomeCents += cents;
    else entry.expenseCents += cents;
    entry.count += 1;
    entry.byAccountCents[t.account] = (entry.byAccountCents[t.account] ?? 0) + cents;
    if (t.occurred_on < entry.firstDate) entry.firstDate = t.occurred_on;
    if (t.occurred_on > entry.lastDate) entry.lastDate = t.occurred_on;
    map.set(label, entry);
  }

  return [...map.entries()]
    .map(([activityLabel, v]) => ({
      activityLabel,
      income: v.incomeCents / 100,
      expense: v.expenseCents / 100,
      net: (v.incomeCents + v.expenseCents) / 100,
      count: v.count,
      byAccount: Object.fromEntries(
        Object.entries(v.byAccountCents).map(([account, cents]) => [account, (cents as number) / 100])
      ) as Partial<Record<Account, number>>,
      firstDate: v.firstDate,
      lastDate: v.lastDate
    }))
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

/** Full-ledger CSV export — treasurer backup, not a family-facing feature.
 *  Voided rows are included and clearly marked, not silently dropped —
 *  this is the offline disaster-recovery copy, so it needs to be complete. */
export function ledgerToCsv(rows: readonly LedgerCsvRow[]): string {
  const header = ['Date', 'Account', 'Kind', 'Method', 'Who', 'Memo', 'Activity', 'Amount', 'Voided'];
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.occurred_on,
        r.account,
        r.kind,
        r.method ?? '',
        r.personName ?? '',
        r.memo ?? '',
        r.activity_label ?? '',
        r.amount.toFixed(2),
        r.voided_at ? 'yes' : ''
      ]
        .map((v) => csvField(String(v)))
        .join(',')
    );
  }
  return lines.join('\n');
}

/** Existing row's shape as far as editTransactionGuard cares. */
export interface EditableRowState {
  voided_at: string | null;
  signup_entry_id: number | null;
  reimbursement_id: number | null;
}

/** Pure guard for editTransactionAction (finance/actions.ts) — "typos happen
 *  all the time" (Patrick, 2026-08-18). Lives here, not in actions.ts,
 *  because every export from a 'use server' file must itself be an async
 *  Server Action (Next.js build-time constraint) — a plain pure function
 *  there fails the build outright, not just the D-049 testability concern
 *  that would otherwise be the only reason to split it out.
 *
 *  Returns an error string, or null when the row is editable. Refuses a
 *  voided row (dead, nothing to correct) and any row already linked to a
 *  signup entry or reimbursement — those are written by their own dedicated
 *  one-writer actions (recordEventFeePaymentAction, markReimbursementPaidAction)
 *  and must stay in sync with THAT source, not be hand-edited out from
 *  under it. */
export function editTransactionGuard(existing: EditableRowState | null): string | null {
  if (!existing) return 'Transaction not found.';
  if (existing.voided_at) return "A voided row can't be edited — record a new transaction instead.";
  if (existing.signup_entry_id) return 'This is an event-fee payment — edit it from the event roster, not here.';
  if (existing.reimbursement_id) return "This is a reimbursement payout — it's tied to the request, not editable here.";
  return null;
}
