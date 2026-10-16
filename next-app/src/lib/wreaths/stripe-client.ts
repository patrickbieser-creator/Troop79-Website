import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';
import { centralToday } from '@/lib/dates';
import { expireOpenCheckout, type CardDeps, type StripeLike } from './card-payments';

/**
 * The one place the Stripe secrets are read (Plans/Wreath-Stripe-Checkout.md). Server code only: never import this
 * from a 'use client' module (tests/wreath-stripe-boundary.test.ts guards it), and never log a raw event body.
 * The SDK pins its own API version (stripe 22.0.1 → 2026-03-25.dahlia), the same as OMG-Website.
 */

/** Card payment is on only when BOTH secrets are configured — with no keys the site behaves exactly as Release A. */
export function cardCheckoutLive(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

let client: Stripe | null = null;
let clientKey = '';

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!client || clientKey !== key) {
    client = new Stripe(key);
    clientKey = key;
  }
  return client;
}

export function cardDeps(): CardDeps {
  return {
    supabase: createAdminClient(),
    stripe: stripeClient() as unknown as StripeLike,
    live: cardCheckoutLive(),
    siteUrl: siteUrl(),
    today: centralToday
  };
}

/** Expires the order's open Checkout Session before (admin) or after (a scout's authorized edit) anything changes
 *  what the order owes or whether it is payable. No-op when card payment is off or the order has no session. */
export async function expireOrderCheckout(orderId: number): Promise<void> {
  if (!cardCheckoutLive()) return;
  await expireOpenCheckout(orderId, cardDeps());
}
