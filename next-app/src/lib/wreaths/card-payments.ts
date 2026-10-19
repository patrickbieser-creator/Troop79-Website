import type { SupabaseClient } from '@supabase/supabase-js';
import { checkoutIdempotencyKey, checkoutLineItems, withCardFeeCover, cardLedger, cardRefundRows, type CardOrder } from './card-checkout';
import { fromCents, toCents } from './rules';

/**
 * Release B card payments (Plans/Wreath-Stripe-Checkout.md, 2026-10-15) — the server half: start a Stripe Checkout
 * Session for an order, expire an open one, apply Stripe's webhook events, and ask Stripe for a refund. Stripe and the
 * database are injected so the tests run against the real local database with Stripe faked at the edge.
 *
 * Rules that ride with it (tech-lead + qa-lead reviews):
 *   - What Stripe charges is built only from the order row; the webhook's SQL function re-checks the amount.
 *   - Every webhook effect lands in ONE SQL function call together with its stripe_events row, so a failure leaves no
 *     trace and Stripe's retry is processed; any database error throws (the route answers 500).
 *   - Only the customer's email goes to Stripe — never the name, phone or address.
 */

/** The slice of the Stripe SDK this module uses — narrow on purpose so the tests can fake it. */
export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>, opts: { idempotencyKey: string }): Promise<{ id: string; url: string | null; status: string | null; amount_total: number | null }>;
      retrieve(id: string): Promise<{ id: string; url: string | null; status: string | null; amount_total: number | null }>;
      expire(id: string): Promise<unknown>;
    };
  };
  paymentIntents: {
    retrieve(id: string, opts?: Record<string, unknown>): Promise<{ id: string; latest_charge: unknown; metadata?: Record<string, string> }>;
  };
  balanceTransactions: { retrieve(id: string): Promise<{ fee: number }> };
  refunds: { create(params: { payment_intent: string; reason?: string }, opts: { idempotencyKey: string }): Promise<{ id: string }> };
}

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface CardDeps {
  supabase: SupabaseClient;
  stripe: StripeLike;
  /** cardCheckoutLive() — both Stripe secrets configured. */
  live: boolean;
  siteUrl: string;
  /** Central-time calendar day for ledger rows. */
  today: () => string;
  /** The start action's caller IP (platform header; null in local dev) and test overrides of the hourly limits. */
  ip?: string | null;
  limits?: Partial<typeof CHECKOUT_LIMITS>;
}

/** Checkout Sessions the public start action may CREATE per hour (reusing an open one is free) — qa-lead, 2026-10-15. */
export const CHECKOUT_LIMITS = { perIpHour: 20, globalHour: 300 };

/** A customer may open this many Checkout Sessions on one order (each fee-cover change after an expiry is one). */
export const MAX_CHECKOUTS_PER_ORDER = 20;

const ORDER_COLS =
  'id, order_number, public_token, status, payment_status, needs_refund, paid_method, paid_amount, total, items_subtotal, delivery_fee, gift, ' +
  'fee_covered, customer_name, customer_email, stripe_session_id, stripe_checkout_count, stripe_payment_intent_id, ' +
  'wreath_sales(year, fee_percent, fee_fixed), wreath_order_lines(quantity, donated, unit_price, wreath_items(name, size))';

interface OrderRow {
  id: number;
  order_number: string;
  public_token: string;
  status: string;
  payment_status: string;
  needs_refund: string | null;
  paid_method: string | null;
  paid_amount: number | null;
  total: number;
  items_subtotal: number;
  delivery_fee: number;
  gift: number;
  fee_covered: number;
  customer_name: string;
  customer_email: string | null;
  stripe_session_id: string | null;
  stripe_checkout_count: number;
  stripe_payment_intent_id: string | null;
  wreath_sales: { year: number; fee_percent: number; fee_fixed: number } | null;
  wreath_order_lines: { quantity: number; donated: boolean; unit_price: number; wreath_items: { name: string; size: string } | null }[];
}

