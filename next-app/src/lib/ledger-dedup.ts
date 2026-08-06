/**
 * Ledger duplicate-detection — shared by Fast Entry (D-041) and Resource
 * Library Phase 2 proof approval (Plans/Resource-Library.md). Extracted from
 * fast-entry/actions.ts so proof approval writes through the SAME dup-block
 * rule instead of a parallel one that could drift from it (tech-lead
 * 2026-08-06 build-order review).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LedgerKind } from '@/lib/supabase/types';

/** One-time/binary kinds — a scout either has this or doesn't, so a repeat
 *  is always a mistake (unlike service_hours, camping_nights, etc., which
 *  are legitimately logged more than once). Only these are deduped. */
export const DEDUP_KINDS: ReadonlySet<LedgerKind> = new Set<LedgerKind>([
  'rank_requirement',
  'rank_award',
  'merit_badge_requirement',
  'merit_badge_award'
]);

export interface DedupCandidate {
  scout_id: string;
  kind: LedgerKind;
  code: string;
}

/** Set of "scout_id kind code" strings already on the active ledger, among
 *  the DEDUP_KINDS present in `items`. */
export async function queryExistingSet(
  supabase: SupabaseClient,
  items: DedupCandidate[]
): Promise<Set<string>> {
  const candidates = items.filter((it) => DEDUP_KINDS.has(it.kind));
  if (candidates.length === 0) return new Set();

  const scoutIds = Array.from(new Set(candidates.map((it) => it.scout_id)));
  const codes = Array.from(new Set(candidates.map((it) => it.code)));
  const { data } = await supabase
    .from('ledger_active')
    .select('scout_id, kind, code')
    .in('scout_id', scoutIds)
    .in('code', codes)
    .in('kind', Array.from(DEDUP_KINDS));

  return new Set(
    ((data ?? []) as { scout_id: string; kind: string; code: string }[]).map(
      (r) => `${r.scout_id} ${r.kind} ${r.code}`
    )
  );
}

/**
 * Drops any item that's a no-op — the scout already has that exact
 * (kind, code) on the active ledger. Preserves the item's own shape (T) so
 * both Fast Entry's richer EntryToInsert and any leaner caller can reuse it.
 */
export async function filterOutExisting<T extends DedupCandidate>(
  supabase: SupabaseClient,
  items: T[]
): Promise<{ items: T[]; skipped: T[] }> {
  const existing = await queryExistingSet(supabase, items);
  const keep: T[] = [];
  const skipped: T[] = [];
  for (const it of items) {
    const key = `${it.scout_id} ${it.kind} ${it.code}`;
    if (DEDUP_KINDS.has(it.kind) && existing.has(key)) {
      skipped.push(it);
    } else {
      keep.push(it);
    }
  }
  return { items: keep, skipped };
}

/** True if this exact (scout, kind, code) is already on the active ledger.
 *  Single-row convenience wrapper for callers (proof approval) that only
 *  ever check one candidate at a time. */
export async function isDuplicateLedgerEntry(
  supabase: SupabaseClient,
  scoutId: string,
  kind: LedgerKind,
  code: string
): Promise<boolean> {
  const existing = await queryExistingSet(supabase, [{ scout_id: scoutId, kind, code }]);
  return existing.has(`${scoutId} ${kind} ${code}`);
}
