/**
 * /admin/advancement/has-needs — meeting-planning tool. A leader checks one
 * or more leaf requirements from the Scout/Tenderfoot/Second Class/First
 * Class trees and/or any merit badge's tree; the page splits active scouts
 * into Has/Needs/Partial lists. All computation happens client-side
 * (has-needs-tool.tsx + lib/has-needs) — this file only assembles the read
 * model.
 *
 * Requirement trees come from the shared advancement catalog
 * (lib/advancement-catalog, cached hourly / invalidated by Lookups saves)
 * rather than this page's own queries — the merit-badge expansion made
 * has-needs want exactly the payload fast-entry/Agenda/Dashboard already
 * cache. `merit_badges` IS the troop's offered list by construction (a
 * badge gets a row via populate-mb-requirements when the troop decides to
 * offer it; the full BSA catalog lives in scoutbook_merit_badge_reference).
 *
 * AWARD IMPLIES LEAVES: a scout can hold a full badge award with zero
 * logged leaf requirements (fast-entry's blue-card "clean slate bypass"),
 * so mb_progress.awarded seeds every leaf of that badge into heldKeys —
 * silently, per Patrick 2026-08-30, matching mb_progress semantics
 * elsewhere. Without it, a summer-camp blue card would show as "Needs"
 * every requirement of a badge already earned.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireCapability } from '@/lib/require-capability';
import { buildReqTree } from '@/lib/mb-helpers';
import { loadAdvancementCatalog, type CatalogMeritBadgeRequirement } from '@/lib/advancement-catalog';
import { withAwardedBadgeLeaves } from '@/lib/has-needs';
import { HasNeedsTool, type PickerRank, type PickerBadge, type ResultScout } from './has-needs-tool';
import { PageTitle } from '../../_components/page-title';

export const metadata = {
  title: 'Has/Needs Tool — Troop 79 Admin'
};

const TARGET_RANK_IDS = ['scout', 'tenderfoot', 'second-class', 'first-class'];

async function loadData() {
  const supabase = createAdminClient();
  const [catalog, scoutsRes, ledgerRows, awardedRows] = await Promise.all([
    loadAdvancementCatalog(),
    supabase.from('scouts').select('id, first_name, display_name, current_rank').eq('active', true),
    // Past ~5,600 rows this cap has silently truncated results before (see
    // paginate.ts) — always page through this query.
    fetchAllRows<{ scout_id: string; code: string; kind: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code, kind')
        .in('kind', ['rank_requirement', 'merit_badge_requirement'])
        .range(from, to)
    ),
    fetchAllRows<{ scout_id: string; mb_id: string }>((from, to) =>
      supabase.from('mb_progress').select('scout_id, mb_id').eq('awarded', true).range(from, to)
    )
  ]);

  const rankSortOrder = new Map(catalog.ranks.map((r) => [r.id, r.sort_order]));
  const rankDisplayName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));

  const rowsByRank = new Map<string, typeof catalog.rankRequirements>();
  for (const row of catalog.rankRequirements) {
    if (!TARGET_RANK_IDS.includes(row.rank_id)) continue;
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

  const rowsByMb = new Map<string, CatalogMeritBadgeRequirement[]>();
  for (const row of catalog.meritBadgeRequirements) {
    const list = rowsByMb.get(row.mb_id) ?? [];
    list.push(row);
    rowsByMb.set(row.mb_id, list);
  }
  // Only badges with a loaded requirement tree — a row without one has
  // nothing checkable (populate-mb-requirements creates both together, so
  // this is belt-and-suspenders, not a real filter).
  const pickerBadges: PickerBadge[] = catalog.meritBadges
    .filter((mb) => (rowsByMb.get(mb.id) ?? []).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((mb) => ({ id: mb.id, name: mb.name, eagle: mb.eagle, tree: buildReqTree(rowsByMb.get(mb.id)!) }));

  // Bare leaf codes per badge (a leaf = no row claims it as parent), for
  // the award-implies-leaves credit.
  const leafCodesByMb = new Map<string, string[]>();
  for (const [mbId, rows] of rowsByMb) {
    const parentIds = new Set(rows.map((r) => r.parent_id).filter((p): p is number => p != null));
    leafCodesByMb.set(
      mbId,
      rows.filter((r) => !parentIds.has(r.id)).map((r) => r.code)
    );
  }

  // Ledger codes are already `${id}-${code}` composites (eagle-1,
  // archery-1a), so prefixing by kind yields exactly rankKey/mbKey's shape.
  const keysByScout = new Map<string, Set<string>>();
  for (const row of ledgerRows) {
    const set = keysByScout.get(row.scout_id) ?? new Set<string>();
    set.add(`${row.kind === 'merit_badge_requirement' ? 'mb' : 'rank'}:${row.code}`);
    keysByScout.set(row.scout_id, set);
  }
  const awardedByScout = new Map<string, string[]>();
  for (const row of awardedRows) {
    const list = awardedByScout.get(row.scout_id) ?? [];
    list.push(row.mb_id);
    awardedByScout.set(row.scout_id, list);
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
    rankSortOrder: s.current_rank
      ? rankSortOrder.get(s.current_rank) ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER,
    heldKeys: Array.from(
      withAwardedBadgeLeaves(
        keysByScout.get(s.id) ?? [],
        awardedByScout.get(s.id) ?? [],
        leafCodesByMb
      )
    )
  }));

  return { pickerRanks, pickerBadges, scouts };
}

export default async function HasNeedsPage() {
  await requireCapability('advancement.write');
  const { pickerRanks, pickerBadges, scouts } = await loadData();
  return (
    <>
      <PageTitle back={null}
        title="Has/Needs Tool"
        sub="Check requirements from the four lower ranks or any merit badge to
          see who already has them and who still needs them — handy for lining
          up a meeting station, a campout class, or a signing-off session. A
          scout with a badge awarded counts as having all of its requirements."
      />
      <HasNeedsTool ranks={pickerRanks} badges={pickerBadges} scouts={scouts} />
    </>
  );
}