async function loadOrder(sb: SupabaseClient, col: 'id' | 'public_token' | 'stripe_payment_intent_id', value: string | number): Promise<OrderRow | null> {
  const { data, error } = await sb.from('wreath_orders').select(ORDER_COLS).eq(col, value).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as OrderRow) ?? null;
}

function cardOrderOf(o: OrderRow, money: { feeCovered: number; total: number }): CardOrder {
  return {
    id: o.id,
    orderNumber: o.order_number,
    itemsSubtotal: Number(o.items_subtotal),
    deliveryFee: Number(o.delivery_fee),
    gift: Number(o.gift),
    feeCovered: money.feeCovered,
    total: money.total,
    lines: o.wreath_order_lines.map((l) => ({
      name: l.wreath_items?.name ?? 'Wreath',
      size: l.wreath_items?.size ?? '',
      quantity: l.quantity,
      unitPrice: Number(l.unit_price),
      donated: l.donated
    }))
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Starts (or resumes) paying an order by card. Keyed by the order's public token — the receipt link's bearer
 * credential — so no sign-in. Recomputes the fee cover on the server for the customer's choice; a still-open session
 * for the same amount is reused, any other open session is expired first so an order never has two payable sessions.
 */
export async function startCardCheckout(input: { token: string; coverFee: boolean }, deps: CardDeps): Promise<StartResult> {
  if (!deps.live) return { ok: false, error: 'Card payment isn’t available yet. Please use Venmo or PayPal.' };
  if (!UUID_RE.test(input.token)) return { ok: false, error: 'We couldn’t find that order.' };
  const sb = deps.supabase;
  const o = await loadOrder(sb, 'public_token', input.token);
  if (!o || !o.wreath_sales) return { ok: false, error: 'We couldn’t find that order.' };
  if (o.status !== 'placed') return { ok: false, error: 'This order was cancelled, so it can’t be paid.' };
  if (o.payment_status !== 'unpaid' || o.needs_refund) return { ok: false, error: 'This order is already paid.' };

  const money = withCardFeeCover(
    { itemsSubtotal: Number(o.items_subtotal), deliveryFee: Number(o.delivery_fee), gift: Number(o.gift) },
    { feePercent: Number(o.wreath_sales.fee_percent), feeFixed: Number(o.wreath_sales.fee_fixed) },
    input.coverFee
  );

  if (o.stripe_session_id) {
    const open = await deps.stripe.checkout.sessions.retrieve(o.stripe_session_id).catch(() => null);
    if (open?.status === 'open' && open.amount_total === toCents(money.total) && open.url) return { ok: true, url: open.url };
    if (open?.status === 'open') await deps.stripe.checkout.sessions.expire(o.stripe_session_id).catch(() => undefined);
  }
  const busy = { ok: false as const, error: 'Too many tries on this order. Please pay by Venmo or PayPal, or reply to your order email.' };
  if (o.stripe_checkout_count >= MAX_CHECKOUTS_PER_ORDER) return busy;
  const limits = { ...CHECKOUT_LIMITS, ...deps.limits };
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recent = () => sb.from('wreath_checkout_starts').select('id', { count: 'exact', head: true }).gte('created_at', hourAgo);
  if (((await recent()).count ?? 0) >= limits.globalHour) return busy;
  if (deps.ip && ((await recent().eq('ip', deps.ip)).count ?? 0) >= limits.perIpHour) return busy;

  const attempt = o.stripe_checkout_count + 1;
  const { data: claimed, error: claimError } = await sb
    .from('wreath_orders')
    .update({ fee_covered: money.feeCovered, total: money.total, stripe_checkout_count: attempt, stripe_session_id: null })
    .eq('id', o.id)
    .eq('status', 'placed')
    .eq('payment_status', 'unpaid')
    .eq('stripe_checkout_count', o.stripe_checkout_count)
    .select('id')
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { ok: false, error: 'This order just changed. Reload the page and try again.' };

  const cardOrder = cardOrderOf(o, money);
  let session;
  try {
    session = await deps.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: checkoutLineItems(cardOrder).map((i) => ({
          price_data: { currency: 'usd', product_data: { name: i.name }, unit_amount: i.unitAmount },
          quantity: i.quantity
        })),
        client_reference_id: String(o.id),
        metadata: { order_id: String(o.id), order_number: o.order_number },
        payment_intent_data: { description: `Troop 79 wreath order ${o.order_number}`, metadata: { order_id: String(o.id), order_number: o.order_number } },
        ...(o.customer_email ? { customer_email: o.customer_email } : {}),
        adaptive_pricing: { enabled: false },
        success_url: `${deps.siteUrl}/wreaths/order/${o.public_token}?card=return`,
        cancel_url: `${deps.siteUrl}/wreaths/order/${o.public_token}?card=cancelled`
      },
      { idempotencyKey: checkoutIdempotencyKey(cardOrder, attempt) }
    );
  } catch (e) {
    // Put the money back the way it was; the attempt stays counted.
    await sb.from('wreath_orders').update({ fee_covered: Number(o.fee_covered), total: Number(o.total) }).eq('id', o.id).eq('payment_status', 'unpaid');
    console.error('[wreaths] Stripe session create failed', o.id, stripeErrorText(e));
    return { ok: false, error: 'Card payment isn’t working right now. Please try again, or pay by Venmo or PayPal.' };
  }
  await sb.from('wreath_checkout_starts').insert({ order_id: o.id, ip: deps.ip ?? '' });
  if (!session.url) return { ok: false, error: 'Card payment isn’t working right now. Please try again, or pay by Venmo or PayPal.' };
  // Still placed and unpaid: an admin cancel or Mark paid during this start must not get a live session stored on it.
  const { data: saved, error: saveError } = await sb
    .from('wreath_orders')
    .update({ stripe_session_id: session.id })
    .eq('id', o.id)
    .eq('status', 'placed')
    .eq('payment_status', 'unpaid')
    .select('id')
    .maybeSingle();
  if (saveError) throw new Error(saveError.message);
  if (!saved) {
    await deps.stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    return { ok: false, error: 'This order just changed. Reload the page.' };
  }
  return { ok: true, url: session.url };
}

