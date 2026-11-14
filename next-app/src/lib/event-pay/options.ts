import { coverFeeFor, fromCents, toCents } from '@/lib/wreaths/rules';

/**
 * Ways to pay an event fee (Patrick, 2026-11-13): the family picks one on the sign-up form. Pure and client-safe:
 * the form, the event page, the confirmation email and the event's Money tab all read the same words from here.
 *
 * The choice is a REQUEST. Nothing moves until the treasurer records the payment (a scout account included) or
 * Stripe confirms a card payment.
 */
export const PAY_CHOICES = ['venmo', 'paypal', 'check', 'cash', 'scout_account', 'card'] as const;
export type PayChoice = (typeof PAY_CHOICES)[number];

export const PAY_CHOICE_LABEL: Record<PayChoice, string> = {
  venmo: 'Venmo',
  paypal: 'PayPal',
  check: 'Check',
  cash: 'Cash',
  scout_account: 'Scout account',
  card: 'Credit or debit card'
};

export function isPayChoice(v: unknown): v is PayChoice {
  return typeof v === 'string' && (PAY_CHOICES as readonly string[]).includes(v);
}

/** Stripe's card rate, the same one the wreath sale uses. Close enough for every card type (Patrick: "approximations
 *  are good enough"); the ledger books what Stripe really kept. */
export const EVENT_CARD_FEE = { feePercent: 2.9, feeFixed: 0.3 } as const;

/** The fee added to a card payment so the troop still nets `due`. */
export function cardFeeFor(due: number): number {
  return coverFeeFor(EVENT_CARD_FEE, due);
}

/** What a card payment of `due` comes to: the fee and the total charged. */
export function cardTotalFor(due: number): { fee: number; total: number } {
  const fee = cardFeeFor(due);
  return { fee, total: fromCents(toCents(due) + toCents(fee)) };
}

/** Whole dollars read "$20", anything else "$20.91". */
export function payMoney(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** Where the troop's money goes: entered once (site_settings pay.*), used on every event. */
export interface PayTo {
  venmoHandle: string;
  venmoHint: string;
  venmoUrl: string;
  paypalEmail: string;
  checkPayableTo: string;
  checkMailTo: string;
}

export const PAY_TO_KEYS = ['pay.venmo_handle', 'pay.venmo_hint', 'pay.paypal_email', 'pay.check_payable_to', 'pay.check_mail_to'] as const;

export function payToFrom(settings: Pick<Map<string, string>, 'get'>): PayTo {
  const get = (k: (typeof PAY_TO_KEYS)[number]) => (settings.get(k) ?? '').trim();
  const handle = get('pay.venmo_handle');
  return {
    venmoHandle: handle,
    venmoHint: get('pay.venmo_hint'),
    venmoUrl: handle ? `https://venmo.com/u/${encodeURIComponent(handle.replace(/^@/, ''))}` : '',
    paypalEmail: get('pay.paypal_email'),
    checkPayableTo: get('pay.check_payable_to') || 'Troop 79',
    checkMailTo: get('pay.check_mail_to')
  };
}

/** The choices this troop can offer right now: a method with no details on file is left out, card only when Stripe
 *  is configured, a scout account only when the household has a scout. */
export function offeredChoices(payTo: PayTo, opts: { cardLive: boolean; hasScoutAccount: boolean }): PayChoice[] {
  return PAY_CHOICES.filter((c) => {
    if (c === 'venmo') return !!payTo.venmoHandle;
    if (c === 'paypal') return !!payTo.paypalEmail;
    if (c === 'scout_account') return opts.hasScoutAccount;
    if (c === 'card') return opts.cardLive;
    return true;
  });
}

export const SCOUT_ACCOUNT_FUNDING_NOTE = 'Scout accounts are funded by taking part in the Can Drive and the Wreath Sale.';

/** How far a scout account goes toward what is due. */
export function scoutAccountCover(balance: number, due: number): { covers: number; remainder: number } {
  const covers = fromCents(Math.max(0, Math.min(toCents(balance), toCents(due))));
  return { covers, remainder: fromCents(Math.max(0, toCents(due) - toCents(covers))) };
}

/** The confirmation email's payment sentence: the chosen method's how-to, or every method in brief when none was
 *  chosen; the event's own note follows. Empty when nothing is due and there is no note. */
export function payEmailLine(choice: PayChoice | null, payTo: PayTo, due: number, note: string | null): string {
  const parts: string[] = [];
  if (due > 0) {
    if (choice === 'card') parts.push('You chose to pay by card. If the card page didn’t finish, open your signup and press “Pay by card”.');
    else if (choice) parts.push(`${PAY_CHOICE_LABEL[choice]}: ${payHowTo(choice, payTo, due)}`);
    else {
      const ways = [
        payTo.venmoHandle ? `Venmo (${payTo.venmoHandle})` : null,
        payTo.paypalEmail ? `PayPal (${payTo.paypalEmail})` : null,
        'check',
        'cash',
        'scout account',
        'card'
      ].filter(Boolean);
      parts.push(`Pay by ${ways.join(', ')}. Choose one on the signup page.`);
    }
  }
  if (note?.trim()) parts.push(note.trim());
  return parts.join(' ');
}

/** What to do for the chosen method, as one plain sentence: the form's detail line and the confirmation email. */
export function payHowTo(choice: PayChoice, payTo: PayTo, due: number, scout?: { name: string; balance: number } | null): string {
  const amt = payMoney(due);
  switch (choice) {
    case 'venmo':
      return `Send ${amt} to ${payTo.venmoHandle}${payTo.venmoHint ? ` (${payTo.venmoHint})` : ''}.`;
    case 'paypal':
      return `Send ${amt} to ${payTo.paypalEmail}.`;
    case 'check':
      return `Make it out to ${payTo.checkPayableTo}. Bring it to any meeting${payTo.checkMailTo ? `, or mail it to ${payTo.checkMailTo}` : ''}.`;
    case 'cash':
      return 'Bring it to any meeting.';
    case 'scout_account': {
      if (!scout) return 'The treasurer takes it from the scout account.';
      const first = scout.name.split(' ')[0];
      const { covers, remainder } = scoutAccountCover(scout.balance, due);
      if (covers <= 0) return `${first}’s account has $0. ${SCOUT_ACCOUNT_FUNDING_NOTE} Please pick another way to pay.`;
      if (remainder > 0) return `${first}’s account covers ${payMoney(covers)} of the ${amt}. Pay the other ${payMoney(remainder)} another way.`;
      return `The treasurer takes ${amt} from ${first}’s account. Nothing else to do.`;
    }
    case 'card': {
      const { fee, total } = cardTotalFor(due);
      return `${payMoney(total)} by card, Apple Pay or Google Pay on Stripe’s secure page. That includes a ${payMoney(fee)} card fee.`;
    }
  }
}
