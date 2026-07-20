/**
 * /admin/advancement/has-needs — meeting-planning tool. A leader checks one
 * or more leaf requirements from the Scout/Tenderfoot/Second Class/First
 * Class trees; the page splits active scouts into Has/Needs lists, combined
 * via an all/any toggle when multiple are checked. All computation happens
 * client-side (has-needs-tool.tsx) — this file only assembles the read model.
 *
 * Tree building follows the meeting-plan engine's established pattern
 * (buildReqTree from lib/mb-helpers, 'bor' synthetic rows excluded) rather
 * than reaching into fast-entry/'s picker helpers, which are scoped to that
 * feature.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireRole } from '@/lib/require-role';
import { buildReqTree } from '@/lib/mb-helpers';
import type { Rank } from '@/lib/supabase/types';
import { HasNeedsTool, type PickerRank, type ResultScout } from './has-needs-tool';
import styles from './has-needs.module.css';

export const metadata = {
  title: 'Has/Needs Tool — Troop 79 Admin'
};

const TARGET_RANK_IDS = ['scout', 'tenderfoot', 'second-class', 'first-class'];

interface RankReqRow {
  id: number;
  rank_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
}

async function loadData() {
  const supabase = createAdminClient();
  const [ranksRes, rankReqRows, scoutsRes, ledgerRows] = await Promise.all([
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    // Scoped to 4 ranks today, but paginate anyway — same cap that silently
    // truncated the ledger query below has bitten this codebase before
    // (see paginate.ts) and rank trees only grow over time.
    fetchAllRows<RankReqRow>((from, to) =>
      supabase
        .from('rank_requirements')
        .select('id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order')
        .in('rank_id', TARGET_RANK_IDS)
        .range(from, to)
    ),
    supabase
      .from('scouts')
      .select('id, first_name, display_name, current_rank')
      .eq('active', true),
    // Past ~5,600 rank_requirement rows this cap has silently truncated
    // results before (see paginate.ts) — always page through this query.
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'rank_requirement')
        .range(from, to)
    )
  ]);

  const ranks = (ranksRes.data ?? []) as Rank[];
  const rankSortOrder = new Map(ranks.map((r) => [r.id, r.sort_order]));
  const rankDisplayName = new Map(ranks.map((r) => [r.id, r.display_name]));

  const rowsByRank = new Map<string, RankReqRow[]>();
  for (const row of rankReqRows) {
    if (row.code.toLowerCase() === 'bor') continue;
    const list = rowsByRank.get(row.rank_id) ?? [];
    list.push(row);
    rowsByRank.set(row.rank_id, list);
  }

  const pickerRanks: PickerRank[] = TARGET_RANK_IDS.filter((id) => rowsByRank.has(id)).map(
    (rankId) => ({
      id: rankId,
      displayName: rankDisplayName.get(rankId) ?? rankId,
      tree: buildReqTree(rowsByRank.get(rankId)!)
    })
  );

  const codesByScout = new Map<string, Set<string>>();
  for (const row of ledgerRows) {
    const set = codesByScout.get(row.scout_id) ?? new Set<string>();
    set.add(row.code);
    codesByScout.set(row.scout_id, set);
  }

  const scouts: ResultScout[] = ((scoutsRes.data ?? []) as {
    id: string;
    first_name: string;
    display_name: string;
    current_rank: string | null;
  }[]).map((s) => ({
    id: s.id,
    firstName: s.first_name,
    displayName: s.display_name,
    currentRank: s.current_rank,
    rankSortOrder: s.current_rank ? rankSortOrder.get(s.current_rank) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
    heldCodes: Array.from(codesByScout.get(s.id) ?? [])
  }));

  return { pickerRanks, scouts };
}

export default async function HasNeedsPage() {
  await requireRole(['leader', 'scout']);
  const { pickerRanks, scouts } = await loadData();
  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Has/Needs Tool</h1>
        <p>
          Check one or more Scout, Tenderfoot, Second Class, or First Class
          requirements to see who already has them and who still needs them —
          handy for lining up a meeting station or a signing-off session.
        </p>
      </div>
      <HasNeedsTool ranks={pickerRanks} scouts={scouts} />
    </>
  );
}