/**
 * Expires the order's open Checkout Session, if any, and forgets it. Called before anything changes what the order
 * owes or whether it is still payable (reprice, reassign, cancel, Mark paid, a scout's edit), so a stale session can't
 * be paid. Never throws for Stripe's sake: a session that already expired or completed is simply forgotten — a payment
 * that did complete is caught by the webhook's checks and flagged for a refund.
 */
export async function expireOpenCheckout(orderId: number, deps: Pick<CardDeps, 'supabase' | 'stripe'>): Promise<void> {
  const { data } = await deps.supabase.from('wreath_orders').select('stripe_session_id').eq('id', orderId).maybeSingle();
  const sessionId = (data as { stripe_session_id: string | null } | null)?.stripe_session_id;
  if (!sessionId) return;
  await deps.stripe.checkout.sessions.expire(sessionId).catch(() => undefined);
  await deps.supabase.from('wreath_orders').update({ stripe_session_id: null }).eq('id', orderId).eq('stripe_session_id', sessionId);
}

/**
 * Before a customer cancels their own order (lib/wreaths/customer-cancel.ts): expires the open Checkout Session and
 * says whether the order is clear to cancel. Unlike expireOpenCheckout it never assumes: a session that completed, or
 * one Stripe can't confirm is closed, means a payment may be going through, so the cancel waits (qa-lead, 2026-10-16:
 * paid in one tab and cancelled in another before the webhook landed would charge a cancelled order).
 */
