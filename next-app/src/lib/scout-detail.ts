/**
 * Loads everything the per-scout Clipboard page (/scouts/[id]) needs in a
 * single parallelized fetch. Buckets ledger rows by kind so the page can
 * render each panel without re-scanning the array.
 */

import { createClient } from '@/lib/supabase/server';
import type {
  LedgerEntry,
  MeritBadge,
  Rank,
  Scout,
  ScoutSummaryRow
} from '@/lib/supabase/types';

export interface RankReqCatalogRow {
  rank_id: string;
  code: string;
  label: string;
  sort_order: number;
}

export interface ScoutDetail {
  scout: Scout;
  summary: ScoutSummaryRow | null;
  ranks: Rank[];
  rankReqs: RankReqCatalogRow[];
  ledger: {
    rankRequirements: LedgerEntry[];
    rankAwards: LedgerEntry[];
    meritBadgeAwards: LedgerEntry[];
    meritBadgeRequirements: LedgerEntry[];
    attendance: LedgerEntry[];
    serviceHours: LedgerEntry[];
    campingNights: LedgerEntry[];
    hikingMiles: LedgerEntry[];
    leadership: LedgerEntry[];
    awards: LedgerEntry[];
  };
  /** mb_id → { name, eagle } lookup */
  mbCatalog: Map<string, { name: string; eagle: boolean }>;
}

export async function loadScoutDetail(scoutId: string): Promise<ScoutDetail | null> {
  const supabase = await createClient();
  const [scoutRes, summaryRes, ranksRes, rankReqsRes, ledgerRes, mbRes] = await Promise.all([
    supabase.from('scouts').select('*').eq('id', scoutId).maybeSingle(),
    supabase.from('scout_summary').select('*').eq('scout_id', scoutId).maybeSingle(),
    supabase.from('ranks').select('*').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label, sort_order')
      .is('parent_id', null)
      .order('rank_id')
      .order('sort_order'),
    supabase
      .from('ledger_active')
      .select('*')
      .eq('scout_id', scoutId)
      .order('date'),
    supabase.from('merit_badges').select('id, name, eagle')
  ]);

  if (scoutRes.error || !scoutRes.data) return null;

  const ledger = {
    rankRequirements: [] as LedgerEntry[],
    rankAwards: [] as LedgerEntry[],
    meritBadgeAwards: [] as LedgerEntry[],
    meritBadgeRequirements: [] as LedgerEntry[],
    attendance: [] as LedgerEntry[],
    serviceHours: [] as LedgerEntry[],
    campingNights: [] as LedgerEntry[],
    hikingMiles: [] as LedgerEntry[],
    leadership: [] as LedgerEntry[],
    awards: [] as LedgerEntry[]
  };
  for (const e of (ledgerRes.data ?? []) as LedgerEntry[]) {
    switch (e.kind) {
      case 'rank_requirement':
        ledger.rankRequirements.push(e);
        break;
      case 'rank_award':
        ledger.rankAwards.push(e);
        break;
      case 'merit_badge_award':
        ledger.meritBadgeAwards.push(e);
        break;
      case 'merit_badge_requirement':
        ledger.meritBadgeRequirements.push(e);
        break;
      case 'attendance':
        ledger.attendance.push(e);
        break;
      case 'service_hours':
        ledger.serviceHours.push(e);
        break;
      case 'camping_nights':
        ledger.campingNights.push(e);
        break;
      case 'hiking_miles':
        ledger.hikingMiles.push(e);
        break;
      case 'leadership':
        ledger.leadership.push(e);
        break;
      case 'award':
        ledger.awards.push(e);
        break;
    }
  }

  const mbCatalog = new Map<string, { name: string; eagle: boolean }>();
  for (const mb of (mbRes.data ?? []) as Pick<MeritBadge, 'id' | 'name' | 'eagle'>[]) {
    mbCatalog.set(mb.id, { name: mb.name, eagle: mb.eagle });
  }

  return {
    scout: scoutRes.data as Scout,
    summary: (summaryRes.data ?? null) as ScoutSummaryRow | null,
    ranks: (ranksRes.data ?? []) as Rank[],
    rankReqs: (rankReqsRes.data ?? []) as RankReqCatalogRow[],
    ledger,
    mbCatalog
  };
}

/** Pull the mb_id from a merit-badge award/requirement code.
 *  Awards use `MB:<id>`; requirements use `<id>-<reqcode>`. */
export function mbIdFromAwardCode(code: string): string | null {
  const colon = code.indexOf(':');
  if (colon < 0) return null;
  return code.slice(colon + 1);
}
export function mbIdFromReqCode(code: string): string | null {
  const dash = code.indexOf('-');
  if (dash < 0) return null;
  return code.slice(0, dash);
}

/** Pull the rank id from a rank-requirement code like "tenderfoot-1a"
 *  or "SC-3a" (the prototype's abbreviated form). */
export function rankIdFromCode(code: string): string | null {
  if (code.startsWith('SC-') || code.startsWith('second-class-')) return 'second-class';
  if (code.startsWith('FC-') || code.startsWith('first-class-')) return 'first-class';
  if (code.startsWith('tenderfoot-')) return 'tenderfoot';
  if (code.startsWith('scout-')) return 'scout';
  if (code.startsWith('star-')) return 'star';
  if (code.startsWith('life-')) return 'life';
  if (code.startsWith('eagle-')) return 'eagle';
  return null;
}

/** Strip the rank prefix from a rank-requirement code for display
 *  (e.g. "SC-3a" → "3a", "second-class-3a" → "3a"). */
export function rankReqShortCode(code: string): string {
  const m =
    code.match(/^(?:SC|FC|tenderfoot|scout|second-class|first-class|star|life|eagle)-(.+)$/);
  return m ? m[1] : code;
}
