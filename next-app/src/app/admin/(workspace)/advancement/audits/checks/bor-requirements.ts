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

import { buildReqTree, isGroupSatisfied, type ReqNode } from '@/lib/mb-helpers';
import { fmtDate } from '@/lib/format-date';
import type { RankReqCatalogRow } from '@/lib/scout-detail';
import type { Finding, MissingLeaf } from '../types';
import { activeScouts, ledgerOfKind, type AuditInput } from '../audit-input';

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

export async function run(input: AuditInput): Promise<Finding[]> {
  const { supabase, rankRequirements, ledger } = input;
  const ranksRes = await supabase.from('ranks').select('id, display_name').order('sort_order');
  const rankAwards = ledgerOfKind(ledger, ['rank_award']);
  const rankReqLedgerRows = ledgerOfKind(ledger, ['rank_requirement']);
  const scouts = activeScouts(input.scouts);

  const rankLabelById = new Map<string, string>();
  for (const r of (ranksRes.data ?? []) as { id: string; display_name: string }[]) {
    rankLabelById.set(r.id, r.display_name);
  }
  const scoutNameById = new Map<string, string>();
  for (const s of scouts) {
    scoutNameById.set(s.id, s.display_name);
  }

  // Group the requirement catalog by rank, excluding the synthetic BoR row
  // (that's a display artifact for the award itself, not a real requirement).
  const rowsByRank = new Map<string, RankReqCatalogRow[]>();
  for (const r of rankRequirements) {
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
  for (const award of rankAwards) {
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
      contextLine: `BoR on record ${fmtDate(award.date)}${award.by ? ` · ${award.by}` : ''}`,
      missing
    });
  }

  findings.sort((a, b) => a.scoutName.localeCompare(b.scoutName) || a.groupLabel.localeCompare(b.groupLabel));
  return findings;
}
