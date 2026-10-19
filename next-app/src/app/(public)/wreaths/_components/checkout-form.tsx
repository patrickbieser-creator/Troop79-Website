'use client';

/**
 * Wreath checkout (Plans/Wreath-Sale.md; prototype checkout.html): your order -> getting your wreaths -> your
 * details -> total -> Place order. Customers have no accounts. The button stays enabled until the order is in flight;
 * pressing it with a problem marks every bad field in place and says why beside the button (the blocked-save
 * standard), rather than greying it out. Paying: Venmo / PayPal to the treasurer is first and the default (no fee; the
 * confirmation page and email say how). When card payment is configured (Release B), "Card, Apple Pay or Google Pay"
 * is the second choice, with an optional cover-the-fee box: the order is placed, then Stripe Checkout opens. The
 * server action re-prices everything; the totals on this screen are only a courtesy. Before Stripe opens, this page's
 * history entry becomes the order's receipt, so Back from Stripe shows the saved order rather than an empty checkout,
 * and the tab remembers the order for an hour (lib/wreaths/leave-for-stripe.ts; Patrick, 2026-10-16).
 *
 * The donation (W-3) is the cart's one donation: "Donate to Troop 79" on the store puts it there, and the amount picked
 * here IS that amount (the order's `gift`), so it is never counted twice. A cart with only a donation checks out with
 * no delivery step, no fee on the donation and an optional phone.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Field, FieldProblem, SaveProblem, TextInput } from '@/app/_components/form';
import { Stepper } from '@/app/_components/stepper';
import { DONATION_LABEL, DONATION_PRESETS, PAY_TREASURER, coverFeeFor, deliveryFeeFor, fmtMoney, fmtMoney2, inDeliveryArea, itemLabel, parseDonation, toCents, fromCents, zipPrefixText, type Fulfillment } from '@/lib/wreaths/rules';
import type { StoreItem } from '@/lib/wreaths/public';
import type { OrderField, PlaceOrderResult } from '@/lib/wreaths/place-order';
import type { SellerMatch } from '@/lib/wreaths/seller-search';
import type { StartResult } from '@/lib/wreaths/card-payments';
import { fulfillmentFor, isDonationOnly, joinLabels, validateCheckout, type CheckoutProblem } from '@/lib/wreaths/checkout-validate';
import { leaveForStripe, recentPlacedOrder, receiptPath, rememberPlacedOrder, reloadIfRestoredAway } from '@/lib/wreaths/leave-for-stripe';
import { lineKey, parseLineKey, useCart } from './cart';
import { ProductPhoto } from './store-view';
import styles from '../wreaths.module.css';

export interface CheckoutProps {
  items: StoreItem[];
  scout: { slug: string; name: string; firstName: string } | null;
  rules: { deliveryZipPrefix: string; deliveryFee: number; deliveryFreeAt: number; feePercent: number; feeFixed: number };
  /** "Saturday, November 21, 2026, 2:30 to 4:30 PM, Northwoods parking lot, 1572 East Capitol" */
  pickupText: string;
  /** "Saturday, November 21, 2026" or '' */
  distributionDay: string;
  /** Set in the two hours after the final cutoff: only a checkout begun before it may finish. */
  graceCutoff: string | null;
  action: (raw: unknown) => Promise<PlaceOrderResult>;
  /** The type-ahead for the optional scout credit (general-store checkout only). */
  searchSellers: (prefix: string) => Promise<SellerMatch[]>;
  /** Release B: card payment is configured (decided on the server — never read from env in this client module). */
  cardLive?: boolean;
  /** Starts Stripe Checkout for a just-placed order; on failure the customer lands on the receipt, which can retry. */
  startCard?: (token: string, coverFee: boolean) => Promise<StartResult>;
}

