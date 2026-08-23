import { describe, it, expect } from 'vitest';
import { feeAmount, milestoneStanding, money, sortMilestones, summarizeEventMoney, uncreditedOverpayment, type Milestone } from '../src/lib/event-money';

describe('feeAmount (notional accounts)', () => {
  it('FeeAmount_FlipsScoutAccountAndScholarshipFeeRows_ToTheEventsSign', () => {
    // A $30 fee paid from the scout account is a −30 row on scout_account; the event sees +30.
    expect(feeAmount({ amount: -30, kind: 'event_fee', account: 'scout_account' })).toBe(30);
    expect(feeAmount({ amount: -30, kind: 'event_fee', account: 'scholarship' })).toBe(30);
    // A refund back into the scout account is +30 there; the event sees −30.
    expect(feeAmount({ amount: 30, kind: 'event_fee', account: 'scout_account' })).toBe(-30);
    // Cash rows carry the event's sign already.
    expect(feeAmount({ amount: 30, kind: 'event_fee', account: 'checking' })).toBe(30);
    expect(feeAmount({ amount: -10, kind: 'event_fee', account: 'checking' })).toBe(-10);
    // Only fees flip — a scout-account credit (adjustment) keeps its sign.
    expect(feeAmount({ amount: 30, kind: 'adjustment', account: 'scout_account' })).toBe(30);
  });
});

describe('uncreditedOverpayment', () => {
  it('UncreditedOverpayment_IsTheNegativeBalance_WhichAlreadyNetsCredits', () => {
    // The view: balance = owed − paid + credited. Owed 30, paid 60 → −30; after a $30 credit → 0.
    expect(uncreditedOverpayment(-30)).toBe(30);
    expect(uncreditedOverpayment(0)).toBe(0); // fully credited — no more Credit button
    expect(uncreditedOverpayment(-20.25)).toBe(20.25);
  });
  it('UncreditedOverpayment_IsZero_WhenNothingIsOverpaid', () => {
    expect(uncreditedOverpayment(15)).toBe(0);
  });
  it('SummarizeEventMoney_UsesTheViewBalance_SoACreditedOverpaymentIsNotOverpaid', () => {
    const t = summarizeEventMoney([{ entryId: 1, owed: 30, paid: 60, balance: 0 }], [], []);
    expect(t.overpaid).toBe(0);
    expect(t.due).toBe(0);
    const before = summarizeEventMoney([{ entryId: 1, owed: 30, paid: 60, balance: -30 }], [], []);
    expect(before.overpaid).toBe(30);
  });
});

/**
 * Event Logistics Phase 3 — the sheet's money block as pure functions
 * (Plans/Event-Logistics.md §C).
 */
const ms: Milestone[] = [
  { id: 1, kind: 'payment', label: 'Deposit', dueOn: '2026-01-25', amount: 300, appliesTo: 'both' },
  { id: 2, kind: 'payment', label: 'Balance', dueOn: '2026-06-01', amount: 540, appliesTo: 'both' },
  { id: 3, kind: 'registration', label: 'Council registration', dueOn: '2026-03-01', amount: null, appliesTo: 'both' },
  { id: 4, kind: 'payment', label: 'Adult add-on', dueOn: '2026-02-01', amount: 50, appliesTo: 'adults' }
];