export async function closeCheckoutForCancel(orderId: number, deps: Pick<CardDeps, 'supabase' | 'stripe'>): Promise<'clear' | 'paying'> {
  const { data } = await deps.supabase.from('wreath_orders').select('stripe_session_id').eq('id', orderId).maybeSingle();
  const sessionId = (data as { stripe_session_id: string | null } | null)?.stripe_session_id;
  if (!sessionId) return 'clear';
  try {
    let session = await deps.stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'open') {
      await deps.stripe.checkout.sessions.expire(sessionId).catch(() => undefined);
      session = await deps.stripe.checkout.sessions.retrieve(sessionId);
    }
    if (session.status !== 'expired') return 'paying';
  } catch (e) {
    console.warn(`[wreaths] couldn't close checkout ${sessionId} before a customer cancel: ${stripeErrorText(e)}`);
    return 'paying';
  }
  await deps.supabase.from('wreath_orders').update({ stripe_session_id: null }).eq('id', orderId).eq('stripe_session_id', sessionId);
  return 'clear';
}

async function settledFee(stripe: StripeLike, paymentIntent: string): Promise<number | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ['latest_charge.balance_transaction'] });
    const charge = pi.latest_charge as { balance_transaction?: { fee?: number } | string | null } | null;
    const bt = charge?.balance_transaction;
    if (bt && typeof bt === 'object' && typeof bt.fee === 'number') return fromCents(bt.fee);
    if (typeof bt === 'string') return fromCents((await stripe.balanceTransactions.retrieve(bt)).fee);
    console.info(`[stripe] fee for ${paymentIntent} not settled yet; it follows on charge.updated`);
    return null;
  } catch (e) {
    // Income is booked now; the fee follows on charge.updated. Say why, so a missing key permission is visible.
    console.warn(`[stripe] fee lookup for ${paymentIntent} failed: ${stripeErrorText(e)}`);
    return null;
  }
}

