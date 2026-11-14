import type { SupabaseClient } from '@supabase/supabase-js';
import { CHECKOUT_LIMITS, handleStripeEvent, settledFee, stripeErrorText, type CardDeps, type StripeEventLike } from '@/lib/wreaths/card-payments';
import { fromCents, toCents } from '@/lib/wreaths/rules';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { cardFeeFor } from './options';

/**
 * Paying an event fee by card (Patrick, 2026-11-13): the server half. One event_card_payments row per Stripe
 * Checkout Session; the webhook books the ledger through SQL functions that also write the stripe_events row, so a
 * failed handler leaves no trace and Stripe's retry is processed (the wreath contract, lib/wreaths/card-payments).
 *
 * Rules that ride with it:
 *   - What is charged comes only from the database: each attending entry's open balance, plus the card fee.
 *   - A party has at most one payable session: an earlier open one is expired first, and a session Stripe says is
 *     completing blocks a second.
 *   - Only the payer's email goes to Stripe, and line items name the event and a first name, nothing else.
 */

export type EventCardDeps = Pick<CardDeps, 'supabase' | 'stripe' | 'live' | 'siteUrl' | 'today' | 'ip' | 'limits'>;

/** Card sessions one party may open on one sign-up. */
export const MAX_CARD_STARTS_PER_PARTY = 20;

export interface CardLine {
  entry_id: number;
  person_id: number | null;
  cents: number;
}

export type EventCardStart = { ok: true; url: string } | { ok: false; error: string };

/** How long a row with no session id counts as "still starting" (the insert → Stripe → save window). */
const STARTING_MS = 60_000;

const BUSY ='Card payment isn’t working right now. Please try again, or pay another way.';

/** What these entries still owe: attending entries with an open balance, in cents. */
export async function cardLinesFor(sb: SupabaseClient, entryIds: number[]): Promise<CardLine[]> {
  if (entryIds.length === 0) return [];
  const [{ data: entries, error: e1 }, { data: balances, error: e2 }] = await Promise.all([
    sb.from('signup_entries').select('id, person_id, status').in('id', entryIds),
    sb.from('signup_entry_balances').select('entry_id, balance').in('entry_id', entryIds)
  ]);
  if (e1 ?? e2) throw new Error((e1 ?? e2)!.message);
  const balanceOf = new Map(((balances ?? []) as { entry_id: number; balance: number }[]).map((b) => [Number(b.entry_id), Number(b.balance)]));
  return ((entries ?? []) as { id: number; person_id: number | null; status: string }[])
    .filter((e) => e.status === 'yes')
    .map((e) => ({ entry_id: Number(e.id), person_id: e.person_id, cents: toCents(balanceOf.get(Number(e.id)) ?? 0) }))
    .filter((l) => l.cents > 0)
    .sort((a, b) => a.entry_id - b.entry_id);
}

/**
 * Starts paying a party's open balance by card and returns Stripe's page. The caller has already proved the visitor
 * may write this household's sign-up and resolved `entryIds` on the server.
 */
