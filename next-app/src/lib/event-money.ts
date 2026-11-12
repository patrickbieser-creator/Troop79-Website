/**
 * Event money — the campout sheet's bottom-right block as pure functions
 * (Plans/Event-Logistics.md §C, Patrick 2026-08-22): per-person owed / paid /
 * balance (many payments, refunds, credits), income by method, expenses,
 * reimbursements due, P&L, and milestone status ("behind" on a deposit
 * schedule). Balances are always derived (D-134) — `signup_entry_balances`
 * in SQL, these helpers over its rows in code. Cents arithmetic throughout,
 * same reason as lib/finance.ts computeBalance.
 */

export const ROUND = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

/** Accounts that are notional sub-ledgers (per-scout balances, the
 *  scholarship fund): a fee paid FROM one is a NEGATIVE row on that account
 *  (the balance goes down), and the event sees it as +paid. Checking rows are
 *  cash and carry the event's sign directly. */
export const NOTIONAL_ACCOUNTS = ['scout_account', 'scholarship'] as const;
export function isNotionalAccount(account: string | null | undefined): boolean {
  return account === 'scout_account' || account === 'scholarship';
}
/** The amount as the EVENT sees it: notional-account fee rows flipped. */
export function feeAmount(t: { amount: number; kind: string; account?: string | null }): number {
  return t.kind === 'event_fee' && isNotionalAccount(t.account) ? -t.amount : t.amount;
}
/** Whose scout account a refund should default to: the family member whose
 *  account made the latest live payment on the entry, or null (the attendee's
 *  own) when none did. Rows are in date order, as the Money tab holds them. */
export function refundAccountDefault(
  transactions: readonly { amount: number; kind: string; voidedAt: string | null; accountPersonId: number | null }[]
): number | null {
  const paid = transactions.filter((t) => !t.voidedAt && t.kind === 'event_fee' && t.amount > 0 && t.accountPersonId != null);
  return paid.length > 0 ? paid[paid.length - 1].accountPersonId : null;
}
/** A payment method as offered on the Money tab — the ledger's methods plus the scholarship fund (stored as account
 *  'scholarship', method 'other'). The one label map for the tab: the method switch, the ledger's Method column, the
 *  By-method line and the history all read it. */
export type PayMethod = 'venmo' | 'paypal' | 'check' | 'cash' | 'scout_account' | 'scholarship' | 'bank' | 'other';
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  venmo: 'Venmo',
  paypal: 'PayPal',
  check: 'Check',
  cash: 'Cash',
  scout_account: 'Scout account',
  scholarship: 'Scholarship fund',
  bank: 'Bank transfer',
  other: 'Other'
};
export const methodLabel = (m: string | null | undefined): string => (m ? (PAY_METHOD_LABEL[m as PayMethod] ?? m) : '—');

/** The four methods the Money tab offers directly (Plans/Event-Money-Ledger-Redesign.md); the rest sit under Other ▾. */
export const PRIMARY_PAY_METHODS = ['venmo', 'paypal', 'cash', 'check'] as const satisfies readonly PayMethod[];
export const OTHER_PAY_METHODS = ['scout_account', 'scholarship', 'bank', 'other'] as const satisfies readonly PayMethod[];

/** The summary band's "By method" line: the four primary methods always (so "$0 PayPal" is a fact, not a gap),
 *  any other only when money moved through it. */
export function byMethodLine(incomeByMethod: Record<string, number>): { method: string; label: string; amount: number }[] {
  const primary = PRIMARY_PAY_METHODS.map((m) => ({ method: m as string, label: methodLabel(m), amount: incomeByMethod[m] ?? 0 }));
  const others = Object.entries(incomeByMethod)
    .filter(([m, v]) => !(PRIMARY_PAY_METHODS as readonly string[]).includes(m) && cents(v) !== 0)
    .map(([m, v]) => ({ method: m, label: methodLabel(m), amount: v }));
  return [...primary, ...others];
}

/** Who recorded or voided a row, as the history signs it: their sign-off initials, else "First L." (never guessed
 *  initials — "KP" could be another leader's code). */
