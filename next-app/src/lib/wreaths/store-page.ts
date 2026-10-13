/**
 * Wreath sale — everything the store and checkout pages need, decided in one place so the page components stay pure
 * (no clock reads while rendering). Open / not-open / closed is a statement about the sale row and the clock; the
 * ORDER action re-decides it on every submit, so this is only what the visitor is shown.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CUTOFF_GRACE_MS, roundAt } from './rules';
import { loadCurrentSale, loadStoreItems, resolveScoutLink, type PublicSale, type ScoutLink, type StoreItem } from './public';

export interface OpenState {
  kind: 'open';
  sale: PublicSale;
  items: StoreItem[];
  /** The round a cart started now belongs to. */
  round: 1 | 2;
  /** When the current round ends (an instant). */
  cutoff: string;
  /** Whole days to that cutoff, counting today (0 = it ends today). */
  daysLeft: number;
  /** Set only in the two hours after the FINAL cutoff: a checkout begun before it may still finish. */
  graceCutoff: string | null;
}

export type StoreState = { kind: 'not_open' } | { kind: 'closed'; sale: PublicSale } | OpenState;
export type DecidedState = { kind: 'not_open' } | { kind: 'closed'; sale: PublicSale } | Omit<OpenState, 'items'>;

export interface StorePageData {
  state: StoreState;
  /** The scout whose link this is; null for the general store, an unknown slug and a retired one alike. */
  scout: ScoutLink | null;
  /** A slug was asked for but did not resolve — the page says so quietly. Identical for unknown and retired. */
  linkFellBack: boolean;
}

const DAY = 86_400_000;

export function decideStoreState(sale: PublicSale | null, nowMs: number): DecidedState {
  if (!sale || sale.status === 'draft') return { kind: 'not_open' };
  if (sale.status === 'closed') return { kind: 'closed', sale };
  const round = roundAt(sale, nowMs);
  const final = Date.parse(sale.round2Cutoff);
  if (round == null) {
    if (nowMs <= final + CUTOFF_GRACE_MS) {
      return { kind: 'open', sale, round: 2, cutoff: sale.round2Cutoff, daysLeft: 0, graceCutoff: sale.round2Cutoff };
    }
    return { kind: 'closed', sale };
  }
  const cutoff = round === 1 ? sale.round1Cutoff : sale.round2Cutoff;
  return { kind: 'open', sale, round, cutoff, daysLeft: Math.max(0, Math.ceil((Date.parse(cutoff) - nowMs) / DAY)), graceCutoff: null };
}

export async function loadStorePage(sb: SupabaseClient, slug: string | null, nowMs: number = Date.now()): Promise<StorePageData> {
  // The sale a visitor sees is the most recent one; only an OPEN sale takes orders.
  const sale = await loadCurrentSale(sb);
  const decided = decideStoreState(sale, nowMs);
  const scout = slug && sale ? await resolveScoutLink(sb, sale.id, slug) : null;
  const linkFellBack = !!slug && !scout;
  if (decided.kind !== 'open') return { state: decided, scout, linkFellBack };
  const items = await loadStoreItems(sb, decided.sale.id);
  return { state: { ...decided, items }, scout, linkFellBack };
}
