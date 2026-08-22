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

/**
 * The PostgREST `.or()` filter string for an amount MAGNITUDE range search
 * (the ledger's Min $/Max $ filter, 2026-08-20) — "between $50 and $200"
 * means a $75 expense or a $75 payment both match, not just one side of
 * zero. `null` return means the caller needs no OR: a non-positive `min`
 * has nothing to exclude near zero, so a plain symmetric
 * `.gte(-max).lte(max)` already expresses "magnitude at most max" — the OR
 * form is only needed once there's a real lower bound pushing the match
 * away from zero in both directions. Split out for testability: this is a
 * hand-built PostgREST filter string, exactly the kind of thing that's
 * silently wrong in a way tests catch and manual review doesn't.
 */
export function amountRangeOrFilter(min: number, max: number | null): string | null {
  if (min <= 0) return null;
  if (max != null) return `and(amount.gte.${min},amount.lte.${max}),and(amount.gte.${-max},amount.lte.${-min})`;
  return `amount.gte.${min},amount.lte.${-min}`;
}

/** Must stay in lockstep with financial_transactions' `account` check constraint. */
export const ACCOUNTS = ['checking', 'savings', 'scout_account', 'scholarship', 'sofi'] as const;
export type Account = (typeof ACCOUNTS)[number];

/**
 * A governed lookup (`transaction_kinds`, 2026-08-20), not a hardcoded set —
 * same pattern as calendar_categories: a real DB table, code as primary key
 * AND the value stored on financial_transactions.kind (ON UPDATE CASCADE, so
 * a rename propagates for free; ON DELETE RESTRICT, so a kind still in use
 * can't be removed). Kind carries no direction/behavior of its own — a
 * reconciliation/reporting tag only — so unlike Account (a truly fixed,
 * small set baked into application logic), new Kinds can be added from the
 * admin UI without a deploy. `string`, not a literal union: the set is no
 * longer known at compile time. Load the current rows with
 * listTransactionKindsAction() (finance/actions.ts).
 */
export type TransactionKind = string;

export interface TransactionKindRow {
  code: string;
  label: string;
  sort_order: number;
}

/** Must stay in lockstep with financial_transactions' `method` check constraint.
 *  No 'online' value — no payment processing in this build (deferred, not rejected). */
export const TRANSACTION_METHODS = ['venmo', 'check', 'cash', 'scout_account', 'bank', 'other'] as const;
export type TransactionMethod = (typeof TRANSACTION_METHODS)[number];

export function isAccount(value: string): value is Account {
  return (ACCOUNTS as readonly string[]).includes(value);
}

/**
 * Kind carries NO implied direction, on purpose — removed 2026-08-20 after
 * it caused a real bug. Kind and Direction used to overlap (Patrick,
 * 2026-08-19: "there is an overlap between Kind and direction... Expense
 * should not be listed in both places"), and the fix at the time was to
 * have the Record/Edit forms auto-set Direction from Kind and warn on a
 * mismatch. That auto-set was itself the bug: it meant recategorizing a
 * transaction's Kind (a pure label change) could silently flip its signed
 * amount — and did, on a real transaction, corrupting the computed balance
 * with no warning at all (the auto-set fires FROM the mismatch, so there was
 * never a moment to see one).
 *
 * The balance (computeBalance, below) has only ever summed the signed
 * `amount` — Kind was already irrelevant to it. Removing the auto-set makes
 * that true in the UI too: Kind is purely a tag for reconciliation and
 * sorting; Direction (the sign of `amount`) is the only thing that decides
 * money in vs. out, full stop, everywhere.
 */

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
  /** Who entered this row and when — surfaced 2026-08-19. Both null for
   *  every historical import row (the import script never stamped an
   *  actor); populated on everything entered through the app since. */
  enteredByName: string | null;
  enteredAt: string | null;
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
  const header = [
    'Date',
    'Account',
    'Kind',
    'Method',
    'Who',
    'Memo',
    'Activity',
    'Amount',
    'Voided',
    'Entered By',
    'Entered At'
  ];
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
        r.voided_at ? 'yes' : '',
        r.enteredByName ?? '',
        r.enteredAt ?? ''
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