export function signOffName(code: string | null | undefined, name: { first: string | null; last: string | null; display: string }): string {
  if (code) return code;
  const parts = name.display.trim().split(/\s+/);
  const first = name.first?.trim() || parts[0] || '';
  const last = name.last?.trim() || (parts.length > 1 ? parts[parts.length - 1] : '');
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/** What one person owes, as the panel's switch reads it: the tier, a custom amount, or Not paying (override 0). */
export type AmountMode = 'tier' | 'custom' | 'none';
export function amountMode(amountOverride: number | null): AmountMode {
  return amountOverride == null ? 'tier' : cents(amountOverride) === 0 ? 'none' : 'custom';
}
export const AMOUNT_MODE_LABEL: Record<AmountMode, string> = { tier: 'Tier', custom: 'Custom', none: 'Not paying' };

/** The ledger's Status badge — what they owe and where they stand. "Not going" is the sign-up status and shows on the
 *  name, not here: someone not going may still owe a deposit, and someone going may be Not paying (Patrick,
 *  2026-11-12: separate facts). */
export function ledgerStatus(
  p: { owed: number; paid: number; balance: number; amountOverride: number | null },
  standing: MilestoneStanding,
  shortBy: number,
  hasPaymentSchedule: boolean
): { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'muted' } {
  if (cents(p.owed) === 0) {
    if (cents(p.balance) < 0) return { label: `Overpaid · ${money(-p.balance)}`, variant: 'danger' };
    return p.amountOverride != null ? { label: 'Not paying', variant: 'muted' } : { label: 'Nothing owed', variant: 'muted' };
  }
  if (standing === 'settled') return { label: 'Paid', variant: 'success' };
  if (standing === 'behind') return { label: `Behind · ${money(shortBy)}`, variant: 'danger' };
  if (hasPaymentSchedule) return { label: 'On schedule', variant: 'info' };
  return { label: `${money(p.balance)} due`, variant: 'warning' };
}

export interface EntryMoneyRow {
  entryId: number;
  owed: number;
  paid: number;
  /** The view's balance (owed − paid + credited). When present it is the
   *  truth for due / overpaid; owed − paid is the fallback for old callers. */
  balance?: number;
}

export interface MoneyTransaction {
  id: number;
  occurredOn: string;
  amount: number;
  kind: string;
  method: string | null;
  memo: string | null;
  voidedAt: string | null;
  signupEntryId: number | null;
  personId: number | null;
}

export interface EventMoneyTotals {
  owed: number;
  paid: number;
  /** Σ max(owed − paid, 0) — what is still due. */
  due: number;
  /** Σ max(paid − owed, 0) — overpayments not yet credited/refunded. */
  overpaid: number;
  /** Income by method, event_fee rows only, refunds netted. */
  incomeByMethod: Record<string, number>;
  income: number;
  /** Expenses as a positive number (rows are stored negative). */
  expenses: number;
  /** Approved-or-submitted reimbursement requests not yet paid. */
  reimbursementsPending: number;
  /** income − expenses − reimbursementsPending. Negative = cost to the troop. */
  net: number;
}

export function summarizeEventMoney(
  balances: readonly EntryMoneyRow[],
  transactions: readonly MoneyTransaction[],
  pendingReimbursements: readonly { amount: number }[]
): EventMoneyTotals {
  let owed = 0, paid = 0, due = 0, over = 0;
  for (const b of balances) {
    owed += cents(b.owed);
    paid += cents(b.paid);
    const diff = b.balance != null ? cents(b.balance) : cents(b.owed) - cents(b.paid);
    if (diff > 0) due += diff;
    else over += -diff;
  }
  const byMethod = new Map<string, number>();
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (t.voidedAt) continue;
    const c = cents(t.amount);
    // A fee row with no signup entry is not anyone's fee (an imported
    // "Paid to Jason; Reservation" row) — it falls through to sign-based.
    if (t.kind === 'event_fee' && t.signupEntryId != null) {
      income += c;
      const m = t.method ?? 'other';
      byMethod.set(m, (byMethod.get(m) ?? 0) + c);
    } else if (t.kind === 'expense' || t.kind === 'reimbursement') {
      expenses += -c; // stored negative
    } else if (c > 0) {
      income += c; // other income tagged to the event (donation, fundraiser)
      byMethod.set(t.method ?? 'other', (byMethod.get(t.method ?? 'other') ?? 0) + c);
    } else {
      expenses += -c;
    }
  }
  const pending = pendingReimbursements.reduce((n, r) => n + cents(r.amount), 0);
  return {
    owed: owed / 100,
    paid: paid / 100,
    due: due / 100,
    overpaid: over / 100,
    incomeByMethod: Object.fromEntries([...byMethod.entries()].map(([k, v]) => [k, v / 100])),
    income: income / 100,
    expenses: expenses / 100,
    reimbursementsPending: pending / 100,
    net: (income - expenses - pending) / 100
  };
}

