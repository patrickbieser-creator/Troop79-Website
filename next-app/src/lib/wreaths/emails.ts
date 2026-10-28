/**
 * Wreath sale email bodies. Fixed copy built on renderEmail (lib/email), which escapes every string it is given,
 * so customer input — a name, an address — can never reach the HTML as markup. Pure: callers pass plain strings
 * and get {subject, html, text}.
 */
import { renderEmail } from '@/lib/email';
import { DONATION_LABEL, PAY_TREASURER, fmtMoney2 } from './rules';
import { donationReceiptLines } from './copy';

export interface OrderEmailItem {
  label: string;
  quantity: number;
  donated: boolean;
  amount: number;
}

export interface OrderEmailContext {
  orderNumber: string;
  customerName: string;
  items: OrderEmailItem[];
  itemsSubtotal: number;
  deliveryFee: number;
  feeCovered: number;
  gift: number;
  total: number;
  /** Plain text: how the wreaths reach the customer. */
  arrival: string;
  /** "Ben B." when a scout gets credit for the order. */
  creditedTo?: string | null;
  orderUrl: string;
  /** "Saturday, October 25" — the last day a change is possible. */
  changesBy: string;
  /** When the order was placed (an instant): the donation receipt's date (W-3). Absent = no receipt lines. */
  placedAt?: string;
  /** The customer chose card at checkout: the confirmation names no other way to pay (Patrick, 2026-10-27). */
  payByCard?: boolean;
}

/** A donation with no wreath (W-3). */
const isDonationOnly = (c: Pick<OrderEmailContext, 'items' | 'gift'>) => c.items.length === 0 && c.gift > 0;

/** Header-safe text for an email subject: control characters (CR, LF, NUL, bidi marks, line separators) become a space. */
export function subjectText(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The money lines every order summary shares. */
export function summaryBullets(c: Pick<OrderEmailContext, 'items' | 'deliveryFee' | 'feeCovered' | 'gift' | 'total'>): string[] {
  return [
    ...c.items.map((i) => `${i.quantity} × ${i.label}${i.donated ? ' (donated to veterans)' : ''} — ${fmtMoney2(i.amount)}`),
    ...(c.deliveryFee ? [`Delivery fee — ${fmtMoney2(c.deliveryFee)}`] : []),
    ...(c.gift ? [`${DONATION_LABEL} — ${fmtMoney2(c.gift)}`] : []),
    ...(c.feeCovered ? [`Processing fee — ${fmtMoney2(c.feeCovered)}`] : []),
    `Total — ${fmtMoney2(c.total)}`
  ];
}

/**
 * The first name the receipt greets, or null. The receipt goes to an address a stranger can type, so the one word of
 * theirs it echoes must not carry a link or spam text: letters (any alphabet), apostrophes and hyphens, up to 40.
 */
export function greetingName(customerName: string): string | null {
  const first = customerName.trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}][\p{L}\p{M}'’-]{0,39}$/u.test(first) ? first : null;
}

/** Settings › Order copies: a copy says so at the top and in its subject, so a leader never mistakes it for their own. */
export interface OrderCopy {
  /** Who the original went to, in words: "Jane Doe", "whoever entered it". */
  sentTo: string;
}
const copyNotice = (copy: OrderCopy) => `Copy for the troop: this is the confirmation sent to ${copy.sentTo}.`;

/**
 * The customer's receipt: what they ordered, and how to pay the treasurer with the order number in the note. A card
 * order is sent as the customer leaves for Stripe, so it names no other way to pay: the order page is the way back.
 */
export function customerConfirmationEmail(c: OrderEmailContext, copy?: OrderCopy): { subject: string; html: string; text: string } {
  const first = greetingName(c.customerName);
  const donationOnly = isDonationOnly(c);
  const what = donationOnly ? `Your donation ${c.orderNumber} is recorded.` : `Your Troop 79 wreath order ${c.orderNumber} is placed.`;
  const { html, text } = renderEmail({
    heading: donationOnly
      ? first ? `Thank you, ${first}, for your donation to Troop 79.` : 'Thank you for your donation to Troop 79.'
      : first ? `Thank you, ${first}. Your order is placed.` : 'Thank you. Your order is placed.',
    intro: c.payByCard
      ? `${what} You chose to pay ${fmtMoney2(c.total)} by card. If the card payment didn’t go through, open your ${donationOnly ? 'donation' : 'order'} below to try again.`
      : `${what} It is not paid yet: please pay ${fmtMoney2(c.total)} and put ${c.orderNumber} in the payment note so we can match it.`,
    bullets: [
      ...summaryBullets(c),
      ...(c.placedAt ? donationReceiptLines({ gift: c.gift, donationOnly, placedAt: c.placedAt }) : []),
      ...(c.payByCard
        ? []
        : [`Pay by Venmo to ${PAY_TREASURER.venmoHandle} (${PAY_TREASURER.venmoUrl})`, `Or by PayPal to ${PAY_TREASURER.paypalEmail}, choosing Friends and family`, PAY_TREASURER.note]),
      ...(c.creditedTo ? [`Credited to ${c.creditedTo}`] : []),
      c.arrival
    ],
    actionUrl: c.orderUrl,
    actionLabel: donationOnly ? 'View your donation' : 'View your order',
    outro: donationOnly
      ? 'Questions: reply to this email.'
      : `Questions or changes: reply to this email. Changes are possible until ${c.changesBy}, when the troop places its order with the grower.`,
    notice: copy && copyNotice(copy)
  });
  const subject = copy
    ? `Copy: ${donationOnly ? 'donation' : 'wreath order'} ${c.orderNumber} for ${c.customerName}`
    : donationOnly
      ? `Your donation to Troop 79, ${c.orderNumber}`
      : `Your Troop 79 wreath order ${c.orderNumber}`;
  return { subject: subjectText(subject), html, text };
}