export async function startEventCardCheckout(
  input: { signupId: number; eventId: number; householdKey: string; entryIds: number[]; startedByPersonId: number | null; payerEmail?: string | null },
  deps: EventCardDeps
): Promise<EventCardStart> {
  if (!deps.live) return { ok: false, error: 'Card payment isn’t available right now. Please pay another way.' };
  const sb = deps.supabase;
  const lines = await cardLinesFor(sb, input.entryIds);
  if (lines.length === 0) return { ok: false, error: 'Nothing is owed on this signup.' };

  const { data: sig, error: sigError } = await sb
    .from('event_signups')
    .select('id, calendar_entry_id, calendar_entries!inner(title)')
    .eq('id', input.signupId)
    .maybeSingle();
  if (sigError) throw new Error(sigError.message);
  const s = sig as unknown as { calendar_entry_id: number; calendar_entries: { title: string } } | null;
  if (!s || Number(s.calendar_entry_id) !== input.eventId) return { ok: false, error: 'We couldn’t find that signup.' };

  // One payable session per party: close the earlier ones, and wait when one is completing.
  const { data: earlier, error: earlierError } = await sb
    .from('event_card_payments')
    .select('id, status, stripe_session_id, created_at')
    .eq('event_signup_id', input.signupId)
    .eq('household_key', input.householdKey);
  if (earlierError) throw new Error(earlierError.message);
  const rows = (earlier ?? []) as { id: number; status: string; stripe_session_id: string | null; created_at: string }[];
  if (rows.length >= MAX_CARD_STARTS_PER_PARTY) return { ok: false, error: 'Too many tries on this signup. Please pay another way, or ask the treasurer.' };
  for (const r of rows.filter((x) => x.status === 'open')) {
    const closed = await closeSession(r, deps);
    if (closed === 'paying') return { ok: false, error: 'A card payment for this signup is going through. Reload this page in a minute.' };
    if (closed === 'unknown') return { ok: false, error: BUSY };
  }

  const limits = { ...CHECKOUT_LIMITS, ...deps.limits };
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recent = () => sb.from('event_card_payments').select('id', { count: 'exact', head: true }).gte('created_at', hourAgo);
  if (((await recent()).count ?? 0) >= limits.globalHour) return { ok: false, error: BUSY };
  if (deps.ip && ((await recent().eq('ip', deps.ip)).count ?? 0) >= limits.perIpHour) return { ok: false, error: BUSY };

  const dueCents = lines.reduce((n, l) => n + l.cents, 0);
  const feeCents = toCents(cardFeeFor(fromCents(dueCents)));
  const { data: made, error: insertError } = await sb
    .from('event_card_payments')
    .insert({
      event_signup_id: input.signupId,
      calendar_entry_id: s.calendar_entry_id,
      household_key: input.householdKey,
      started_by_person_id: input.startedByPersonId,
      lines,
      due_cents: dueCents,
      fee_cents: feeCents,
      total_cents: dueCents + feeCents,
      ip: deps.ip ?? ''
    })
    .select('id')
    .single();
  // Another start for this party won the race (event_card_payments_one_open_per_party): never two payable sessions.
  if (insertError?.code === '23505') return { ok: false, error: 'The card page is already opening for this signup. Try again in a moment.' };
  if (insertError) throw new Error(insertError.message);
  const paymentId = Number((made as { id: number }).id);

  const personIds = lines.map((l) => l.person_id).filter((v): v is number => v != null);
  const { data: people } = personIds.length ? await sb.from('people').select('id, first_name, display_name').in('id', personIds) : { data: [] };
  const firstName = new Map(((people ?? []) as { id: number; first_name: string | null; display_name: string }[]).map((p) => [p.id, p.first_name || p.display_name.split(' ')[0]]));
  const title = s.calendar_entries.title;
  const items = lines.map((l) => ({ name: `${title} · ${l.person_id != null ? (firstName.get(l.person_id) ?? 'Guest') : 'Guest'}`, cents: l.cents }));
  if (feeCents > 0) items.push({ name: 'Card processing fee', cents: feeCents });

  const back = `${deps.siteUrl}/events/${input.eventId}/signup?household=${encodeURIComponent(input.householdKey)}`;
  const meta = { kind: 'event_fee', event_payment_id: String(paymentId) };
  let session;
  try {
    session = await deps.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: items.map((i) => ({ price_data: { currency: 'usd', product_data: { name: i.name }, unit_amount: i.cents }, quantity: 1 })),
        client_reference_id: `event-${paymentId}`,
        metadata: meta,
        payment_intent_data: { description: `Troop 79 · ${title}`, metadata: meta },
        ...(input.payerEmail ? { customer_email: input.payerEmail } : {}),
        adaptive_pricing: { enabled: false },
        success_url: `${back}&card=return`,
        cancel_url: `${back}&card=cancelled`
      },
      { idempotencyKey: `event-pay-${paymentId}` }
    );
  } catch (e) {
    await sb.from('event_card_payments').update({ status: 'expired' }).eq('id', paymentId).eq('status', 'open');
    console.error('[events] Stripe session create failed', paymentId, stripeErrorText(e));
    return { ok: false, error: BUSY };
  }
  if (!session.url) {
    await sb.from('event_card_payments').update({ status: 'expired' }).eq('id', paymentId).eq('status', 'open');
    return { ok: false, error: BUSY };
  }
  // Still open: a cancel during this start must not leave a payable session on a closed row.
  const { data: saved, error: saveError } = await sb
    .from('event_card_payments')
    .update({ stripe_session_id: session.id })
    .eq('id', paymentId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();
  if (saveError) throw new Error(saveError.message);
  if (!saved) {
    await deps.stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    return { ok: false, error: BUSY };
  }
  return { ok: true, url: session.url };
}