/** Pure validation for renameActivityAction (finance/actions.ts) — same
 *  D-049 split as editTransactionGuard, and the same reason: every export
 *  from a 'use server' file must itself be a Server Action, so the part
 *  that decides whether a rename/merge is even sensible lives here where it
 *  can be tested directly, not only indirectly through a DB call.
 *  Returns an error string, or null when the rename/merge may proceed. */
export function validateActivityRename(sourceLabel: string, targetLabel: string): string | null {
  const target = targetLabel.trim();
  if (!sourceLabel.trim() || !target) return 'Both a source and a target activity are required.';
  // Compared the same way the rename itself matches (renameActivityAction:
  // untrimmed source, trimmed target) — NOT trim(source) === trim(target).
  // sourceLabel is a real stored activity_label value that may itself carry
  // stray whitespace; trimming it here before comparing would wrongly
  // refuse a legitimate whitespace-cleanup rename ("Can Drive " -> "Can Drive")
  // as a no-op, when it's exactly the rename being asked for.
  if (sourceLabel === target) return 'Source and target are already the same.';
  return null;
}

/* ── Running Total Funds (Financial Ledger column, 2026-08-21) ─────────── */

/** The accounts whose sum is "Total funds" — same definition as the balance
 *  card at the top of /admin/finance (checking + savings; scout accounts,
 *  scholarship and sofi are earmarked or external and don't count). */
export const TOTAL_FUNDS_ACCOUNTS: readonly Account[] = ['checking', 'savings'];

export interface RunningFundsInputRow {
  id: number;
  occurred_on: string;
  account: Account;
  amount: number;
  voided_at: string | null;
}

/** One point on the cumulative series: total funds right AFTER row `id`. */
export interface RunningFundsPoint {
  occurred_on: string;
  id: number;
  balance: number;
}

/** Chronological comparator — occurred_on (YYYY-MM-DD sorts lexically),
 *  then id. Matches the ledger's own `.order(date).order('id')` tiebreak so
 *  a page read top-down in the default sort stays monotone. */
function chronoCompare(a: { occurred_on: string; id: number }, b: { occurred_on: string; id: number }): number {
  if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? -1 : 1;
  return a.id - b.id;
}

/**
 * The FULL checking+savings history → cumulative "total funds after this
 * row" series, sorted chronologically. Voided rows and every other account
 * are dropped — they don't move the number. Integer-cent accumulation, same
 * reason as computeBalance.
 */
export function buildRunningFunds(rows: readonly RunningFundsInputRow[]): RunningFundsPoint[] {
  const relevant = rows
    .filter((r) => r.voided_at === null && TOTAL_FUNDS_ACCOUNTS.includes(r.account))
    .slice()
    .sort(chronoCompare);
  let cents = 0;
  return relevant.map((r) => {
    cents += Math.round(r.amount * 100);
    return { occurred_on: r.occurred_on, id: r.id, balance: cents / 100 };
  });
}

/**
 * Total funds as of ANY ledger row (by its chronological position) — the
 * balance after the last series point at or before (occurred_on, id), or 0
 * before the first. Binary search over the sorted series; a scout_account
 * or scholarship row simply reads the funds as they stood at that moment,
 * so the column stays continuous instead of blanking on non-funds rows.
 */
export function runningFundsAsOf(
  series: readonly RunningFundsPoint[],
  at: { occurred_on: string; id: number }
): number {
  let lo = 0;
  let hi = series.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chronoCompare(series[mid], at) <= 0) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? 0 : series[found].balance;
}

/* ── Kind pill tints (2026-08-21) ───────────────────────────────────────── */

/** Size of the indexed categorical tint scale in admin.css
 *  (`--admin-cat-1-bg` … `--admin-cat-N-bg`, each with a `-fg` pair). */
export const KIND_TINT_COUNT = 8;

/**
 * 1-based tint slot for a Kind, by its position in the governed
 * transaction_kinds list (sort_order), wrapping past KIND_TINT_COUNT; 0 for
 * a code not in the list (neutral gray). Index-based rather than hashed so
 * the first KIND_TINT_COUNT kinds are guaranteed pairwise distinct — the
 * whole point is telling them apart at a glance — at the cost that deleting
 * a Kind shifts the ones after it (acceptable: the list is small and rarely
 * edited).
 */
export function kindTintIndex(kinds: readonly { code: string }[], code: string): number {
  const i = kinds.findIndex((k) => k.code === code);
  if (i === -1) return 0;
  return (i % KIND_TINT_COUNT) + 1;
}
