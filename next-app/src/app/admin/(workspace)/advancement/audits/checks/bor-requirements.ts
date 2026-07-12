/**
 * Check: Board of Review is on record for a rank, but one or more of that
 * rank's own requirements have no ledger entry — invisible on the Clipboard
 * until someone happens to notice.
 *
 * `scouts.current_rank` is trigger-maintained purely from `rank_award` rows
 * (see `recompute_scout_current_rank` / `ledger_rank_award_refresh` in
 * 20260528000100_demographics_parents_counselors.sql) and every troop-wide
 * stat elsewhere (Dashboard, MB Progress, roster, Clipboard) is a live view
 * over the ledger — so filling in a gap here needs no separate "reconcile
 * rank progression" step. The BoR already made current_rank correct; this
 * only backfills the historical completeness record.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { buildReqTree, isGroupSatisfied, type ReqNode } from '@/lib/mb-helpers';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { RankReqCatalogRow } from '@/lib/scout-detail';
import type { Finding, MissingLeaf } from '../types';

function isSatisfied(
  node: ReqNode<RankReqCatalogRow>,
  rankId: string,
  ledgerCodes: Set<string>
): boolean {
  if (node.children.length === 0) return ledgerCodes.has(`${rankId}-${node.code}`);
  const satisfiedCount = node.children.filter((c) => isSatisfied(c, rankId, ledgerCodes)).length;
  return isGroupSatisfied(node.complete_rule, node.complete_n, satisfiedCount, node.children.length);
}

function collectMissingLeaves(
  node: ReqNode<RankReqCatalogRow>,
  rankId: string,
  ledgerCodes: Set<string>,
  parent: { code: string; label: string } | null,
  out: MissingLeaf[]
) {
  if (node.children.length === 0) {
    if (!ledgerCodes.has(`${rankId}-${node.code}`)) {
      out.push({
        code: `${rankId}-${node.code}`,
        shortCode: node.code,
        label: node.label,
        parentCode: parent?.code ?? null,
        parentLabel: parent?.label ?? null
      });
    }
    return;
  }
  for (const child of node.children) {
    if (!isSatisfied(child, rankId, ledgerCodes)) {
      collectMissingLeaves(child, rankId, ledgerCodes, { code: node.code, label: node.label }, out);
    }
  }
}

function shortDate(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

export async function run(supabase: ReturnType<typeof createAdminClient>): Promise<Finding[]> {
  const [ranksRes, rankReqsRes, rankAwardsRes, rankReqLedgerRows, scoutsRes] = await Promise.all([
    supabase.from('ranks').select('id, display_name').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order'),
    supabase.from('ledger_active').select('scout_id, code, date, by').eq('kind', 'rank_award'),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'rank_requirement')
        .range(from, to)
    ),
    supabase.from('scouts').select('id, display_name').eq('active', true)
  ]);

  const rankLabelById = new Map<string, string>();
  for (const r of (ranksRes.data ?? []) as { id: string; display_name: string }[]) {
    rankLabelById.set(r.id, r.display_name);
  }
  const scoutNameById = new Map<string, string>();
  for (const s of (scoutsRes.data ?? []) as { id: string; display_name: string }[]) {
    scoutNameById.set(s.id, s.display_name);
  }

  // Group the requirement catalog by rank, excluding the synthetic BoR row
  // (that's a display artifact for the award itself, not a real requirement).
  const rowsByRank = new Map<string, RankReqCatalogRow[]>();
  for (const r of (rankReqsRes.data ?? []) as RankReqCatalogRow[]) {
    if (r.code.toLowerCase() === 'bor') continue;
    const list = rowsByRank.get(r.rank_id) ?? [];
    list.push(r);
    rowsByRank.set(r.rank_id, list);
  }
  const treeByRank = new Map<string, ReqNode<RankReqCatalogRow>[]>();
  for (const [rankId, rows] of rowsByRank) treeByRank.set(rankId, buildReqTree(rows));

  const ledgerByScout = new Map<string, Set<string>>();
  for (const row of rankReqLedgerRows) {
    const set = ledgerByScout.get(row.scout_id) ?? new Set<string>();
    set.add(row.code);
    ledgerByScout.set(row.scout_id, set);
  }

  // Dedupe (scout, rank) in case of a duplicate rank_award entry.
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const award of (rankAwardsRes.data ?? []) as { scout_id: string; code: string; date: string | null; by: string | null }[]) {
    if (award.code === 'scout') continue; // Scout rank has no BoR
    if (!scoutNameById.has(award.scout_id)) continue; // inactive or unknown scout
    const key = `${award.scout_id}|||${award.code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tree = treeByRank.get(award.code);
    if (!tree || tree.length === 0) continue;
    const ledgerCodes = ledgerByScout.get(award.scout_id) ?? new Set<string>();

    const missing: MissingLeaf[] = [];
    for (const top of tree) {
      if (!isSatisfied(top, award.code, ledgerCodes)) {
        collectMissingLeaves(top, award.code, ledgerCodes, null, missing);
      }
    }
    if (missing.length === 0) continue;

    findings.push({
      checkId: 'bor-requirements',
      scoutId: award.scout_id,
      scoutName: scoutNameById.get(award.scout_id) ?? award.scout_id,
      groupLabel: rankLabelById.get(award.code) ?? award.code,
      contextLine: `BoR on record ${shortDate(award.date)}${award.by ? ` · ${award.by}` : ''}`,
      missing
    });
  }

  findings.sort((a, b) => a.scoutName.localeCompare(b.scoutName) || a.groupLabel.localeCompare(b.groupLabel));
  return findings;
}
