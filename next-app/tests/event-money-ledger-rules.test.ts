import { describe, it, expect } from 'vitest';
import { fmtDate } from '../src/lib/format-date';
import { byMethodLine, PRIMARY_PAY_METHODS, signOffName, amountMode, ledgerStatus } from '../src/lib/event-money';

/** The pure pieces of the Money tab redesign (Plans/Event-Money-Ledger-Redesign.md). */
describe('Money tab rules', () => {
  it('PaidOn_UsesTheShortYear', () => {
    expect(fmtDate('2026-11-12', { year: 'short' })).toBe('Nov 12, ’26');
  });

  it('PrimaryMethods_AreVenmoPayPalCashCheck', () => {
    expect(PRIMARY_PAY_METHODS).toEqual(['venmo', 'paypal', 'cash', 'check']);
  });

  it('ByMethod_ShowsTheFourPrimaryMethods_WhenOnlyVenmoUsed', () => {
    expect(byMethodLine({ venmo: 105 })).toEqual([
      { method: 'venmo', label: 'Venmo', amount: 105 },
      { method: 'paypal', label: 'PayPal', amount: 0 },
      { method: 'cash', label: 'Cash', amount: 0 },
      { method: 'check', label: 'Check', amount: 0 }
    ]);
  });

  it('ByMethod_ShowsAnotherMethod_OnlyWhenNonZero', () => {
    expect(byMethodLine({ venmo: 20, scout_account: 25, bank: 0 }).map((m) => m.label)).toEqual([
      'Venmo',
      'PayPal',
      'Cash',
      'Check',
      'Scout account'
    ]);
  });

  it('SignOffName_UsesInitials_WhenThePersonHasThem', () => {
    expect(signOffName('KPD', { first: 'Kara', last: 'Pitt DAndrea', display: 'Kara Pitt DAndrea' })).toBe('KPD');
  });

  it('SignOffName_FallsBackToFirstNameAndLastInitial', () => {
    expect(signOffName(null, { first: 'Kara', last: 'Pitt', display: 'Kara Pitt' })).toBe('Kara P.');
  });

  it('SignOffName_FromADisplayNameOnly', () => {
    expect(signOffName(null, { first: null, last: null, display: 'Edie Pasek' })).toBe('Edie P.');
  });

  it('AmountMode_TierCustomOrNotPaying', () => {
    expect([amountMode(null), amountMode(20), amountMode(0)]).toEqual(['tier', 'custom', 'none']);
  });

  it('LedgerStatus_NotPaying_IsAboutMoneyOnly', () => {
    // "Not going" is the sign-up status, shown on the name; the badge says what they owe (Patrick, 2026-11-12).
    const base = { owed: 0, paid: 0, balance: 0 };
    expect([
      ledgerStatus({ ...base, amountOverride: 0 }, 'n/a', 0, false).label,
      ledgerStatus({ ...base, amountOverride: null }, 'n/a', 0, false).label
    ]).toEqual(['Not paying', 'Nothing owed']);
  });

  it('LedgerStatus_ShowsAnOverpayment_WhenNothingIsOwed', () => {
    expect(ledgerStatus({ owed: 0, paid: 25, balance: -25, amountOverride: 0 }, 'n/a', 0, false)).toEqual({ label: 'Overpaid · $25', variant: 'danger' });
  });

  it('LedgerStatus_KeepsTheExistingBadges', () => {
    const p = { owed: 25, paid: 10, balance: 15, amountOverride: null };
    expect([
      ledgerStatus({ ...p, paid: 25, balance: 0 }, 'settled', 0, false).label,
      ledgerStatus(p, 'behind', 5, true).label,
      ledgerStatus(p, 'on_track', 0, true).label,
      ledgerStatus(p, 'on_track', 0, false).label
    ]).toEqual(['Paid', 'Behind · $5', 'On schedule', '$15 due']);
  });
});
