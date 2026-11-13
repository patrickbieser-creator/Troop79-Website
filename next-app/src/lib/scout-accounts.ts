/**
 * Scout Accounts — the rules behind admin Money › Scout Accounts (2026-11-12): who holds an account, how each
 * holder is marked, the list's filter, and one holder's ledger with a running balance.
 *
 * Patrick: inactive scouts and the Scholarship Fund are listed; adults can hold an account (an aged-out scout keeps
 * hers). Every active scout is listed too, so a scout with nothing yet reads as $0.00 rather than missing. Money is
 * summed in cents. Pure — the server action feeds it rows; the screen and the tests share it.
 */

export type HolderStatus = 'active' | 'webelos' | 'inactive' | 'adult' | 'fund';
export type HolderFilter = 'all' | 'active' | 'inactive' | 'adult';

/** The chip after a holder's name; an active scout has none. */
export const HOLDER_CHIP: Record<HolderStatus, string | null> = {
  active: null,
  webelos: 'Webelos',
  inactive: 'inactive',
  adult: 'adult',
  fund: 'fund'
};

export const SCHOLARSHIP_KEY = 'scholarship';
export const SCHOLARSHIP_NAME = 'Scholarship Fund';

/** Aged out = an adult now; any other inactive reason = a scout who left. A person with no scout row is an adult. */
export function holderStatus(s: { isScout: boolean; active: boolean | null; isWebelos: boolean | null; inactiveReason: string | null }): Exclude<HolderStatus, 'fund'> {
  if (!s.isScout) return 'adult';
  if (s.isWebelos) return 'webelos';
  if (s.active) return 'active';
  return s.inactiveReason === 'aged_out' ? 'adult' : 'inactive';
}

const cents = (n: number) => Math.round(n * 100);

/** Two decimals always (a column of money lines up), negatives in parentheses like the Financial Ledger. */
export function accountMoney(n: number): string {
  const c = cents(n);
  const text = `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return c < 0 ? `(${text})` : text;
}

export interface AccountSummary {
  balance: number;
  income: number;
  /** Positive: the total spent. */
  expenses: number;
  lastOn: string | null;
}

/** Balance, income, expenses and last date of one account's rows; voided rows count for nothing. */
export function summarizeAccount(rows: readonly { amount: number; occurredOn: string; voidedAt: string | null }[]): AccountSummary {
  let inC = 0;
  let outC = 0;
  let lastOn: string | null = null;
  for (const r of rows) {
    if (r.voidedAt) continue;
    const c = cents(r.amount);
    if (c >= 0) inC += c;
    else outC -= c;
    if (lastOn === null || r.occurredOn > lastOn) lastOn = r.occurredOn;
  }
  return { balance: (inC - outC) / 100, income: inC / 100, expenses: outC / 100, lastOn };
}

/** Newest first, each live row carrying the balance after it (rows settle by date, then id); a voided row's is null. */
export function withRunningBalance<T extends { id: number; occurredOn: string; amount: number; voidedAt: string | null }>(
  txns: readonly T[]
): (T & { balanceAfter: number | null })[] {
  const oldestFirst = [...txns].sort((a, b) => (a.occurredOn !== b.occurredOn ? (a.occurredOn < b.occurredOn ? -1 : 1) : a.id - b.id));
  let run = 0;
  const out = oldestFirst.map((t) => {
    if (t.voidedAt) return { ...t, balanceAfter: null };
    run += cents(t.amount);
    return { ...t, balanceAfter: run / 100 };
  });
  return out.reverse();
}

export interface HolderRow {
  /** `p<personId>`, or `scholarship` for the fund. */
  key: string;
  personId: number | null;
  name: string;
  status: HolderStatus;
  /** Has a scout record (active or not) — an aged-out scout is 'adult' but still a scout here. */
  wasScout: boolean;
  balance: number;
  lastOn: string | null;
}

export interface AccountTxnRow {
  account: string;
  personId: number | null;
  amount: number;
  occurredOn: string;
  voidedAt: string | null;
}

/**
 * The list: everyone with a scout-account row, plus every active scout (none yet = $0.00), by name; the Scholarship
 * Fund last. `scouts` is keyed by person id; a person missing from it was never a scout.
 */
export function buildHolderRows(input: {
  txns: readonly AccountTxnRow[];
  people: ReadonlyMap<number, string>;
  scouts: ReadonlyMap<number, { active: boolean; isWebelos: boolean; inactiveReason: string | null }>;
}): HolderRow[] {
  const byPerson = new Map<number, AccountTxnRow[]>();
  const fund: AccountTxnRow[] = [];
  for (const t of input.txns) {
    if (t.account === 'scholarship') fund.push(t);
    else if (t.account === 'scout_account' && t.personId != null) byPerson.set(t.personId, [...(byPerson.get(t.personId) ?? []), t]);
  }
  for (const [personId, s] of input.scouts) {
    if (s.active && !byPerson.has(personId)) byPerson.set(personId, []);
  }
  const people: HolderRow[] = [...byPerson].map(([personId, rows]) => {
    const s = input.scouts.get(personId);
    const sum = summarizeAccount(rows);
    return {
      key: `p${personId}`,
      personId,
      name: input.people.get(personId) ?? `#${personId}`,
      status: holderStatus({ isScout: s != null, active: s?.active ?? null, isWebelos: s?.isWebelos ?? null, inactiveReason: s?.inactiveReason ?? null }),
      wasScout: s != null,
      balance: sum.balance,
      lastOn: sum.lastOn
    };
  });
  people.sort((a, b) => a.name.localeCompare(b.name));
  const f = summarizeAccount(fund);
  return [...people, { key: SCHOLARSHIP_KEY, personId: null, name: SCHOLARSHIP_NAME, status: 'fund', wasScout: false, balance: f.balance, lastOn: f.lastOn }];
}

