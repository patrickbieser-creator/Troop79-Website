'use server';

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { sendEmail, troopEmail } from '@/lib/email';
import { recipientsForScouts } from '@/lib/email-recipients';
import { siteUrl } from '@/lib/site-url';
import { placeOrder, type PlaceOrderResult } from '@/lib/wreaths/place-order';
import { loadCurrentSale } from '@/lib/wreaths/public';
import { searchSellers, type SellerMatch } from '@/lib/wreaths/seller-search';

/**
 * The customer's "Place order" (Plans/Wreath-Sale.md, "The order action"). A thin shell: it supplies the live clock,
 * the caller's IP and the real mailer, and lib/wreaths/place-order.ts decides everything else — prices, area,
 * cutoffs, limits. It is reachable by anyone who can craft a POST, so nothing here trusts the form.
 */

/** The caller's IP from the platform's header. Vercel sets (and overwrites) these at the edge; there are none in local dev. */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : null);
  return first(h.get('x-vercel-forwarded-for')) ?? first(h.get('x-real-ip')) ?? first(h.get('x-forwarded-for'));
}

export async function placeOrderAction(raw: unknown): Promise<PlaceOrderResult> {
  const supabase = createAdminClient();
  return placeOrder(raw, {
    supabase,
    now: () => Date.now(),
    ip: await callerIp(),
    send: (m) => sendEmail({ ...m, confirm: true }),
    householdEmails: async (personId) => {
      const { data } = await supabase.from('scouts').select('id').eq('person_id', personId).limit(1);
      const scoutId = (data as { id: string }[] | null)?.[0]?.id;
      if (!scoutId) return [];
      return (await recipientsForScouts([scoutId])).map((r) => r.email);
    },
    siteUrl: siteUrl(),
    replyTo: troopEmail()
  });
}

/**
 * The checkout's "give a scout credit" type-ahead: a few letters in, at most eight "First L." matches out, from the
 * open sale's active sellers. The matching, the minimum of two letters and the per-IP limit all live in
 * lib/wreaths/seller-search.ts; the browser never receives the roster.
 */
export async function searchSellersAction(prefix: string): Promise<SellerMatch[]> {
  const supabase = createAdminClient();
  const sale = await loadCurrentSale(supabase);
  if (!sale) return [];
  return searchSellers(supabase, sale.id, typeof prefix === 'string' ? prefix : '', { ip: await callerIp() });
}
