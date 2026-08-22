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

export interface EntryMoneyRow {
  entryId: number;
  owed: number;
  paid: number;
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
    const diff = cents(b.owed) - cents(b.paid);
    if (diff > 0) due += diff;
    else over += -diff;
  }
  const byMethod = new Map<string, number>();
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (t.voidedAt) continue;
    const c = cents(t.amount);
    if (t.kind === 'event_fee') {
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

export function money(n: number): string {
  const v = Math.abs(n);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${n < 0 ? '−' : ''}$${s}`;
}
