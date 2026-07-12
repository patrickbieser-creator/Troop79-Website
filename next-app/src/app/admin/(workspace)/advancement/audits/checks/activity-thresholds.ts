/**
 * Check: a scout has logged enough activities/campouts in the ledger to
 * satisfy Second Class 1a (5 activities, 3 campouts) or First Class 1a (10
 * activities, 6 campouts), but doesn't have that specific requirement signed
 * off yet.
 *
 * Counting rule (confirmed with the user):
 *   - Counts toward "N activities": `camping_nights` and `hiking_miles`
 *     ledger rows only — genuine outings entered through Fast Entry's
 *     Events tab.
 *   - Does NOT count: `day_outing`/`fundraiser` rows (no nights/miles logged)
 *     or `service_hours` (tracked separately elsewhere, e.g. Second Class 8e).
 *   - Counts toward "N campouts" specifically: `camping_nights` rows only.
 *   - Counted as distinct events (scout_id + code), not raw rows, so an
 *     accidental duplicate entry doesn't inflate the tally.
 *
 * Deliberately does NOT gate on the scout's current rank — it fires purely
 * from the ledger threshold vs. whether `1a` is signed off. This is a
 * proactive companion to the BoR check (reactive — only catches a gap once
 * the whole rank is already complete). A scout can reasonably appear in both
 * checks for the same gap; that's two independent confirmations of the same
 * real problem, not a bug.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { Finding } from '../types';

const THRESHOLDS: { rankId: string; minActivities: number; minCampouts: number }[] = [
  { rankId: 'second-class', minActivities: 5, minCampouts: 3 },
  { rankId: 'first-class', minActivities: 10, minCampouts: 6 }
];

export async function run(supabase: ReturnType<typeof createAdminClient>): Promise<Finding[]> {
  const [campingRows, hikingRows, rankReqsRes, existing1aRows, scoutsRes] = await Promise.all([
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase.from('ledger_active').select('scout_id, code').eq('kind', 'camping_nights').range(from, to)
    ),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase.from('ledger_active').select('scout_id, code').eq('kind', 'hiking_miles').range(from, to)
    ),
    supabase
      .from('rank_requirements')
      .select('rank_id, label')
      .in('rank_id', THRESHOLDS.map((t) => t.rankId))
      .eq('code', '1a'),
    supabase
      .from('ledger_active')
      .select('scout_id, code')
      .eq('kind', 'rank_requirement')
      .in('code', THRESHOLDS.map((t) => `${t.rankId}-1a`)),
    supabase.from('scouts').select('id, display_name').eq('active', true)
  ]);

  const labelByRank = new Map<string, string>();
  for (const r of (rankReqsRes.data ?? []) as { rank_id: string; label: string }[]) {
    labelByRank.set(r.rank_id, r.label);
  }
  const scoutNameById = new Map<string, string>();
  for (const s of (scoutsRes.data ?? []) as { id: string; display_name: string }[]) {
    scoutNameById.set(s.id, s.display_name);
  }
  const existing1a = new Set<string>();
  for (const row of (existing1aRows.data ?? []) as { scout_id: string; code: string }[]) {
    existing1a.add(`${row.scout_id}|||${row.code}`);
  }

  const campoutsByScout = new Map<string, Set<string>>();
  for (const row of campingRows) {
    const set = campoutsByScout.get(row.scout_id) ?? new Set<string>();
    set.add(row.code);
    campoutsByScout.set(row.scout_id, set);
  }
  const hikesByScout = new Map<string, Set<string>>();
  for (const row of hikingRows) {
    const set = hikesByScout.get(row.scout_id) ?? new Set<string>();
    set.add(row.code);
    hikesByScout.set(row.scout_id, set);
  }

  const scouts = (scoutsRes.data ?? []) as { id: string; display_name: string }[];
  const findings: Finding[] = [];
  for (const scout of scouts) {
    const campouts = campoutsByScout.get(scout.id)?.size ?? 0;
    const hikes = hikesByScout.get(scout.id)?.size ?? 0;
    const totalActivities = campouts + hikes;

    for (const t of THRESHOLDS) {
      if (totalActivities < t.minActivities || campouts < t.minCampouts) continue;
      const code = `${t.rankId}-1a`;
      if (existing1a.has(`${scout.id}|||${code}`)) continue;

      findings.push({
        checkId: 'activity-thresholds',
        scoutId: scout.id,
        scoutName: scoutNameById.get(scout.id) ?? scout.id,
        groupLabel: t.rankId === 'second-class' ? 'Second Class' : 'First Class',
        contextLine: `${totalActivities} activit${totalActivities === 1 ? 'y' : 'ies'} logged (incl. ${campouts} campout${campouts === 1 ? '' : 's'})`,
        missing: [
          {
            code,
            shortCode: '1a',
            label: labelByRank.get(t.rankId) ?? '1a',
            parentCode: null,
            parentLabel: null
          }
        ]
      });
    }
  }

  findings.sort((a, b) => a.scoutName.localeCompare(b.scoutName) || a.groupLabel.localeCompare(b.groupLabel));
  return findings;
}