/** The order's live donation ledger row (W-3), if its payment booked one. */
async function liveDonationRow(sb: SupabaseClient, orderId: number): Promise<{ id: number } | null> {
  const { data, error } = await sb.from('financial_transactions').select('id').eq('wreath_order_id', orderId).eq('ledger_role', 'donation').is('voided_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: number } | null) ?? null;
}

async function rpc(sb: SupabaseClient, fn: string, p: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.rpc(fn, { p });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return String(data);
}

/**
 * Applies one verified Stripe event. Returns what happened (for the log and the tests); throws on any database error
 * so the route answers 500 and Stripe retries.
 */
export async function handleStripeEvent(event: StripeEventLike, deps: CardDeps): Promise<string> {
  const sb = deps.supabase;
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.payment_status !== 'paid') return 'ignored';
      const orderId = Number(obj.client_reference_id ?? (obj.metadata as Record<string, string> | undefined)?.order_id);
      const pi = String(obj.payment_intent ?? '');
      if (!Number.isInteger(orderId) || !pi) return 'ignored';
      const o = await loadOrder(sb, 'id', orderId);
      if (!o) return 'unknown_order';
      // The session must be one we made for THIS order: both ids we set agree, and the order number matches.
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      if (meta.order_id !== String(orderId) || meta.order_number !== o.order_number) {
        console.warn(`[stripe] ${event.id}: session ${String(obj.id)} does not match order ${orderId}; ignored`);
        return 'ignored';
      }
      const paid = fromCents(Number(obj.amount_total ?? 0));
      const fee = await settledFee(deps.stripe, pi);
      // W-3: the donation is its own ledger row, net of its share of the fee.
      const rows = cardLedger({ orderNumber: o.order_number, customerName: o.customer_name, total: paid, gift: Number(o.gift), fee, saleYear: o.wreath_sales?.year ?? Number(deps.today().slice(0, 4)), today: deps.today() });
      return rpc(sb, 'wreath_record_card_payment', {
        event_id: event.id,
        event_type: event.type,
        order_id: orderId,
        payment_intent: pi,
        amount_cents: Number(obj.amount_total ?? 0),
        currency: String(obj.currency ?? ''),
        fee,
        income: rows.income,
        donation_row: rows.donation,
        fee_row: rows.feeRow
      });
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      // The card fee cover was chosen for this session only: an unpaid order drops it, so the Venmo / PayPal total
      // (and a later Mark paid) is what the order really owes.
      const { data: rows, error: readError } = await sb.from('wreath_orders').select('id, total, fee_covered, payment_status').eq('stripe_session_id', String(obj.id));
      if (readError) throw new Error(readError.message);
      for (const r of (rows ?? []) as { id: number; total: number; fee_covered: number; payment_status: string }[]) {
        const drop = r.payment_status === 'unpaid' ? { fee_covered: 0, total: fromCents(toCents(Number(r.total)) - toCents(Number(r.fee_covered))) } : {};
        const { error } = await sb.from('wreath_orders').update({ stripe_session_id: null, ...drop }).eq('id', r.id).eq('stripe_session_id', String(obj.id));
        if (error) throw new Error(error.message);
      }
      return 'cleared';
    }
    case 'charge.updated': {
      const pi = String(obj.payment_intent ?? '');
      const bt = obj.balance_transaction;
      if (!pi || !bt) return 'ignored';
      const o = await loadOrder(sb, 'stripe_payment_intent_id', pi);
      if (!o || o.paid_method !== 'card') {
        // Stripe often sends this BEFORE checkout.session.completed (production, 2026-10-16). If the charge belongs to
        // one of our orders that is still waiting for its payment, throw so the route answers 500 and Stripe retries
        // after the payment lands; any other charge is not ours to book.
        const intent = await deps.stripe.paymentIntents.retrieve(pi);
        const orderId = Number(intent.metadata?.order_id);
        if (Number.isInteger(orderId) && orderId > 0) {
          const pending = await loadOrder(sb, 'id', orderId);
          if (pending && pending.status === 'placed' && pending.payment_status === 'unpaid') {
            throw new Error(`order ${pending.order_number} is not paid yet; Stripe will retry the fee`);
          }
        }
        return 'ignored';
      }
      const feeCents = typeof bt === 'string' ? (await deps.stripe.balanceTransactions.retrieve(bt)).fee : Number((bt as { fee?: number }).fee ?? 0);
      const fee = fromCents(feeCents);
      // The donation's share of the fee nets its ledger row — only when the payment booked one (an order paid by card
      // before W-3 carries its gift inside the payment row, so the whole fee stays one expense row).
      const donationRow = await liveDonationRow(sb, o.id);
      const gift = donationRow ? Number(o.gift) : 0;
      const rows = cardLedger({ orderNumber: o.order_number, customerName: o.customer_name, total: Number(o.paid_amount ?? o.total), gift, fee, saleYear: o.wreath_sales?.year ?? Number(deps.today().slice(0, 4)), today: deps.today() });
      if (!donationRow) {
        if (!rows.feeRow) return 'ignored';
        return rpc(sb, 'wreath_record_card_fee', { event_id: event.id, event_type: event.type, payment_intent: pi, fee, fee_row: rows.feeRow });
      }
      return rpc(sb, 'wreath_record_card_fee', { event_id: event.id, event_type: event.type, payment_intent: pi, fee, fee_row: rows.feeRow, donation_amount: rows.donation?.amount ?? 0 });
    }
    case 'charge.refunded': {
      const pi = String(obj.payment_intent ?? '');
      if (!pi) return 'ignored';
      const { data: due } = await sb.from('wreath_card_refunds_due').select('order_id').eq('payment_intent', pi).maybeSingle();
      if (due) {
        // A stray payment being returned: no ledger row (its income was never booked) — the SQL function closes it.
        return rpc(sb, 'wreath_record_card_refund', { event_id: event.id, event_type: event.type, payment_intent: pi, amount_refunded_cents: Number(obj.amount_refunded ?? 0), refund_row: null });
      }
      const o = await loadOrder(sb, 'stripe_payment_intent_id', pi);
      if (!o) return 'unknown_intent';
      const amount = Number(o.paid_amount ?? o.total);
      // The donation row (W-3) is reversed on its own; an order booked before W-3 reverses as one row.
      const gift = (await liveDonationRow(sb, o.id)) ? Number(o.gift) : 0;
      const rows = cardRefundRows({ orderNumber: o.order_number, customerName: o.customer_name, amount, gift, saleYear: o.wreath_sales?.year ?? Number(deps.today().slice(0, 4)), today: deps.today() });
      return rpc(sb, 'wreath_record_card_refund', { event_id: event.id, event_type: event.type, payment_intent: pi, amount_refunded_cents: Number(obj.amount_refunded ?? 0), refund_row: rows.refund, donation_refund_row: rows.donationRefund });
    }
    default:
      return 'ignored';
  }
}

