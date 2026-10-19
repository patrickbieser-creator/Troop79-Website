import { describe, it, expect } from 'vitest';
import { paidPillText, paymentDifferenceText } from '../src/lib/wreaths/rules';
import { noteAuthorName, noteStamp, parseOrderNote, ORDER_NOTE_MAX } from '../src/lib/wreaths/order-note';

/**
 * W-2 (Patrick, 2026-10-19): a hand payment that differs from the total says so on the payment pill, "Venmo · $5 short".
 * Derived from paid_amount against total; nothing is stored. And the W-1 order note's pure rules.
 */
const paid = { status: 'placed', paymentStatus: 'paid', paidMethod: 'venmo', paidAmount: 52, total: 52 };

describe('the payment pill', () => {
  it('PaymentPill_SaysShort_WhenLessThanTheTotalCameIn', () => {
    expect(paidPillText({ ...paid, paidAmount: 47 })).toBe('Venmo · $5 short');
  });
  it('PaymentPill_SaysOver_WhenMoreThanTheTotalCameIn', () => {
    expect(paidPillText({ ...paid, paidMethod: 'cash', paidAmount: 62 })).toBe('Cash · $10 over');
  });
  it('PaymentPill_KeepsCents_OnAPartialDollar', () => {
    expect(paymentDifferenceText({ ...paid, paidAmount: 51.5 })).toBe('$0.50 short');
  });
  // "Count the extra as a gift" raises the gift until the total equals what came in: nothing is left to show.
  it('PaymentPill_ShowsNoAmount_WhenTheExtraWasCountedAsAGift', () => {
    const giftAbsorbed = { ...paid, paidMethod: 'cash', paidAmount: 62, total: 62 };
    expect(paidPillText(giftAbsorbed)).toBe('Cash');
  });
  it('PaymentPill_ShowsNoAmount_WhenExact', () => {
    expect(paidPillText(paid)).toBe('Venmo');
  });
  it('PaymentPill_NeverShowsAnAmount_OnACardOrder', () => {
    expect(paidPillText({ ...paid, paidMethod: 'card', paidAmount: 50 })).toBe('Card');
  });
  it('PaymentPill_ShowsNoAmount_WhenUnpaid', () => {
    expect(paymentDifferenceText({ ...paid, paymentStatus: 'unpaid', paidMethod: null, paidAmount: null })).toBeNull();
  });
  it('PaymentPill_ShowsNoAmount_OnACancelledOrder', () => {
    expect(paymentDifferenceText({ ...paid, status: 'cancelled', paidAmount: 47 })).toBeNull();
  });
});

describe('the order note rules', () => {
  it('OrderNote_Parse_RefusesMoreThan500Characters', () => {
    expect(parseOrderNote('x'.repeat(ORDER_NOTE_MAX + 1)).ok).toBe(false);
  });
  it('OrderNote_Parse_Takes500Characters', () => {
    expect(parseOrderNote('x'.repeat(ORDER_NOTE_MAX))).toEqual({ ok: true, note: 'x'.repeat(ORDER_NOTE_MAX) });
  });
  it('OrderNote_Parse_EmptyClearsTheNote', () => {
    expect(parseOrderNote('   ')).toEqual({ ok: true, note: null });
  });
  it('OrderNote_Stamp_ReadsEditedByFirstNameAndInitial_AndTheDay', () => {
    expect(noteStamp(noteAuthorName('Dan', 'Vasquez'), '2026-10-19T20:00:00.000Z')).toBe('Edited by Dan V · Oct 19');
  });
  it('OrderNote_Stamp_UsesTheCentralDay_AfterSevenPm', () => {
    // 2026-10-20 03:30 UTC is 10:30 PM on Oct 19 in Milwaukee.
    expect(noteStamp('Dan V', '2026-10-20T03:30:00.000Z')).toBe('Edited by Dan V · Oct 19');
  });
});
