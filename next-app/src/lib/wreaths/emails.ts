/**
 * Wreath sale email bodies. Fixed copy built on renderEmail (lib/email), which escapes every string it is given,
 * so customer input — a name, an address — can never reach the HTML as markup. Pure: callers pass plain strings
 * and get {subject, html, text}.
 */
import { renderEmail } from '@/lib/email';
import { PAY_TREASURER, fmtMoney2 } from './rules';

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
}

/** Header-safe text for an email subject: control characters (CR, LF, NUL, bidi marks, line separators) become a space. */
export function subjectText(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The money lines every order summary shares. */
export function summaryBullets(c: Pick<OrderEmailContext, 'items' | 'deliveryFee' | 'feeCovered' | 'gift' | 'total'>): string[] {
  return [
    ...c.items.map((i) => `${i.quantity} × ${i.label}${i.donated ? ' (donated to veterans)' : ''} — ${fmtMoney2(i.amount)}`),
    ...(c.deliveryFee ? [`Delivery fee — ${fmtMoney2(c.deliveryFee)}`] : []),
    ...(c.gift ? [`Gift to Troop 79 — ${fmtMoney2(c.gift)}`] : []),
    ...(c.feeCovered ? [`Processing fee — ${fmtMoney2(c.feeCovered)}`] : []),
    `Total — ${fmtMoney2(c.total)}`
  ];
}

/** The customer's receipt: what they ordered, and how to pay the treasurer with the order number in the note. */
export function customerConfirmationEmail(c: OrderEmailContext): { subject: string; html: string; text: string } {
  const first = c.customerName.trim().split(/\s+/)[0] || 'there';
  const { html, text } = renderEmail({
    heading: `Thank you, ${first}. Your order is placed.`,
    intro: `Your Troop 79 wreath order ${c.orderNumber} is placed. It is not paid yet: please pay ${fmtMoney2(c.total)} and put ${c.orderNumber} in the payment note so we can match it.`,
    bullets: [
      ...summaryBullets(c),
      `Pay by Venmo to ${PAY_TREASURER.venmoHandle} (${PAY_TREASURER.venmoUrl})`,
      `Or by PayPal to ${PAY_TREASURER.paypalEmail}, choosing Friends and family`,
      PAY_TREASURER.note,
      ...(c.creditedTo ? [`Credited to ${c.creditedTo}`] : []),
      c.arrival
    ],
    actionUrl: c.orderUrl,
    actionLabel: 'View your order',
    outro: `Questions or changes: reply to this email. Changes are possible until ${c.changesBy}, when the troop places its order with the grower.`
  });
  return { subject: subjectText(`Your Troop 79 wreath order ${c.orderNumber}`), html, text };
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
  c: OrderEmailContext & { collected: boolean; paymentNote: string; memberUrl: string }
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
    outro: `Change or cancel it there until ${c.changesBy}, unless the troop has already marked it paid.`
  });
  return { subject: subjectText(`Wreath order ${c.orderNumber} for ${c.customerName}`), html, text };
}
