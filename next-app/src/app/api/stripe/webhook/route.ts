import { NextResponse } from 'next/server';
import { cardDeps, stripeClient, stripeSecretKey, stripeWebhookSecret } from '@/lib/wreaths/stripe-client';
import type { StripeEventLike } from '@/lib/wreaths/card-payments';
import { handleAnyStripeEvent } from '@/lib/event-pay/card';

/**
 * Stripe webhook for card payments: the wreath sale (Plans/Wreath-Stripe-Checkout.md, 2026-10-15) and event
 * sign-up fees (lib/event-pay/card, 2026-11-13). Same endpoint, same six events.
 *
 * Every request must carry a valid Stripe signature over the RAW body; with no webhook secret configured the route
 * refuses everything (503) rather than trusting unsigned events. A handler error answers 500 so Stripe retries —
 * each event's effect and its dedupe row land in one SQL function call, so a retry is safe.
 *
 * Stripe Dashboard → Developers → Webhooks → endpoint https://www.troop-79.com/api/stripe/webhook, events:
 *   checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
 *   checkout.session.expired, charge.refunded, charge.updated
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = stripeWebhookSecret();
  if (!secret || !stripeSecretKey()) {
    return NextResponse.json({ error: 'Card payments are not configured.' }, { status: 503 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });

  const body = await request.text();
  let event: StripeEventLike;
  try {
    event = stripeClient().webhooks.constructEvent(body, signature, secret) as unknown as StripeEventLike;
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    const outcome = await handleAnyStripeEvent(event, cardDeps());
    console.info(`[stripe] ${event.type} ${event.id}: ${outcome}`);
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error(`[stripe] ${event.type} ${event.id} failed:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }
}