/* When this checkout began — kept for the tab, so a shopper whose Round closes mid-checkout can still finish. */
const STARTED_KEY = 'wreath-checkout-started';
const STARTED_EVENT = 'wreath-checkout-started-changed';
function startedSnapshot(): number | null {
  try {
    const v = window.sessionStorage.getItem(STARTED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function startedSubscribe(cb: () => void) {
  window.addEventListener(STARTED_EVENT, cb);
  return () => window.removeEventListener(STARTED_EVENT, cb);
}
function markStarted() {
  try {
    if (!window.sessionStorage.getItem(STARTED_KEY)) {
      window.sessionStorage.setItem(STARTED_KEY, String(Date.now()));
      window.dispatchEvent(new Event(STARTED_EVENT));
    }
  } catch {
    // no sessionStorage: the order action falls back to the clock alone
  }
}

/* The order this tab placed in the last hour, as "token|W-1006" (a string, so the snapshot is stable). */
function lastOrderSnapshot(): string | null {
  const o = recentPlacedOrder(Date.now());
  return o ? `${o.token}|${o.orderNumber}` : null;
}
const noSubscribe = () => () => {};

/** The same amounts as the store's "Donate to Troop 79", plus None when there is a wreath in the cart. */
const GIFTS = [0, ...DONATION_PRESETS];

export function CheckoutForm({ items, scout, rules, pickupText, distributionDay, graceCutoff, action, searchSellers, cardLive = false, startCard }: CheckoutProps) {
  // Venmo / PayPal to the treasurer stays first and the default: the no-fee way to pay (Patrick, 2026-10-15).
  const [payBy, setPayBy] = useState<'treasurer' | 'card'>('treasurer');
  const [coverCardFee, setCoverCardFee] = useState(false);
  const router = useRouter();
  const { cart, setQty, setDonation, clear } = useCart();
  const formRef = useRef<HTMLFormElement>(null);
  const startedAt = useSyncExternalStore(startedSubscribe, startedSnapshot, () => null);
  const [mountedAt] = useState(() => Date.now());
  // The checkout has begun: remember when, for this tab (see STARTED_KEY).
  useEffect(() => {
    markStarted();
  }, []);
  // Restored from the back-forward cache after leaving for Stripe: show the receipt this entry now names.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => reloadIfRestoredAway(e);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const lastOrderRaw = useSyncExternalStore(noSubscribe, lastOrderSnapshot, () => null);
  const lastOrder = lastOrderRaw ? { token: lastOrderRaw.split('|')[0], orderNumber: lastOrderRaw.split('|')[1] } : null;
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [method, setMethod] = useState<'pickup' | 'delivery' | ''>('');
  const [giftOther, setGiftOther] = useState(false);
  const [giftText, setGiftText] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('Milwaukee');
  const [zip, setZip] = useState('');
  const [relative, setRelative] = useState(false);
  const [website, setWebsite] = useState('');
  const [credit, setCredit] = useState<SellerMatch | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  // The order is in and the page is on its way to Stripe or the receipt: the cart is already emptied, so don't
  // re-validate it (that flashed "your cart is empty" — production, 2026-10-16) and keep the busy state.
  const [leaving, setLeaving] = useState(false);
  const [serverProblem, setServerProblem] = useState<{ field?: OrderField; message: string } | null>(null);

  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = Object.entries(cart.lines)
    .map(([key, qty]) => ({ key, qty, ...parseLineKey(key) }))
    .filter((l) => byId.has(l.itemId))
    .map((l) => ({ ...l, item: byId.get(l.itemId)! }));
  const allDonated = lines.length > 0 && lines.every((l) => l.donated);
  const giftAmount = giftOther ? Math.round((parseFloat(giftText) || 0) * 100) / 100 : cart.donation;
  const firstName = scout?.firstName ?? null;

  const draft = {
    hasLines: lines.length > 0,
    allDonated,
    scoutFirstName: firstName,
    method,
    deliveryZipPrefix: rules.deliveryZipPrefix,
    zip,
    relative,
    name,
    email,
    phone,
    street,
    city,
    giftOther,
    giftAmount
  };
  const fulfillment: Fulfillment | null = fulfillmentFor(draft);
  const needsAddress = fulfillment === 'scout' || fulfillment === 'delivery';
  const donationOnly = isDonationOnly(draft);
  const hasOrder = lines.length > 0 || cart.donation > 0 || giftOther;
  const problems: CheckoutProblem[] = tried && !leaving ? validateCheckout(draft) : [];
  const problemFor = (f: OrderField) => problems.find((p) => p.field === f)?.message ?? (serverProblem?.field === f ? serverProblem.message : undefined);

  // Totals: a courtesy copy of what the server computes.
  const itemsCents = lines.reduce((n, l) => n + toCents(l.item.price) * l.qty, 0);
  const delivery = deliveryFeeFor(rules, fulfillment ?? 'pickup', fromCents(itemsCents));
  // No fee on the donation (W-3): covering the card fee covers the items and delivery only.
  const fee = coverFeeFor(rules, fromCents(itemsCents + toCents(delivery)));
  const payByCard = cardLive && payBy === 'card' && !!startCard;
  const cardFee = payByCard && coverCardFee ? fee : 0;
  const total = fromCents(itemsCents + toCents(delivery) + toCents(giftAmount) + toCents(cardFee));

  // Grace: after the final cutoff only a checkout begun before it may finish.
  if (graceCutoff && !(startedAt != null && startedAt < Date.parse(graceCutoff))) {
    return (
      <Notice tone="info">
        Sales have closed. Thank you for supporting Troop 79. <Link href="/wreaths">Back to the store</Link>
      </Notice>
    );
  }

  const zipTrim = zip.trim();
  const zipFive = /^\d{5}$/.test(zipTrim);
  const zipIn = inDeliveryArea(rules, zipTrim);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    markStarted();
    setTried(true);
    setServerProblem(null);
    const bad = validateCheckout(draft);
    if (bad.length) {
      requestAnimationFrame(() => {
        const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        const target = first?.matches('input, select, textarea, button') ? first : first?.querySelector<HTMLElement>('input');
        first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target?.focus({ preventScroll: true });
      });
      return;
    }
    setBusy(true);
    try {
      const res = await action({
        idempotencyKey,
        sellerSlug: scout?.slug ?? null,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty, donated: l.donated })),
        gift: giftAmount,
        coverFee: payByCard && coverCardFee,
        fulfillment: scout || donationOnly ? null : method || null,
        customer: { name, email, phone, street, city, zip: needsAddress ? zip : '' },
        outsideAreaRelative: relative,
        creditSellerId: scout ? null : (credit?.id ?? null),
        startedAt: startedAt ?? mountedAt,
        mountedAt,
        website
      });
      if (res.ok) {
        setLeaving(true);
        rememberPlacedOrder({ token: res.token, orderNumber: res.orderNumber });
        clear();
        try {
          window.sessionStorage.removeItem(STARTED_KEY);
        } catch {
          // ignore
        }
        if (payByCard && startCard) {
          const card = await startCard(res.token, coverCardFee).catch(() => null);
          if (card?.ok) {
            leaveForStripe(card.url, res.token);
            return;
          }
        }
        router.push(receiptPath(res.token));
        return;
      }
      setServerProblem({ field: res.field, message: res.error });
    } catch {
      setServerProblem({ message: 'Something went wrong sending your order. Nothing was charged. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  const backHref = scout ? `/wreaths/${scout.slug}` : '/wreaths';
  const labels = problems.filter((p) => p.field !== 'cart').map((p) => p.label);
  const blockedReason = problems.length ? (problems.some((p) => p.field === 'cart') && !labels.length ? 'your cart is empty' : `check ${joinLabels(labels)}`) : null;

  return (
    <div className={styles.narrow}>
      <div className={styles.titleLine}>
        <h1 className={styles.title}>Checkout</h1>
        <Button href={backHref} variant="ghost">
          Keep shopping
        </Button>
      </div>
      <p className={styles.lede}>{scout ? `Ordering from ${scout.name}` : 'Ordering from Troop 79.'}</p>

      <form ref={formRef} onSubmit={submit} noValidate>
        {/* 1 · Order */}
        <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-labelledby="h1o">
          <h2 id="h1o">Your order</h2>
          {!hasOrder && lastOrder && !leaving ? (
            <p className={styles.meta}>
              You just placed order {lastOrder.orderNumber}. Its page shows how to pay, or lets you cancel it.{' '}
              <Link href={receiptPath(lastOrder.token)}>See order {lastOrder.orderNumber}</Link>
            </p>
          ) : !hasOrder ? (
            <p className={styles.meta}>
              Your cart is empty. <Link href={backHref}>Back to the wreaths</Link>
            </p>
          ) : lines.length === 0 ? null : (
            <ul className={styles.lines}>
              {lines.map((l) => {
                const label = itemLabel(l.item) + (l.donated ? ', donated' : '');
                return (
                  <li key={l.key} className={styles.line}>
                    {l.item.imageUrl ? <ProductPhoto item={l.item} className={styles.lineThumb} /> : <span className={styles.lineThumb} />}
                    <span className={styles.lName}>
                      {itemLabel(l.item)} {l.donated && <span className={styles.tag}>Donated to veterans</span>}
                      <small>
                        {fmtMoney(l.item.price)} each{l.donated ? ' · not delivered to you' : ''}
                      </small>
                    </span>
                    <Stepper
                      id={`co-qty-${l.key}`}
                      value={l.qty}
                      min={1}
                      max={50}
                      groupLabel={`Quantity, ${label}`}
                      lessLabel={`One fewer ${label}`}
                      moreLabel={`One more ${label}`}
                      inputLabel={`Quantity, ${label}`}
                      onChange={(n) => setQty(lineKey(l.itemId, l.donated), n)}
                    />
                    <span className={styles.lAmt}>{fmtMoney(l.item.price * l.qty)}</span>
                    <button type="button" className={`${styles.linkBtn} ${styles.linkBtnDanger}`} aria-label={`Remove ${label}`} onClick={() => setQty(l.key, 0)}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasOrder && (
            <div className={styles.giftWrap}>
              <div className={styles.fieldLabel} id="giftLbl">
                {lines.length > 0 ? (
                  <>
                    Add a donation to Troop 79 <span className={styles.meta}>optional</span>
                  </>
                ) : (
                  DONATION_LABEL
                )}
              </div>
              <div className={styles.seg} role="group" aria-labelledby="giftLbl">
                {GIFTS.filter((g) => g > 0 || lines.length > 0).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={!giftOther && cart.donation === g}
                    onClick={() => {
                      setGiftOther(false);
                      setDonation(g);
                    }}
                  >
                    {g === 0 ? 'None' : `$${g}`}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={giftOther || (cart.donation > 0 && !GIFTS.includes(cart.donation))}
                  onClick={() => {
                    setGiftOther(true);
                    setGiftText(cart.donation > 0 && !GIFTS.includes(cart.donation) ? String(cart.donation) : '');
                  }}
                >
                  Other
                </button>
              </div>
              {giftOther && (
                <div className={styles.giftOther}>
                  <Field label="Donation amount" problem={problemFor('gift')}>
                    <TextInput
                      type="number"
                      min={1}
                      step={1}
                      inputMode="decimal"
                      value={giftText}
                      onChange={(e) => {
                        setGiftText(e.target.value);
                        // The cart keeps the amount, so Keep shopping and back shows the same donation.
                        const n = parseDonation(e.target.value);
                        if (n != null) setDonation(n);
                      }}
                    />
                  </Field>
                </div>
              )}
              <p className={styles.meta}>{scout ? `A donation goes to the troop, and part of it to ${scout.firstName}’s scout account.` : 'A donation goes to the troop.'}</p>
            </div>
          )}
        </section>

        {/* 2 · Getting your wreaths — a donation with no wreath has nothing to deliver (W-3). */}
        {!donationOnly && (
        <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-labelledby="h2f">
          <h2 id="h2f">Getting your wreaths</h2>
          {lines.length === 0 ? (
            <p className={styles.meta}>Add something to your cart first.</p>
          ) : allDonated ? (
            <p className={styles.prose}>Nothing to deliver. Donated wreaths go straight to veterans.</p>
          ) : scout ? (
            <>
              <p className={styles.prose}>
                <strong>{scout.name} delivers your order</strong>
                {distributionDay ? `, after distribution day, ${distributionDay}` : ''}.
              </p>
              <ZipField zip={zip} setZip={setZip} problem={problemFor('zip')} />
              {zipFive && !zipIn && (
                <Notice tone="warning" className={styles.inset}>
                  <p>
                    {zipTrim} is outside our delivery area (zips starting with {zipPrefixText(rules.deliveryZipPrefix)}). {scout.firstName} can deliver farther only to family who have arranged it.
                  </p>
                  <label className={`${styles.check} ${problemFor('relative') ? styles.checkBad : ''}`}>
                    <input type="checkbox" checked={relative} aria-invalid={problemFor('relative') ? true : undefined} onChange={(e) => setRelative(e.target.checked)} />
                    <span>I am a relative, and {scout.firstName} has agreed to deliver to me</span>
                  </label>
                  <FieldProblem>{problemFor('relative')}</FieldProblem>
                  <p>
                    Not family? <Link href={`/wreaths/${scout.slug}#vets`}>Donate a wreath to veterans</Link> instead, and {scout.firstName} still gets credit.
                  </p>
                </Notice>
              )}
              {zipIn && <p className={styles.zipOk}>{scout.firstName} delivers to {zipTrim}.</p>}
            </>
          ) : (
            <>
              <div className={`${styles.choice} ${problemFor('method') ? styles.choiceBad : ''}`} role="radiogroup" aria-label="Pickup or delivery" aria-invalid={problemFor('method') ? true : undefined}>
                <label className={styles.choiceCard}>
                  <input type="radio" name="method" value="pickup" checked={method === 'pickup'} onChange={() => setMethod('pickup')} />
                  <span>
                    <strong>Pick up</strong>
                    <span>{pickupText}</span>
                  </span>
                </label>
                <label className={styles.choiceCard}>
                  <input type="radio" name="method" value="delivery" checked={method === 'delivery'} onChange={() => setMethod('delivery')} />
                  <span>
                    <strong>Delivery</strong>
                    <span>
                      Milwaukee-area zips starting with {zipPrefixText(rules.deliveryZipPrefix)} · {fmtMoney(rules.deliveryFee)}, free at {fmtMoney(rules.deliveryFreeAt)}
                    </span>
                  </span>
                </label>
              </div>
              <FieldProblem>{problemFor('method')}</FieldProblem>
              {method === 'delivery' && (
                <div className={styles.inset}>
                  <ZipField zip={zip} setZip={setZip} problem={problemFor('zip')} />
                  {zipFive && !zipIn && (
                    <Notice tone="error" className={styles.inset}>
                      <p>
                        <strong>We can’t deliver to {zipTrim}.</strong> Troop delivery covers Milwaukee-area zips starting with {zipPrefixText(rules.deliveryZipPrefix)}.
                      </p>
                      <p>
                        You can pick up instead: {pickupText}.{' '}
                        <button type="button" className={styles.linkBtn} onClick={() => setMethod('pickup')}>
                          Switch to pickup
                        </button>
                      </p>
                    </Notice>
                  )}
                  {zipIn && <p className={styles.zipOk}>We deliver to {zipTrim}.</p>}
                </div>
              )}
            </>
          )}
        </section>
        )}

        {!scout && hasOrder && (
          <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-label="Scout credit">
            <CreditPicker
              search={searchSellers}
              picked={credit}
              onPick={setCredit}
              problem={problemFor('credit')}
              hint={lines.length > 0 ? 'Type at least 2 letters. 30% of the profit on your order goes into their scout account.' : 'Type at least 2 letters. Part of your donation goes into their scout account.'}
            />
          </section>
        )}

        {/* 3 · Your details */}
        <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-labelledby="h3c">
          <h2 id="h3c">Your details</h2>
          <div className={styles.fields}>
            <Field label="Name" problem={problemFor('name')} className={styles.fieldFull}>
              <TextInput type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email" problem={problemFor('email')}>
              <TextInput type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={donationOnly ? <>Phone <span className={styles.meta}>optional</span></> : 'Phone'} problem={problemFor('phone')}>
              <TextInput type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            {needsAddress && (
              <>
                <Field label="Street address" problem={problemFor('street')} className={styles.fieldFull}>
                  <TextInput type="text" autoComplete="street-address" value={street} onChange={(e) => setStreet(e.target.value)} />
                </Field>
                <Field label="City" problem={problemFor('city')}>
                  <TextInput type="text" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} />
                </Field>
              </>
            )}
          </div>
          <p className={styles.meta}>
            We email your receipt. Your phone and address go only to the troop leaders{scout ? ' and the family delivering your order' : ''}.
          </p>
          {/* Honeypot: people never see or fill this; scripts do. */}
          <div className={styles.hp} aria-hidden="true">
            <label>
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
        </section>

        {/* 4 · Total */}
        <section className={`${styles.card} ${styles.pad} ${styles.step}`} aria-labelledby="h4p">
          <h2 id="h4p">Total</h2>
          <dl className={styles.sumRows}>
            {lines.length > 0 && (
              <div>
                <dt>
                  {lines.reduce((n, l) => n + l.qty, 0)} item{lines.reduce((n, l) => n + l.qty, 0) === 1 ? '' : 's'}
                </dt>
                <dd>{fmtMoney2(fromCents(itemsCents))}</dd>
              </div>
            )}
            {delivery > 0 && (
              <div>
                <dt>Delivery</dt>
                <dd>{fmtMoney2(delivery)}</dd>
              </div>
            )}
            {giftAmount > 0 && (
              <div>
                <dt>{DONATION_LABEL}</dt>
                <dd>{fmtMoney2(giftAmount)}</dd>
              </div>
            )}
            {cardFee > 0 && (
              <div>
                <dt>Card fee</dt>
                <dd>{fmtMoney2(cardFee)}</dd>
              </div>
            )}
            <div className={styles.sumTotal}>
              <dt>Total</dt>
              <dd>{fmtMoney2(total)}</dd>
            </div>
          </dl>
          {cardLive && startCard ? (
            <>
              <div className={styles.choice} role="radiogroup" aria-label="How you’ll pay">
                <label className={styles.choiceCard}>
                  <input type="radio" name="pay" value="treasurer" checked={payBy === 'treasurer'} onChange={() => setPayBy('treasurer')} />
                  <span>
                    <strong>Venmo or PayPal · no fee</strong>
                    <span>
                      Pay after you place the order: Venmo {PAY_TREASURER.venmoHandle} or PayPal to {PAY_TREASURER.paypalEmail} (Friends and family), with your order number in the note.
                    </span>
                  </span>
                </label>
                <label className={styles.choiceCard}>
                  <input type="radio" name="pay" value="card" checked={payBy === 'card'} onChange={() => setPayBy('card')} />
                  <span>
                    <strong>Card, Apple Pay or Google Pay</strong>
                    <span>Pay now on Stripe’s secure page.</span>
                  </span>
                </label>
              </div>
              {payBy === 'card' && fee > 0 && (
                <label className={styles.check}>
                  <input type="checkbox" checked={coverCardFee} onChange={(e) => setCoverCardFee(e.target.checked)} />
                  <span>Add {fmtMoney2(fee)} to cover the card fee, so the troop keeps the whole amount</span>
                </label>
              )}
            </>
          ) : (
            <Notice tone="info">
              <div className={styles.payHow}>
                <p>
                  <strong>You pay after you place the order.</strong> Venmo {PAY_TREASURER.venmoHandle} or PayPal to {PAY_TREASURER.paypalEmail} (Friends and family), with your order number in the note.
                </p>
                <p>The next page and your email show the amount and the links. Nothing is charged online.</p>
              </div>
            </Notice>
          )}
          {serverProblem && !serverProblem.field && (
            <Notice tone="error" className={styles.inset}>
              {serverProblem.message}
            </Notice>
          )}
          <div className={styles.submitRow}>
            <Button type="submit" disabled={busy || leaving}>
              {busy || leaving ? 'Placing your order…' : donationOnly ? (payByCard ? 'Donate and pay by card' : 'Donate') : payByCard ? 'Place order and pay by card' : 'Place order'}
            </Button>
            {blockedReason && <SaveProblem action="place the order" reason={blockedReason} />}
            {!blockedReason && serverProblem?.field && <SaveProblem action="place the order" reason={serverProblem.message} />}
          </div>
        </section>
      </form>
    </div>
  );
}

function ZipField({ zip, setZip, problem }: { zip: string; setZip: (z: string) => void; problem?: string }) {
  return (
    <div className={styles.zipRow}>
      <Field label="Delivery zip" problem={problem}>
        <TextInput type="text" inputMode="numeric" maxLength={5} autoComplete="postal-code" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} />
      </Field>
    </div>
  );
}

/**
 * "Know a scout in Troop 79? Give them credit (optional)": collapsed, the order goes to the troop. Opened, a few letters
 * of a first name ask the SERVER for matches ("First L." only; the roster never reaches the browser). Credit only: the
 * scout does not deliver, and the pickup / delivery choice above is unchanged.
 */
function CreditPicker({ search, picked, onPick, problem, hint }: { search: CheckoutProps['searchSellers']; picked: SellerMatch | null; onPick: (m: SellerMatch | null) => void; problem?: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<SellerMatch[] | null>(null);
  const seq = useRef(0);

  async function type(v: string) {
    setQ(v);
    const n = ++seq.current;
    if (v.trim().length < 2) {
      setMatches(null);
      return;
    }
    const found = await search(v);
    if (n === seq.current) setMatches(found);
  }

  // Picked: one line naming the scout, with Change (search again) and Remove (back to the troop). No separate
  // "Credit: …" line in any state — the opener or this line already says it (Patrick, 2026-10-13).
  if (picked) {
    return (
      <div>
        <p className={styles.prose}>
          <strong>{picked.name}</strong> gets credit for this order. The troop still handles your pickup or delivery.
        </p>
        <p className={styles.creditActions}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => {
              onPick(null);
              setOpen(true);
            }}
          >
            Change
          </button>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
          >
            Remove
          </button>
        </p>
      </div>
    );
  }

  return (
    <div>
      <button type="button" className={`${styles.linkBtn} ${styles.creditToggle}`} aria-expanded={open} aria-controls="credit-box" onClick={() => setOpen((o) => !o)}>
        Know a scout in Troop 79? Give them credit (optional)
      </button>
      {open && (
        <div id="credit-box" className={styles.inset}>
          {/* Chrome ignores autocomplete="off" on a field it takes for a name and lays the visitor's own saved
              contacts over this list; an unrecognised token turns that off, and the label and hint stay clear of
              its "first … name" pattern (2026-10-13). */}
          <Field label="Which scout?" hint={hint} problem={problem}>
            <TextInput type="search" name="scout_lookup" autoComplete="troop79-scout-search" value={q} onChange={(e) => type(e.target.value)} />
          </Field>
              {matches && matches.length === 0 && <p className={styles.meta}>No scout found with that name. The order will go to Troop 79.</p>}
              {matches && matches.length > 0 && (
                <ul className={styles.lines} aria-label="Matching scouts">
                  {matches.map((m) => (
                    <li key={m.id} className={styles.line}>
                      <span className={styles.lName}>{m.name}</span>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        aria-label={`Give ${m.name} credit`}
                        onClick={() => {
                          onPick(m);
                          setQ('');
                          setMatches(null);
                        }}
                      >
                        Give credit
                      </button>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
      {!open && problem && <p className={styles.badNote}>{problem}</p>}
    </div>
  );
}
