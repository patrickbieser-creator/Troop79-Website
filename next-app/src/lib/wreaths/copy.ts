/**
 * Wreath sale wording shared by the confirmation page, the emails and the store — plain strings, never markup,
 * so a caller escapes them exactly once. "Where the money goes" is a code constant until Admin › Pages carries it
 * as a site_pages row (Plans/Wreath-Sale.md, Deploy order).
 */
import { fmtDateFull, fmtDateLong } from '@/lib/format-date';
import { fmtMoney2, type Fulfillment } from './rules';

export interface Distribution {
  date: string | null;
  window: string;
  place: string;
}

/** "Saturday, November 21, 2026, 2:30 to 4:30 PM, Northwoods parking lot, 1572 East Capitol" (whatever parts are set). */
export function distributionLine(d: Distribution): string {
  return [d.date ? fmtDateFull(d.date) : '', d.window, d.place].filter(Boolean).join(', ');
}

/** "Saturday, November 21, 2026" or '' when no date is set. */
export function distributionDay(d: Distribution): string {
  return d.date ? fmtDateFull(d.date) : '';
}

/** How the wreaths reach the customer — the paragraphs the confirmation page and the email both print. */
export function arrivalParagraphs(opts: {
  fulfillment: Fulfillment;
  scoutName: string | null;
  scoutFirstName: string | null;
  outsideAreaRelative: boolean;
  hasDonated: boolean;
  distribution: Distribution;
}): string[] {
  const { fulfillment, scoutName, scoutFirstName, distribution } = opts;
  const day = distributionDay(distribution);
  const out: string[] = [];
  if (fulfillment === 'scout') {
    out.push(
      `${scoutName ?? 'A scout'} delivers your order to the address you gave us. The troop collects the wreaths from the grower${day ? ` on ${day}` : ''}, ` +
        `so expect ${scoutFirstName ?? 'your scout'} soon after. ${scoutFirstName ?? 'Your scout'}’s family will call or text first.`
    );
    if (opts.outsideAreaRelative) out.push(`You told us ${scoutFirstName ?? 'your scout'} has agreed to deliver outside the Milwaukee area.`);
  } else if (fulfillment === 'pickup') {
    out.push(`Pick up your order ${distributionLine(distribution)}. Give your name at the table; no printout needed.`);
  } else if (fulfillment === 'delivery') {
    out.push(
      `The troop delivers to the address you gave us${day ? ` after the distribution on ${day}` : ''}. A leader will call or text the day before.`
    );
  } else if (opts.hasDonated) {
    out.push('No wreaths will be delivered to you. Your donated wreaths go to veterans.');
  } else {
    // A donation with no wreath (W-3): nothing to deliver or pick up.
    out.push('There is nothing to deliver or pick up: your order is a donation to Troop 79.');
  }
  if (fulfillment !== 'none' && opts.hasDonated) out.push('Your donated wreaths go to veterans; they are not part of this delivery.');
  return out;
}

/** The "Where the money goes" block, in plain sentences. `scoutFirstName` is set on a scout's own page. */
export function moneyBlockLines(scoutFirstName: string | null): string[] {
  // Patrick's copy, 2026-10-13. The date is written out for the 2026 sale; update it with next year's sale.
  return [
    'Wreath proceeds pay for camping gear and programming for the year.',
    scoutFirstName
      ? `${scoutFirstName} gets credit for your order: 30% of its profit goes into ${scoutFirstName}’s scout account, for camp fees and high-adventure trips.`
      : 'Orders here support the whole troop, add to our scholarship fund, and reduce outing fees for every scout.',
    'Wreaths arrive fresh on distribution day, Saturday, November 21, 2026.'
  ];
}

/**
 * Shown when a scout link matches no active seller. One message for an unknown link and a retired one alike, so
 * nobody can tell which it was; it points at the optional "give a scout credit" box at checkout.
 */
export const LINK_NOT_FOUND =
  'We couldn’t find a scout with that link. Check the spelling, or order here. At checkout you can still give a scout credit.';

/** Who the donation lines name (W-3). Wording to be checked with the treasurer; no EIN or tax wording until then. */
export const RECEIPT_ORG = 'Scouts BSA Troop 79, Milwaukee, Wisconsin';
export const NO_GOODS_OR_SERVICES = 'No goods or services were provided in exchange for this donation.';

/**
 * "Your donation" in the confirmation email and on the order page (W-3, Patrick 2026-10-19): the troop's name, the
 * amount and the date. A donation-only order says no goods or services were provided; a mixed order names the donation
 * apart from the wreaths. Empty without a donation. `placedAt` is the order's instant. Not called a receipt: it goes
 * out before payment, and no paid-confirmation email exists yet (qa-lead, 2026-10-19).
 */
export function donationReceiptLines(o: { gift: number; donationOnly: boolean; placedAt: string }): string[] {
  if (!(o.gift > 0)) return [];
  const date = fmtDateLong(o.placedAt);
  return o.donationOnly
    ? [`Your donation to ${RECEIPT_ORG}`, `Donation: ${fmtMoney2(o.gift)}, ${date}`, NO_GOODS_OR_SERVICES]
    : [`Your donation to ${RECEIPT_ORG}`, `Donation: ${fmtMoney2(o.gift)}, ${date}. This is the donation part of the order; the wreaths are not part of it.`];
}