/** Expires a party's open card sessions (their signup is being cancelled). A session Stripe already completed is
 *  left for the webhook: the money arrived and is booked. */
export async function closeOpenEventCheckouts(signupId: number, householdKey: string, deps: Pick<EventCardDeps, 'supabase' | 'stripe'>): Promise<void> {
  const { data } = await deps.supabase
    .from('event_card_payments')
    .select('id, stripe_session_id')
    .eq('event_signup_id', signupId)
    .eq('household_key', householdKey)
    .eq('status', 'open');
  for (const r of (data ?? []) as { id: number; stripe_session_id: string | null }[]) await closeSession(r, deps);
}

/**
 * Closes one open payment row. Fails closed: the row is marked expired only when Stripe confirms its session can no
 * longer be paid. 'paying' = Stripe says it completed (the webhook books it); 'unknown' = Stripe could not be asked
 * or would not expire it, so the row stays open and still blocks a second session.
 */
async function closeSession(
  r: { id: number; stripe_session_id: string | null; created_at?: string },
  deps: Pick<EventCardDeps, 'supabase' | 'stripe'>
): Promise<'closed' | 'paying' | 'unknown'> {
  // No session id yet and just made: another start is between its insert and Stripe's answer. Leave it alone.
  if (!r.stripe_session_id && r.created_at && Date.now() - new Date(r.created_at).getTime() < STARTING_MS) return 'unknown';
  if (r.stripe_session_id) {
    try {
      let s = await deps.stripe.checkout.sessions.retrieve(r.stripe_session_id);
      if (s.status === 'open') {
        await deps.stripe.checkout.sessions.expire(r.stripe_session_id);
        s = await deps.stripe.checkout.sessions.retrieve(r.stripe_session_id);
      }
      if (s.status === 'complete') return 'paying';
      if (s.status !== 'expired') return 'unknown';
    } catch (e) {
      console.warn(`[events] couldn't close card session for payment ${r.id}: ${stripeErrorText(e)}`);
      return 'unknown';
    }
  }
  await deps.supabase.from('event_card_payments').update({ status: 'expired', stripe_session_id: null }).eq('id', r.id).eq('status', 'open');
  return 'closed';
}

async function rpc(sb: SupabaseClient, fn: string, p: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.rpc(fn, { p });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return String(data);
}

async function paymentByIntent(sb: SupabaseClient, pi: string): Promise<{ id: number; status: string } | null> {
  const { data, error } = await sb.from('event_card_payments').select('id, status').eq('stripe_payment_intent_id', pi).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: number; status: string } | null) ?? null;
}

/**
 * Applies one verified Stripe event when it belongs to an event sign-up; returns null when it does not (the wreath
 * handler takes it). Throws on any database error so the route answers 500 and Stripe retries.
 */