/** A Stripe error for the log: type, code, request id and message, plus the network cause a StripeConnectionError
 *  keeps in `detail` ("connection to Stripe" alone said nothing, production 2026-10-16). Never includes the key. */
export function stripeErrorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const s = e as Error & { type?: string; code?: string; requestId?: string; detail?: unknown };
  const parts = [s.type, s.code, s.requestId, e.message].filter(Boolean);
  const d = s.detail as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } } | undefined;
  if (d) parts.push(`cause: ${[d.name, d.code, d.message, d.cause?.code, d.cause?.message].filter(Boolean).join(' ')}`);
  return parts.join(' | ');
}

export type RefundResult = { ok: true; refundId: string; stray: boolean } | { ok: false; error: string };

/**
 * Asks Stripe to return card money on an order. When stray card payments are queued for it (wreath_card_refunds_due),
 * exactly those are refunded and the order's own payment is left alone; otherwise the order's own card payment is
 * refunded in full. PaymentIntents and amounts come from the database; one idempotency key per PaymentIntent, so a
 * second click returns the same refund. The charge.refunded webhook records the outcome.
 */
export async function refundCardOrderCore(orderId: number, deps: Pick<CardDeps, 'supabase' | 'stripe'>): Promise<RefundResult> {
  const o = await loadOrder(deps.supabase, 'id', orderId);
  if (!o) return { ok: false, error: 'That order no longer exists.' };
  const { data: dueRows } = await deps.supabase.from('wreath_card_refunds_due').select('payment_intent').eq('order_id', o.id).is('refunded_at', null);
  const stray = ((dueRows ?? []) as { payment_intent: string }[]).map((d) => d.payment_intent);
  let targets: string[];
  if (stray.length) targets = stray;
  else if (o.paid_method === 'card' && o.payment_status === 'paid' && o.stripe_payment_intent_id) targets = [o.stripe_payment_intent_id];
  else if (o.payment_status === 'refunded') return { ok: false, error: 'That order was already refunded.' };
  else return { ok: false, error: 'Only an order paid by card can be refunded here. Return Venmo, PayPal, cash or check payments by hand.' };
  try {
    const ids: string[] = [];
    for (const pi of targets) {
      const r = await deps.stripe.refunds.create({ payment_intent: pi, reason: stray.length ? 'duplicate' : 'requested_by_customer' }, { idempotencyKey: `wreath-refund-${pi}` });
      ids.push(r.id);
    }
    return { ok: true, refundId: ids.join(', '), stray: stray.length > 0 };
  } catch (e) {
    console.error('[wreaths] Stripe refund failed', o.id, stripeErrorText(e));
    return { ok: false, error: 'Stripe couldn’t make the refund. Try again, or refund it in the Stripe Dashboard.' };
  }
}
