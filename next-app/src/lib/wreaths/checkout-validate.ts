/**
 * Wreath checkout — the browser's check of the form, run when "Place order" is pressed so every problem is marked in
 * place with its reason. It mirrors what the order action enforces (which is the real gate and answers in the same
 * words); it exists so a customer isn't sent to the server to learn their phone number was short.
 */
import { EMAIL_RE, MAX_GIFT, MIN_DONATION, inDeliveryArea, phoneOk, zipFormatOk, type Fulfillment } from './rules';
import type { OrderField } from './place-order';

export interface CheckoutDraft {
  hasLines: boolean;
  allDonated: boolean;
  /** Set when a scout's link is in use; the scout delivers. */
  scoutFirstName: string | null;
  method: 'pickup' | 'delivery' | '';
  deliveryZipPrefix: string;
  zip: string;
  relative: boolean;
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  giftOther: boolean;
  giftAmount: number;
}

export interface CheckoutProblem {
  field: OrderField;
  message: string;
  /** Short name used in "Can't place the order yet: check …". */
  label: string;
}

/** "Donate to Troop 79" with no wreath in the cart (W-3): nothing to deliver or pick up. */
export function isDonationOnly(d: Pick<CheckoutDraft, 'hasLines' | 'giftAmount'>): boolean {
  return !d.hasLines && d.giftAmount > 0;
}

export function fulfillmentFor(d: Pick<CheckoutDraft, 'allDonated' | 'scoutFirstName' | 'method' | 'hasLines' | 'giftAmount'>): Fulfillment | null {
  if (isDonationOnly(d)) return 'none';
  if (!d.hasLines) return null;
  if (d.allDonated) return 'none';
  if (d.scoutFirstName) return 'scout';
  return d.method || null;
}

export function validateCheckout(d: CheckoutDraft): CheckoutProblem[] {
  const out: CheckoutProblem[] = [];
  const add = (field: OrderField, label: string, message: string) => out.push({ field, label, message });
  const donationOnly = isDonationOnly(d);
  if (!d.hasLines && !donationOnly && !d.giftOther) add('cart', 'your cart', 'Your cart is empty.');
  if (d.giftOther && !(d.giftAmount > 0)) add('gift', 'the donation amount', d.hasLines ? 'Enter a donation amount, or choose None.' : 'Enter a donation amount.');
  else if (d.giftAmount > MAX_GIFT) add('gift', 'the donation amount', `A donation can be up to $${MAX_GIFT}.`);
  else if (d.giftAmount > 0 && d.giftAmount < MIN_DONATION) add('gift', 'the donation amount', `A donation is at least $${MIN_DONATION}.`);
  const f = fulfillmentFor(d);
  if (d.hasLines && !d.allDonated && !d.scoutFirstName && !d.method) add('method', 'pickup or delivery', 'Choose pickup or delivery.');
  if (f === 'scout' || f === 'delivery') {
    const z = d.zip.trim();
    if (!zipFormatOk(z)) add('zip', 'the zip', 'Enter the 5-digit zip for delivery.');
    else if (!inDeliveryArea({ deliveryZipPrefix: d.deliveryZipPrefix }, z)) {
      if (f === 'delivery') add('zip', 'the delivery zip', 'Outside our delivery area. Switch to pickup.');
      else if (!d.relative) add('relative', 'the relative box', `Tick this box if ${d.scoutFirstName} has agreed to deliver to you.`);
    }
  }
  if (!d.name.trim()) add('name', 'name', 'Enter your name.');
  const email = d.email.trim();
  if (!email) add('email', 'email', 'Enter your email, for the receipt.');
  else if (!EMAIL_RE.test(email)) add('email', 'email', 'This email is missing something, like the @ or the .com.');
  // A donation-only order has no delivery question to call about: the phone is optional (W-3).
  if (donationOnly ? d.phone.trim() !== '' && !phoneOk(d.phone) : !phoneOk(d.phone)) add('phone', 'phone', d.phone.trim() ? 'A phone number is 10 digits.' : 'Enter a phone number, in case of a delivery question.');
  if ((f === 'scout' || f === 'delivery') && !d.street.trim()) add('street', 'street address', 'Enter the street address for delivery.');
  if ((f === 'scout' || f === 'delivery') && !d.city.trim()) add('city', 'city', 'Enter the city.');
  return out;
}

/** "name, email and phone" — the list the blocked button prints. */
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