export async function handleEventStripeEvent(event: StripeEventLike, deps: EventCardDeps): Promise<string | null> {
  const sb = deps.supabase;
  const obj = event.data.object;
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (meta.kind !== 'event_fee') return null;
      if (obj.payment_status !== 'paid') return 'ignored';
      const paymentId = Number(meta.event_payment_id);
      const pi = String(obj.payment_intent ?? '');
      // Both ids we set must agree: the session is one we made for this payment row.
      if (!Number.isInteger(paymentId) || paymentId <= 0 || !pi || obj.client_reference_id !== `event-${paymentId}`) {
        console.warn(`[stripe] ${event.id}: session ${String(obj.id)} does not match an event payment; ignored`);
        return 'ignored';
      }
      const fee = await settledFee(deps.stripe, pi);
      return rpc(sb, 'event_record_card_payment', {
        event_id: event.id,
        event_type: event.type,
        payment_id: paymentId,
        payment_intent: pi,
        amount_cents: Number(obj.amount_total ?? 0),
        currency: String(obj.currency ?? ''),
        fee,
        occurred_on: deps.today()
      });
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      if (meta.kind !== 'event_fee') return null;
      const { error } = await sb
        .from('event_card_payments')
        .update({ status: 'expired', stripe_session_id: null })
        .eq('stripe_session_id', String(obj.id))
        .eq('status', 'open');
      if (error) throw new Error(error.message);
      return 'cleared';
    }
    case 'charge.updated': {
      const pi = String(obj.payment_intent ?? '');
      const bt = obj.balance_transaction;
      if (!pi) return null;
      const pay = await paymentByIntent(sb, pi);
      if (!pay) {
        // Stripe often sends this before checkout.session.completed. If the charge is for an event payment that is
        // still waiting, throw so Stripe retries after the payment lands; anything else is not ours.
        const intent = await deps.stripe.paymentIntents.retrieve(pi).catch(() => null);
        if (intent?.metadata?.kind !== 'event_fee') return null;
        throw new Error(`event payment ${intent.metadata.event_payment_id} is not booked yet; Stripe will retry the fee`);
      }
      if (!bt || pay.status !== 'paid') return 'ignored';
      const feeCents = typeof bt === 'string' ? (await deps.stripe.balanceTransactions.retrieve(bt)).fee : Number((bt as { fee?: number }).fee ?? 0);
      return rpc(sb, 'event_record_card_fee', { event_id: event.id, event_type: event.type, payment_intent: pi, fee: fromCents(feeCents), occurred_on: deps.today() });
    }
    case 'charge.refunded': {
      const pi = String(obj.payment_intent ?? '');
      if (!pi || !(await paymentByIntent(sb, pi))) return null;
      return rpc(sb, 'event_record_card_refund', {
        event_id: event.id,
        event_type: event.type,
        payment_intent: pi,
        amount_refunded_cents: Number(obj.amount_refunded ?? 0),
        occurred_on: deps.today()
      });
    }
    default:
      return null;
  }
}

/** The webhook's one entry point: an event sign-up payment first, else the wreath sale. */
export async function handleAnyStripeEvent(event: StripeEventLike, deps: CardDeps): Promise<string> {
  const mine = await handleEventStripeEvent(event, deps);
  return mine ?? handleStripeEvent(event, deps);
}

/** A party's scout-account balances and what its entries have paid, for the sign-up form. */
export async function loadPartyMoney(
  sb: SupabaseClient,
  scoutPersonIds: number[],
  entryIds: number[]
): Promise<{ balances: Map<number, number>; paid: number; due: number }> {
  const [tx, { data: bal, error: e2 }, lines] = await Promise.all([
    scoutPersonIds.length
      ? fetchAllRows<{ person_id: number; amount: number }>((from, to) =>
          sb.from('financial_transactions').select('person_id, amount').eq('account', 'scout_account').is('voided_at', null).in('person_id', scoutPersonIds).order('id').range(from, to)
        )
      : Promise.resolve([]),
    entryIds.length ? sb.from('signup_entry_balances').select('entry_id, paid').in('entry_id', entryIds) : Promise.resolve({ data: [], error: null }),
    cardLinesFor(sb, entryIds)
  ]);
  if (e2) throw new Error(e2.message);
  const cents = new Map<number, number>(scoutPersonIds.map((id) => [id, 0]));
  for (const t of tx) cents.set(t.person_id, (cents.get(t.person_id) ?? 0) + toCents(Number(t.amount)));
  const paidCents = ((bal ?? []) as { paid: number }[]).reduce((n, b) => n + toCents(Number(b.paid)), 0);
  return {
    balances: new Map([...cents].map(([id, c]) => [id, fromCents(c)])),
    paid: fromCents(paidCents),
    due: fromCents(lines.reduce((n, l) => n + l.cents, 0))
  };
}