describe('milestoneStanding', () => {
  it('MilestoneStatus_FlagsBehind_WhenCumulativeDueExceedsPaid', () => {
    expect(milestoneStanding({ owed: 840, paid: 100, isScout: true }, ms, '2026-02-10')).toEqual({
      standing: 'behind',
      dueByToday: 300,
      shortBy: 200
    });
  });

  it('MilestoneStatus_IsOnTrack_WhenCaughtUpButNotSettled', () => {
    expect(milestoneStanding({ owed: 840, paid: 300, isScout: true }, ms, '2026-02-10').standing).toBe('on_track');
    expect(milestoneStanding({ owed: 840, paid: 0, isScout: true }, ms, '2026-01-01').standing).toBe('on_track');
  });

  it('MilestoneStatus_NeverAsksForMoreThanOwed', () => {
    // Override to $250: the $300 deposit can only ever demand $250.
    expect(milestoneStanding({ owed: 250, paid: 0, isScout: true }, ms, '2026-02-10')).toEqual({
      standing: 'behind',
      dueByToday: 250,
      shortBy: 250
    });
  });

  it('MilestoneStatus_AppliesAudience_AndIgnoresNonPayment', () => {
    // Adult owes 890: deposit 300 + adult add-on 50 by Feb 10; registration ignored.
    expect(milestoneStanding({ owed: 890, paid: 300, isScout: false }, ms, '2026-02-10')).toEqual({
      standing: 'behind',
      dueByToday: 350,
      shortBy: 50
    });
    expect(milestoneStanding({ owed: 840, paid: 300, isScout: true }, ms, '2026-02-10').dueByToday).toBe(300);
  });

  it('MilestoneStatus_IsSettledOrNA_AtTheEdges', () => {
    expect(milestoneStanding({ owed: 840, paid: 840, isScout: true }, ms, '2026-07-01').standing).toBe('settled');
    expect(milestoneStanding({ owed: 0, paid: 0, isScout: true }, ms, '2026-07-01').standing).toBe('n/a');
  });

  it('SortMilestones_UpcomingFirst', () => {
    expect(sortMilestones(ms).map((m) => m.id)).toEqual([1, 4, 3, 2]);
  });
});

describe('summarizeEventMoney', () => {
  it('SummarizeEventMoney_NetsRefunds_SplitsByMethod_AndComputesPL', () => {
    const t = summarizeEventMoney(
      [
        { entryId: 1, owed: 30, paid: 30 },
        { entryId: 2, owed: 30, paid: 10 },
        { entryId: 3, owed: 30, paid: 45 }
      ],
      [
        { id: 1, occurredOn: '2025-09-01', amount: 30, kind: 'event_fee', method: 'venmo', memo: null, voidedAt: null, signupEntryId: 1, personId: 1 },
        { id: 2, occurredOn: '2025-09-01', amount: 10, kind: 'event_fee', method: 'check', memo: null, voidedAt: null, signupEntryId: 2, personId: 2 },
        { id: 3, occurredOn: '2025-09-01', amount: 50, kind: 'event_fee', method: 'venmo', memo: null, voidedAt: null, signupEntryId: 3, personId: 3 },
        { id: 4, occurredOn: '2025-09-02', amount: -5, kind: 'event_fee', method: 'venmo', memo: 'refund', voidedAt: null, signupEntryId: 3, personId: 3 },
        { id: 5, occurredOn: '2025-09-03', amount: -534.71, kind: 'expense', method: 'other', memo: 'Food', voidedAt: null, signupEntryId: null, personId: null },
        { id: 6, occurredOn: '2025-09-03', amount: -99, kind: 'expense', method: null, memo: 'voided', voidedAt: '2025-09-04', signupEntryId: null, personId: null }
      ],
      [{ amount: 187 }]
    );
    expect(t.owed).toBe(90);
    expect(t.paid).toBe(85);
    expect(t.due).toBe(20);
    expect(t.overpaid).toBe(15);
    expect(t.incomeByMethod).toEqual({ venmo: 75, check: 10 });
    expect(t.income).toBe(85);
    expect(t.expenses).toBe(534.71);
    expect(t.reimbursementsPending).toBe(187);
    expect(t.net).toBe(-636.71);
  });

  it('Money_FormatsWholeAndFractionalDollars_WithAMinusSign', () => {
    expect(money(30)).toBe('$30');
    expect(money(22.5)).toBe('$22.50');
    expect(money(-278.71)).toBe('−$278.71');
  });
});
