/**
 * Shared inputs for the Audits page's check modules (perf review 2026-08-27,
 * item 10).
 *
 * Every check used to independently re-read `scouts`, `rank_requirements`
 * and paginate the whole of `ledger_active` — 7 checks summed to ~30-40
 * round trips per page load. Loading those three tables ONCE here and
 * handing every check the same snapshot keeps the same findings (each check
 * still derives its own view — filter by kind, by code, by active — exactly
 * as it did before) with a fraction of the trips; only `ledger_active`'s
 * page count still grows with the ledger, and it now grows once instead of
 * once per check.
 *
 * A check's OWN tables (`ranks` for bor-requirements, `merit_badges` for
 * rank-merit-badges, `event_attendance`/`calendar_entries`/
 * `calendar_categories`/`people` for attendance-reconciliation) are not
 * shared by ≥2 checks, so they stay as each check's own read via
 * `input.supabase`.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { RankReqCatalogRow } from '@/lib/scout-detail';
import type { LedgerKind } from '@/lib/supabase/types';

export interface AuditLedgerRow {
  id: number;
  scout_id: string;
  kind: LedgerKind;
  code: string;
  label: string | null;
  date: string;
  by: string | null;
  qty: number;
  unit: string;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
  calendar_entry_id: number | null;
}

export interface AuditScoutRow {
  id: string;
  display_name: string;
  active: boolean;
  person_id: number | null;
}

export interface AuditInput {
  supabase: ReturnType<typeof createAdminClient>;
  scouts: AuditScoutRow[];
  rankRequirements: RankReqCatalogRow[];
  ledger: AuditLedgerRow[];
}

/** Scouts with `active = true` — the filter every rank-progress check
 *  applies; duplicate-records and attendance-reconciliation want every
 *  scout instead and read `input.scouts` directly. */
export function activeScouts(scouts: AuditScoutRow[]): AuditScoutRow[] {
  return scouts.filter((s) => s.active);
}

/** Ledger rows of one or more kinds — the in-memory equivalent of the
 *  `.eq('kind', …)` / `.in('kind', […])` filter each check used to run as
 *  its own query against `ledger_active`. */
export function ledgerOfKind(
  ledger: AuditLedgerRow[],
  kinds: readonly LedgerKind[]
): AuditLedgerRow[] {
  const set = new Set<LedgerKind>(kinds);
  return ledger.filter((row) => set.has(row.kind));
}

export async function loadAuditInput(
  supabase: ReturnType<typeof createAdminClient>
): Promise<AuditInput> {
  const [scoutsRes, rankReqsRes, ledger] = await Promise.all([
    supabase.from('scouts').select('id, display_name, active, person_id'),
    supabase
      .from('rank_requirements')
      .select('id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order'),
    fetchAllRows<AuditLedgerRow>((from, to) =>
      supabase
        .from('ledger_active')
        .select(
          'id, scout_id, kind, code, label, date, by, qty, unit, notes, entered_by, entered_at, calendar_entry_id'
        )
        .range(from, to)
    )
  ]);

  return {
    supabase,
    scouts: (scoutsRes.data ?? []) as AuditScoutRow[],
    rankRequirements: (rankReqsRes.data ?? []) as RankReqCatalogRow[],
    ledger
  };
}
