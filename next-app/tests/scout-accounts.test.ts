import { describe, it, expect } from 'vitest';
import {
  accountMoney,
  canMoveToTroop,
  buildHolderRows,
  filterHolders,
  holderCounts,
  holderStatus,
  summarizeAccount,
  withRunningBalance,
  type HolderRow
} from '../src/lib/scout-accounts';

/**
 * Scout Accounts (admin Money › Scout Accounts, 2026-11-12): who holds an account, how each holder is marked, the
 * list's filter, and a holder's ledger with a running balance. Patrick: inactive scouts and the Scholarship Fund are
 * listed; adults can hold an account (Maya, an aged-out scout).
 */
describe('holderStatus', () => {
  it('an active scout is active', () => {
    expect(holderStatus({ isScout: true, active: true, isWebelos: false, inactiveReason: null })).toBe('active');
  });
  it('a Webelos is webelos', () => {
    expect(holderStatus({ isScout: true, active: false, isWebelos: true, inactiveReason: null })).toBe('webelos');
  });
  it('an aged-out scout is an adult', () => {
    expect(holderStatus({ isScout: true, active: false, isWebelos: false, inactiveReason: 'aged_out' })).toBe('adult');
  });
  it('a scout who left for another reason is inactive', () => {
    expect(holderStatus({ isScout: true, active: false, isWebelos: false, inactiveReason: 'moved_away' })).toBe('inactive');
  });
  it('a person who was never a scout is an adult', () => {
    expect(holderStatus({ isScout: false, active: null, isWebelos: null, inactiveReason: null })).toBe('adult');
  });
});

describe('accountMoney', () => {
  it('shows two decimals with thousands separators', () => {
    expect(accountMoney(1234.5)).toBe('$1,234.50');
  });
  it('shows a negative in parentheses', () => {
    expect(accountMoney(-12)).toBe('($12.00)');
  });
  it('shows zero as $0.00, never negative zero', () => {
    expect(accountMoney(-0.004)).toBe('$0.00');
  });
});

describe('summarizeAccount', () => {
  const rows = [
    { amount: 93.6, occurredOn: '2023-11-10', voidedAt: null },
    { amount: -15, occurredOn: '2024-07-31', voidedAt: null },
    { amount: 55.65, occurredOn: '2024-11-10', voidedAt: null },
    { amount: -500, occurredOn: '2026-01-01', voidedAt: '2026-01-02T00:00:00Z' }
  ];
  it('balance is the sum of live rows, to the cent', () => {
    expect(summarizeAccount(rows).balance).toBe(134.25);
  });
  it('income and expenses ignore voided rows', () => {
    const s = summarizeAccount(rows);
    expect([s.income, s.expenses]).toEqual([149.25, 15]);
  });
  it('last date is the latest live row', () => {
    expect(summarizeAccount(rows).lastOn).toBe('2024-11-10');
  });
  it('an account with no rows has no last date', () => {
    expect(summarizeAccount([])).toEqual({ balance: 0, income: 0, expenses: 0, lastOn: null });
  });
});

describe('withRunningBalance', () => {
  const txns = [
    { id: 3, occurredOn: '2024-11-10', amount: 55.65, voidedAt: null },
    { id: 1, occurredOn: '2023-11-10', amount: 93.6, voidedAt: null },
    { id: 9, occurredOn: '2024-08-01', amount: -40, voidedAt: '2024-08-02T00:00:00Z' },
    { id: 2, occurredOn: '2024-07-31', amount: -15, voidedAt: null }
  ];
  it('lists newest first', () => {
    expect(withRunningBalance(txns).map((t) => t.id)).toEqual([3, 9, 2, 1]);
  });
  it('each live row carries the balance after it', () => {
    expect(withRunningBalance(txns).map((t) => t.balanceAfter)).toEqual([134.25, null, 78.6, 93.6]);
  });
  it('rows on the same day settle in id order', () => {
    const same = withRunningBalance([
      { id: 5, occurredOn: '2025-01-01', amount: -10, voidedAt: null },
      { id: 4, occurredOn: '2025-01-01', amount: 30, voidedAt: null }
    ]);
    expect(same.map((t) => [t.id, t.balanceAfter])).toEqual([
      [5, 20],
      [4, 30]
    ]);
  });
});