/**
 * The customer's order after the treasurer changed it (Patrick, 2026-10-18), sent only when the treasurer ticks the
 * box. Paid: what came in, and nothing more to do. Unpaid: the same pay-the-treasurer lines as the confirmation.
 */
export function orderUpdatedEmail(c: OrderEmailContext & { paid: number | null }, copy?: OrderCopy): { subject: string; html: string; text: string } {
  const first = greetingName(c.customerName);
  const pay =
    c.paid != null
      ? [`Paid — ${fmtMoney2(c.paid)}`]
      : [`Pay by Venmo to ${PAY_TREASURER.venmoHandle} (${PAY_TREASURER.venmoUrl})`, `Or by PayPal to ${PAY_TREASURER.paypalEmail}, choosing Friends and family`, PAY_TREASURER.note];
  const { html, text } = renderEmail({
    heading: first ? `${first}, your order is updated.` : 'Your order is updated.',
    intro:
      c.paid != null
        ? `We updated your Troop 79 wreath order ${c.orderNumber}. Here is the order as it stands now.`
        : `We updated your Troop 79 wreath order ${c.orderNumber}. It is not paid yet: please pay ${fmtMoney2(c.total)} and put ${c.orderNumber} in the payment note so we can match it.`,
    bullets: [...summaryBullets(c), ...pay, ...(c.creditedTo ? [`Credited to ${c.creditedTo}`] : []), c.arrival],
    actionUrl: c.orderUrl,
    actionLabel: 'View your order',
    outro: 'Questions: reply to this email.',
    notice: copy && copyNotice(copy)
  });
  return { subject: subjectText(copy ? `Copy: updated wreath order ${c.orderNumber} for ${c.customerName}` : `Your Troop 79 wreath order ${c.orderNumber} is updated`), html, text };
}

/** A note to the credited scout's household: a new order to deliver. Goes only to addresses on file. */
export function scoutNoticeEmail(
  c: OrderEmailContext & { scoutFirstName: string; customerPhone: string; customerAddress: string; creditOnly?: boolean }
): { subject: string; html: string; text: string } {
  const { html, text } = c.creditOnly
    ? renderEmail({
        heading: `A wreath order was credited to ${c.scoutFirstName}`,
        intro: `${c.customerName} chose to credit ${c.scoutFirstName} for order ${c.orderNumber} (${fmtMoney2(c.total)}). It is credited to you; the troop handles delivery, so there is nothing for ${c.scoutFirstName} to deliver.`,
        bullets: [...summaryBullets(c), 'The customer pays the troop treasurer directly; you do not collect money.'],
        outro: 'This note goes only to the family addresses on file.'
      })
    : renderEmail({
        heading: `New wreath order for ${c.scoutFirstName}`,
        intro: `${c.customerName} ordered through ${c.scoutFirstName}’s link (order ${c.orderNumber}, ${fmtMoney2(c.total)}). ${c.scoutFirstName} delivers it after distribution day.`,
        bullets: [...summaryBullets(c), `Phone: ${c.customerPhone}`, `Deliver to: ${c.customerAddress}`, 'The customer pays the troop treasurer directly; you do not collect money.'],
        outro: 'This note goes only to the family addresses on file.'
      });
  return { subject: subjectText(c.creditOnly ? `Credited to ${c.scoutFirstName}: wreath order ${c.orderNumber}` : `New wreath order for ${c.scoutFirstName}: ${c.orderNumber}`), html, text };
}

/**
 * The confirmation for whoever typed in a scout-entered order (the scout, or a parent; the scout's parents are copied
 * when the scout typed it). The customer gets nothing, and there are no payment instructions: the scout collects.
 */
export function scoutEntryConfirmationEmail(
  c: OrderEmailContext & { collected: boolean; paymentNote: string; memberUrl: string },
  copy?: OrderCopy
): { subject: string; html: string; text: string } {
  const { html, text } = renderEmail({
    heading: `Order ${c.orderNumber} for ${c.customerName} is in`,
    intro: `A wreath order for ${c.customerName} was entered on the Troop 79 site (${fmtMoney2(c.total)}). The customer was not emailed.`,
    bullets: [
      ...summaryBullets(c),
      c.collected ? 'Money collected from the customer: yes' : 'Money collected from the customer: not yet',
      ...(c.paymentNote ? [`Payment note: ${c.paymentNote}`] : []),
      ...(c.creditedTo ? [`Credited to ${c.creditedTo}`] : [])
    ],
    actionUrl: c.memberUrl,
    actionLabel: 'My wreath orders',
    outro: `Change or cancel it there until ${c.changesBy}, unless the troop has already marked it paid.`,
    notice: copy && copyNotice(copy)
  });
  return { subject: subjectText(`${copy ? 'Copy: w' : 'W'}reath order ${c.orderNumber} for ${c.customerName}`), html, text };
}
