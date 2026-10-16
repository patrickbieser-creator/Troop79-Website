import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditAs } from '@/lib/audit';
import { fmtDay } from '@/lib/format-date';
import { loadCurrentSale } from './public';

/**
 * A customer cancels their own order from the receipt page (Patrick, 2026-10-16: someone who walked away from Stripe
 * had no way to undo the order, so it sat in admin and on the scout's page as a real one). The receipt link's token is
 * the only credential, as it is for paying. Only an unpaid online order, before its round's cutoff: a paid order needs
 * a refund (a leader's job), a scout-entered order is the scout's, and after the cutoff the troop has ordered from the
 * grower. Any open card session is closed FIRST (and a payment that may be going through stops the cancel), while the order is still placed, so nothing can be paid on an order
 * about to be cancelled; a payment that slipped in anyway is flagged for a refund by the webhook, as for an admin cancel.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASK = 'Write bsatroop79bg@gmail.com to change it.';

export interface CancelOrderState {
  status: 'placed' | 'cancelled';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  /** A card payment on this order is waiting to be returned. */
  needsRefund: boolean;
  source: 'scout_link' | 'store' | 'paper';
  round: 1 | 2;
}

export interface CancelSale {
  status: 'draft' | 'open' | 'closed';
  round1Cutoff: string;
  round2Cutoff: string;
}

/** Why the customer can't cancel this order themselves, or null when they can. Shared by the receipt page and the action. */
export function customerCancelBlock(o: CancelOrderState, sale: CancelSale | null, nowMs: number = Date.now()): string | null {
  if (o.status === 'cancelled') return 'This order is cancelled.';
  if (o.paymentStatus !== 'unpaid' || o.needsRefund) return `This order is paid, so it can’t be cancelled here. ${ASK}`;
  if (o.source === 'paper') return 'Your scout entered this order. Ask them to change it.';
  if (!sale || sale.status !== 'open') return `The sale is closed. ${ASK}`;
  const cutoff = o.round === 1 ? sale.round1Cutoff : sale.round2Cutoff;
  if (nowMs > Date.parse(cutoff)) return `Round ${o.round} closed ${fmtDay(cutoff)}, so the troop has ordered your wreaths. ${ASK}`;
  return null;
}

export interface CancelDeps {
  supabase: SupabaseClient;
  now: () => number;
  /** Closes the order's open Stripe Checkout Session, if any; 'paying' when a card payment may be going through. */
  closeCheckout: (orderId: number) => Promise<'clear' | 'paying'>;
}

export type CancelResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND: CancelResult = { ok: false, error: 'We couldn’t find that order.' };

export async function cancelOrderByToken(token: unknown, deps: CancelDeps): Promise<CancelResult> {
  if (typeof token !== 'string' || !UUID_RE.test(token)) return NOT_FOUND;
  const sb = deps.supabase;
  const { data } = await sb.from('wreath_orders').select('id, order_number, status, payment_status, needs_refund, source, round, sale_id').eq('public_token', token).maybeSingle();
  if (!data) return NOT_FOUND;
  const o = data as { id: number; order_number: string; status: CancelOrderState['status']; payment_status: CancelOrderState['paymentStatus']; needs_refund: string | null; source: CancelOrderState['source']; round: 1 | 2; sale_id: number };
  // Cancelling twice is the same as once: a double tap, or a second tab.
  if (o.status === 'cancelled') return { ok: true };
  const sale = await loadCurrentSale(sb, o.sale_id);
  const block = customerCancelBlock({ status: o.status, paymentStatus: o.payment_status, needsRefund: o.needs_refund != null, source: o.source, round: o.round }, sale, deps.now());
  if (block) return { ok: false, error: block };

  if ((await deps.closeCheckout(o.id)) === 'paying') {
    return { ok: false, error: 'A card payment is going through on this order. Reload the page in a minute to see it.' };
  }
  const { data: row, error } = await sb
    .from('wreath_orders')
    .update({ status: 'cancelled', cancelled_at: new Date(deps.now()).toISOString() })
    .eq('id', o.id)
    .eq('status', 'placed')
    .eq('payment_status', 'unpaid')
    .is('needs_refund', null)
    .neq('source', 'paper')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { ok: false, error: 'This order just changed. Reload the page.' };
  await recordAuditAs(sb, { personId: null, label: 'Customer' }, {
    area: 'wreaths',
    action: 'cancel',
    entityType: 'wreath_order',
    entityId: o.id,
    summary: `Customer cancelled order ${o.order_number} from the receipt page`,
    details: [{ field: 'Status', from: 'Placed', to: 'Cancelled' }]
  });
  return { ok: true };
}
