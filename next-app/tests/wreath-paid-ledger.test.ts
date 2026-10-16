import { describe, it, expect } from 'vitest';
import { paidLedgerRow } from '../src/lib/wreaths/rules';

/**
 * Marking a wreath order paid books the money into the troop finance ledger (Patrick, 2026-10-15). The row follows
 * the treasurer's existing fundraiser convention — checking, kind fundraiser, activity "Wreaths 'YY" (as "Wreaths '25"),
 * PayPal recorded as method `other` with PayPal named in the memo (the ledger has no paypal method).
 */
const base = { orderNumber: 'W-1001', customerName: 'Sara Zirbel', total: 37, method: 'venmo' as const, saleYear: 2026, today: '2026-10-20' };

describe('paidLedgerRow', () => {
  it('Treasurer_SeesCheckingIncomeForTheOrderTotal', () => {
    const row = paidLedgerRow(base);
    expect([row.account, row.amount, row.kind]).toEqual(['checking', 37, 'fundraiser']);
  });

  it('Treasurer_SeesTheSaleYearActivityLabel', () => {
    expect(paidLedgerRow(base).activity_label).toBe("Wreaths '26");
  });

  it('Treasurer_SeesTheDayItWasMarkedPaid', () => {
    expect(paidLedgerRow(base).occurred_on).toBe('2026-10-20');
  });

  it('Treasurer_SeesOrderNumberCustomerAndMethodInTheMemo', () => {
    expect(paidLedgerRow(base).memo).toBe('Wreath order W-1001 · Sara Zirbel · Venmo');
  });

  it('Treasurer_SeesPayPalAsOtherMethod_NamedInTheMemo', () => {
    const row = paidLedgerRow({ ...base, method: 'paypal' });
    expect([row.method, row.memo.endsWith('PayPal')]).toEqual(['other', true]);
  });

  it('Treasurer_SeesCashCheckAndVenmoAsTheirOwnMethods', () => {
    expect((['cash', 'check', 'venmo'] as const).map((m) => paidLedgerRow({ ...base, method: m }).method)).toEqual(['cash', 'check', 'venmo']);
  });

  it('Treasurer_SeesNoRow_WhenTheOrderTotalIsZero', () => {
    expect(() => paidLedgerRow({ ...base, total: 0 })).toThrow(/zero/i);
  });
});
