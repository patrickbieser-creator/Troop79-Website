import { describe, it, expect } from 'vitest';
import { paidLedgerRow } from '../src/lib/wreaths/rules';

/**
 * Marking a wreath order paid books the money into the troop finance ledger (Patrick, 2026-10-15). The row follows
 * the treasurer's existing fundraiser convention — checking, kind fundraiser, activity "Wreaths 'YY" (as "Wreaths '25").
 * Every wreath payment method is also a ledger method (PayPal joined the ledger 2026-10-05), so it carries straight over.
 */
const base = { orderNumber: 'W-1001', customerName: 'Sara Zirbel', total: 37, method: 'venmo' as const, saleYear: 2026, today: '2026-10-20' };

describe('paidLedgerRow', () => {
  it('Treasurer_SeesCheckingIncomeForTheOrderTotal', () => {
    const row = paidLedgerRow(base);
    expect([row.account, row.amount, row.kind]).toEqual(['checking', 37, 'fundraiser']);
  });

  it('Treasurer_SeesTheSaleYearActivityLabel', () => {
    expect(paidLedgerRow(base).bucket).toBe("Wreaths '26");
  });

  it('Treasurer_SeesTheDayItWasMarkedPaid', () => {
    expect(paidLedgerRow(base).occurred_on).toBe('2026-10-20');
  });

  it('Treasurer_SeesOrderNumberCustomerAndMethodInTheMemo', () => {
    expect(paidLedgerRow(base).memo).toBe('Wreath order W-1001 · Sara Zirbel · Venmo');
  });

  it('Treasurer_SeesEveryPaymentMethodAsTheSameLedgerMethod', () => {
    const methods = ['venmo', 'paypal', 'cash', 'check', 'other'] as const;
    expect(methods.map((m) => paidLedgerRow({ ...base, method: m }).method)).toEqual([...methods]);
  });

  it('Treasurer_SeesNoRow_WhenTheOrderTotalIsZero', () => {
    expect(() => paidLedgerRow({ ...base, total: 0 })).toThrow(/zero/i);
  });
});