export interface Milestone {
  id: number;
  kind: 'payment' | 'registration' | 'form' | 'other';
  label: string;
  dueOn: string; // YYYY-MM-DD
  amount: number | null;
  appliesTo: 'scouts' | 'adults' | 'both';
}

/** The Money tab offers "Record payment" until the person is paid in full
 *  (Patrick, 2026-10-17), and never when nothing is owed — the same rule as the
 *  Roster tab's Record. An overpayment is fixed with Refund, not another payment. */
export function canRecordPayment(person: { owed: number; paid: number }): boolean {
  return person.owed > 0 && cents(person.paid) < cents(person.owed);
}

/** How a person paid, for the Money tab's listing: each method once (first
 *  use order) and the date of the latest payment. Refunds, voids and credits
 *  are not payments. */
export function paymentSummary(
  transactions: readonly { amount: number; kind: string; method: string | null; occurredOn: string; voidedAt: string | null }[]
): { methods: string[]; lastOn: string | null } {
  const methods: string[] = [];
  let lastOn: string | null = null;
  for (const t of transactions) {
    if (t.voidedAt || t.kind !== 'event_fee' || !(t.amount > 0)) continue;
    const m = t.method ?? 'other';
    if (!methods.includes(m)) methods.push(m);
    if (lastOn == null || t.occurredOn > lastOn) lastOn = t.occurredOn;
  }
  return { methods, lastOn };
}

export type MilestoneStanding = 'behind' | 'on_track' | 'settled' | 'n/a';

/**
 * Where one person stands against the payment schedule as of `today`:
 *   behind   — paid < Σ amounts of payment milestones due on or before today
 *   on_track — caught up (or nothing due yet) but not fully paid
 *   settled  — paid ≥ owed (owed > 0)
 *   n/a      — owes nothing
 * The schedule never asks for more than what's owed: a $300 deposit on a
 * $250 override is "behind" at $250 owed, not $300.
 */
export function milestoneStanding(
  person: { owed: number; paid: number; isScout: boolean },
  milestones: readonly Milestone[],
  today: string
): { standing: MilestoneStanding; dueByToday: number; shortBy: number } {
  if (person.owed <= 0) return { standing: 'n/a', dueByToday: 0, shortBy: 0 };
  if (cents(person.paid) >= cents(person.owed)) return { standing: 'settled', dueByToday: 0, shortBy: 0 };
  const applicable = milestones.filter(
    (m) =>
      m.kind === 'payment' &&
      m.amount != null &&
      m.dueOn <= today &&
      (m.appliesTo === 'both' || (m.appliesTo === 'scouts') === person.isScout)
  );
  const scheduled = applicable.reduce((n, m) => n + cents(m.amount as number), 0);
  const dueByToday = Math.min(scheduled, cents(person.owed));
  const shortBy = Math.max(0, dueByToday - cents(person.paid));
  return {
    standing: shortBy > 0 ? 'behind' : 'on_track',
    dueByToday: dueByToday / 100,
    shortBy: shortBy / 100
  };
}

/** Upcoming-first ordering for the public list and the Money tab. */
export function sortMilestones<T extends { dueOn: string; sort?: number }>(ms: readonly T[]): T[] {
  return [...ms].sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : (a.sort ?? 0) - (b.sort ?? 0)));
}

/** How much of an overpayment has NOT yet been credited to the scout account.
 *  Since migration 20260823100000 the balances view nets credits
 *  (balance = owed − paid + credited), so this is simply max(0, −balance):
 *  a fully credited overpayment reads 0 → no Credit button, and the server
 *  refuses a second credit (Patrick, 2026-08-22: three clicks, three $30
 *  credits, one overpayment; then "shouldn't the balance be zero?" — yes). */
export function uncreditedOverpayment(balance: number): number {
  return Math.max(0, cents(-balance)) / 100;
}

export function money(n: number): string {
  const v = Math.abs(n);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${n < 0 ? '−' : ''}$${s}`;
}