describe('buildHolderRows', () => {
  const rows = buildHolderRows({
    txns: [
      { account: 'scout_account', personId: 10, amount: 109.49, occurredOn: '2025-07-13', voidedAt: null },
      { account: 'scout_account', personId: 24, amount: 108.81, occurredOn: '2025-12-20', voidedAt: null },
      { account: 'scout_account', personId: 7, amount: 5, occurredOn: '2026-01-01', voidedAt: null },
      { account: 'scholarship', personId: null, amount: 760.77, occurredOn: '2026-07-18', voidedAt: null },
      { account: 'checking', personId: 7, amount: 999, occurredOn: '2026-07-18', voidedAt: null }
    ],
    people: new Map([
      [10, 'Jasper Stollenwerk'],
      [24, 'Maya Sankpal-Tatera'],
      [7, 'Ann Active'],
      [8, 'Ben Nohistory']
    ]),
    scouts: new Map([
      [10, { active: false, isWebelos: false, inactiveReason: 'moved_away' }],
      [24, { active: false, isWebelos: false, inactiveReason: 'aged_out' }],
      [7, { active: true, isWebelos: false, inactiveReason: null }],
      [8, { active: true, isWebelos: false, inactiveReason: null }],
      [9, { active: false, isWebelos: false, inactiveReason: 'dropped_out' }]
    ])
  });

  it('lists account holders and active scouts by name, the Scholarship Fund last', () => {
    expect(rows.map((r) => r.name)).toEqual(['Ann Active', 'Ben Nohistory', 'Jasper Stollenwerk', 'Maya Sankpal-Tatera', 'Scholarship Fund']);
  });
  it('marks each holder', () => {
    expect(rows.map((r) => r.status)).toEqual(['active', 'active', 'inactive', 'adult', 'fund']);
  });
  it('counts only scout-account money for a person', () => {
    expect(rows.find((r) => r.personId === 7)?.balance).toBe(5);
  });
  it('an active scout with no history shows $0 and no date', () => {
    const ben = rows.find((r) => r.personId === 8)!;
    expect([ben.balance, ben.lastOn]).toEqual([0, null]);
  });
  it('the fund row is keyed by its account', () => {
    expect(rows.at(-1)).toMatchObject({ key: 'scholarship', personId: null, balance: 760.77, lastOn: '2026-07-18' });
  });
});

describe('filterHolders', () => {
  const rows: HolderRow[] = [
    { key: 'p1', personId: 1, name: 'A', status: 'active', wasScout: true, balance: 1, lastOn: null },
    { key: 'p2', personId: 2, name: 'B', status: 'webelos', wasScout: true, balance: 0, lastOn: null },
    { key: 'p3', personId: 3, name: 'C', status: 'inactive', wasScout: true, balance: 2, lastOn: null },
    { key: 'p4', personId: 4, name: 'D', status: 'adult', wasScout: true, balance: 3, lastOn: null },
    { key: 'scholarship', personId: null, name: 'Scholarship Fund', status: 'fund', wasScout: false, balance: 9, lastOn: null }
  ];
  it('Active includes Webelos and keeps the fund', () => {
    expect(filterHolders(rows, 'active').map((r) => r.key)).toEqual(['p1', 'p2', 'scholarship']);
  });
  it('Inactive keeps the fund', () => {
    expect(filterHolders(rows, 'inactive').map((r) => r.key)).toEqual(['p3', 'scholarship']);
  });
  it('Adults keeps the fund', () => {
    expect(filterHolders(rows, 'adult').map((r) => r.key)).toEqual(['p4', 'scholarship']);
  });
  it('counts people per filter, never the fund', () => {
    expect(holderCounts(rows)).toEqual({ all: 4, active: 2, inactive: 1, adult: 1 });
  });
});

describe('canMoveToTroop', () => {
  it('a scout who left may move a positive balance', () => {
    expect(canMoveToTroop({ status: 'inactive', wasScout: true, balance: 109.49 })).toBeNull();
  });
  it('an aged-out scout may move a positive balance', () => {
    expect(canMoveToTroop({ status: 'adult', wasScout: true, balance: 108.81 })).toBeNull();
  });
  it('an active scout may not', () => {
    expect(canMoveToTroop({ status: 'active', wasScout: true, balance: 50 })).toMatch(/active/);
  });
  it('a Webelos may not', () => {
    expect(canMoveToTroop({ status: 'webelos', wasScout: true, balance: 50 })).toMatch(/Webelos/);
  });
  it('an adult who was never a scout may not', () => {
    expect(canMoveToTroop({ status: 'adult', wasScout: false, balance: 50 })).toMatch(/scout/);
  });
  it('nothing to move at zero or below', () => {
    expect(canMoveToTroop({ status: 'inactive', wasScout: true, balance: 0 })).toMatch(/nothing/i);
  });
});