const IN_FILTER: Record<Exclude<HolderFilter, 'all'>, HolderStatus[]> = {
  active: ['active', 'webelos'],
  inactive: ['inactive'],
  adult: ['adult']
};

/** A filter narrows the people; the fund always stays. */
export function filterHolders(rows: readonly HolderRow[], filter: HolderFilter): HolderRow[] {
  if (filter === 'all') return [...rows];
  return rows.filter((r) => r.status === 'fund' || IN_FILTER[filter].includes(r.status));
}

/** People per filter (the fund is never counted). */
export function holderCounts(rows: readonly HolderRow[]): Record<HolderFilter, number> {
  const people = rows.filter((r) => r.status !== 'fund');
  return {
    all: people.length,
    active: people.filter((r) => IN_FILTER.active.includes(r.status)).length,
    inactive: people.filter((r) => IN_FILTER.inactive.includes(r.status)).length,
    adult: people.filter((r) => IN_FILTER.adult.includes(r.status)).length
  };
}

/** The memo on the row that moves a departed scout's balance to the troop's general fund. */
export const MOVE_TO_TROOP_MEMO = 'Balance moved to the troop fund';

/**
 * Who may have their balance moved to the troop's general fund (Patrick, 2026-11-12: "transfer the funds of
 * inactive scouts into the general troop fund"): a scout who is no longer active — left, moved away, transferred or
 * aged out — with money in the account. Null = allowed; otherwise the reason it is not.
 */
export function canMoveToTroop(h: { status: HolderStatus; wasScout: boolean; balance: number }): string | null {
  if (h.status === 'fund') return 'The Scholarship Fund is not a scout account.';
  if (!h.wasScout) return 'Only a scout’s account can be moved to the troop fund.';
  if (h.status === 'active') return 'This scout is still active.';
  if (h.status === 'webelos') return 'A Webelos is not a departed scout.';
  if (Math.round(h.balance * 100) <= 0) return 'There is nothing to move — the balance is $0.00 or less.';
  return null;
}
