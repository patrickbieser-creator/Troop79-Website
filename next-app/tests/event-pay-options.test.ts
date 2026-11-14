import { describe, it, expect } from 'vitest';
import {
  cardFeeFor,
  cardTotalFor,
  isPayChoice,
  offeredChoices,
  payEmailLine,
  payHowTo,
  payToFrom,
  scoutAccountCover,
  SCOUT_ACCOUNT_FUNDING_NOTE
} from '../src/lib/event-pay/options';

/** Ways to pay an event fee (Patrick, 2026-11-13): the pure rules behind "How will you pay?". */
const settings = new Map([
  ['pay.venmo_handle', '@Troop-Treasurer'],
  ['pay.venmo_hint', 'last 4 of phone 0000'],
  ['pay.paypal_email', 'treasurer@example.test'],
  ['pay.check_payable_to', 'Troop 79'],
  ['pay.check_mail_to', '1 Main St, Milwaukee WI']
]);
const payTo = payToFrom(settings);

describe('card fee', () => {
  it('CardFee_OnTwentyDollars_IsNinetyOneCents', () => {
    expect(cardFeeFor(20)).toBe(0.91);
  });

  it('CardTotal_LeavesTheTroopTheFullAmount_AfterStripesCut', () => {
    const { total } = cardTotalFor(137.5);
    const stripeKeeps = Math.round(total * 100 * 0.029) / 100 + 0.3;
    expect(total - stripeKeeps).toBeGreaterThanOrEqual(137.5);
  });

  it('CardFee_OnNothing_IsNothing', () => {
    expect(cardFeeFor(0)).toBe(0);
  });
});

describe('offeredChoices', () => {
  it('Offers_EveryMethod_WhenAllIsConfigured', () => {
    expect(offeredChoices(payTo, { cardLive: true, hasScoutAccount: true })).toEqual(['venmo', 'paypal', 'check', 'cash', 'scout_account', 'card']);
  });

  it('LeavesOutCard_WhenStripeIsNotConfigured', () => {
    expect(offeredChoices(payTo, { cardLive: false, hasScoutAccount: true })).not.toContain('card');
  });

  it('LeavesOutVenmoAndPayPal_WhenTheyHaveNoDetails', () => {
    expect(offeredChoices(payToFrom(new Map()), { cardLive: false, hasScoutAccount: false })).toEqual(['check', 'cash']);
  });
});

describe('payToFrom', () => {
  it('BuildsTheVenmoLink_FromTheHandle', () => {
    expect(payTo.venmoUrl).toBe('https://venmo.com/u/Troop-Treasurer');
  });

  it('DefaultsThePayee_ToTroop79', () => {
    expect(payToFrom(new Map()).checkPayableTo).toBe('Troop 79');
  });
});

describe('scout account', () => {
  it('Cover_IsCappedAtWhatIsDue', () => {
    expect(scoutAccountCover(45, 20)).toEqual({ covers: 20, remainder: 0 });
  });

  it('Cover_LeavesARemainder_WhenTheBalanceIsShort', () => {
    expect(scoutAccountCover(12, 20)).toEqual({ covers: 12, remainder: 8 });
  });

  it('Cover_OfANegativeBalance_IsNothing', () => {
    expect(scoutAccountCover(-5, 20)).toEqual({ covers: 0, remainder: 20 });
  });

  it('HowTo_AtZero_RemindsHowAccountsAreFunded', () => {
    expect(payHowTo('scout_account', payTo, 20, { name: 'Anjali Example', balance: 0 })).toContain(SCOUT_ACCOUNT_FUNDING_NOTE);
  });

  it('HowTo_WhenShort_SaysWhatIsLeftToPay', () => {
    expect(payHowTo('scout_account', payTo, 20, { name: 'Anjali Example', balance: 12 })).toBe('Anjali’s account covers $12 of the $20. Pay the other $8 another way.');
  });

  it('HowTo_WhenCovered_SaysNothingElseToDo', () => {
    expect(payHowTo('scout_account', payTo, 20, { name: 'Anjali Example', balance: 45 })).toBe('The treasurer takes $20 from Anjali’s account. Nothing else to do.');
  });
});

describe('payHowTo', () => {
  it('Venmo_NamesTheHandleAndTheCheck', () => {
    expect(payHowTo('venmo', payTo, 20)).toBe('Send $20 to @Troop-Treasurer (last 4 of phone 0000).');
  });

  it('Card_SaysTheTotalAndTheFee', () => {
    expect(payHowTo('card', payTo, 20)).toContain('$20.91');
  });

  it('Check_GivesTheMailingAddress', () => {
    expect(payHowTo('check', payTo, 20)).toContain('1 Main St, Milwaukee WI');
  });
});

describe('payEmailLine', () => {
  it('WithAChoice_GivesThatMethodsHowTo', () => {
    expect(payEmailLine('paypal', payTo, 20, null)).toBe('PayPal: Send $20 to treasurer@example.test.');
  });

  it('WithNoChoice_ListsTheWays', () => {
    expect(payEmailLine(null, payTo, 20, null)).toContain('Venmo (@Troop-Treasurer)');
  });

  it('WithNothingDue_IsOnlyTheEventsNote', () => {
    expect(payEmailLine('venmo', payTo, 0, 'Deposit is not refundable.')).toBe('Deposit is not refundable.');
  });

  it('WithNothingDueAndNoNote_IsEmpty', () => {
    expect(payEmailLine('venmo', payTo, 0, null)).toBe('');
  });
});

describe('isPayChoice', () => {
  it('Refuses_AMethodFamiliesCannotChoose', () => {
    expect([isPayChoice('scholarship'), isPayChoice(''), isPayChoice(null), isPayChoice('card')]).toEqual([false, false, false, true]);
  });
});
