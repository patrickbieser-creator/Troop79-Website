/**
 * Check: a scout has logged enough activities/campouts in the ledger to
 * satisfy Tenderfoot 1a (1 campout — see note below), Second Class 1a (5
 * activities, 3 campouts), or First Class 1a (10 activities, 6 campouts),
 * but doesn't have that specific requirement signed off yet.
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
 * Tenderfoot 1a's stored requirement text is actually "Pack for Overnight
 * Campout" (a gear-packing skill demo), not a literal campout-count
 * requirement like the other two. Confirmed with the user: 1 campout is used
 * as a proxy/nudge trigger for this check anyway, not a literal BSA rule.
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

const THRESHOLDS: { rankId: string; rankLabel: string; minActivities: number; minCampouts: number }[] = [
  { rankId: 'tenderfoot', rankLabel: 'Tenderfoot', minActivities: 0, minCampouts: 1 },
  { rankId: 'second-class', rankLabel: 'Second Class', minActivities: 5, minCampouts: 3 },
  { rankId: 'first-class', rankLabel: 'First Class', minActivities: 10, minCampouts: 6 }
];

interface LedgerEvent {
  scout_id: string;
  code: string;
  date: string;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * Walks a scout's distinct qualifying events in chronological order and
 * returns the date the LATER of the two thresholds (activities, campouts)
 * was first crossed — i.e. the date the requirement was actually completed,
 * not just the most recent event on file.
 */
function qualifyingDateFor(
  events: { code: string; date: string; isCampout: boolean }[],
  minActivities: number,
  minCampouts: number
): string {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let runningCampouts = 0;
  let runningActivities = 0;
  let campoutThresholdDate: string | null = null;
  let activityThresholdDate: string | null = minActivities <= 0 ? sorted[0]?.date ?? null : null;
  for (const e of sorted) {
    runningActivities++;
    if (e.isCampout) runningCampouts++;
    if (campoutThresholdDate === null && runningCampouts >= minCampouts) campoutThresholdDate = e.date;
    if (activityThresholdDate === null && minActivities > 0 && runningActivities >= minActivities) {
      activityThresholdDate = e.date;
    }
  }
  const dates = [campoutThresholdDate, activityThresholdDate].filter((d): d is string => d !== null);
  return dates.length ? dates.sort().at(-1)! : sorted.at(-1)?.date ?? '';
}

export async function run(supabase: ReturnType<typeof createAdminClient>): Promise<Finding[]> {
  const [campingRows, hikingRows, rankReqsRes, existing1aRows, scoutsRes] = await Promise.all([
    fetchAllRows<LedgerEvent>((from, to) =>
      supabase.from('ledger_active').select('scout_id, code, date').eq('kind', 'camping_nights').range(from, to)
    ),
    fetchAllRows<LedgerEvent>((from, to) =>
      supabase.from('ledger_active').select('scout_id, code, date').eq('kind', 'hiking_miles').range(from, to)
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

  // Dedup by (scout_id, code), keeping the earliest date on file for that code.
  type CodeDate = Map<string, string>; // code -> earliest date
  const campoutsByScout = new Map<string, CodeDate>();
  for (const row of campingRows) {
    const codes = campoutsByScout.get(row.scout_id) ?? new Map<string, string>();
    const prev = codes.get(row.code);
    if (!prev || row.date < prev) codes.set(row.code, row.date);
    campoutsByScout.set(row.scout_id, codes);
  }
  const hikesByScout = new Map<string, CodeDate>();
  for (const row of hikingRows) {
    const codes = hikesByScout.get(row.scout_id) ?? new Map<string, string>();
    const prev = codes.get(row.code);
    if (!prev || row.date < prev) codes.set(row.code, row.date);
    hikesByScout.set(row.scout_id, codes);
  }

  const scouts = (scoutsRes.data ?? []) as { id: string; display_name: string }[];
  const findings: Finding[] = [];
  for (const scout of scouts) {
    const campoutCodes = campoutsByScout.get(scout.id) ?? new Map<string, string>();
    const hikeCodes = hikesByScout.get(scout.id) ?? new Map<string, string>();
    const campouts = campoutCodes.size;
    const hikes = hikeCodes.size;
    const totalActivities = campouts + hikes;

    for (const t of THRESHOLDS) {
      if (totalActivities < t.minActivities || campouts < t.minCampouts) continue;
      const code = `${t.rankId}-1a`;
      if (existing1a.has(`${scout.id}|||${code}`)) continue;

      const events = [
        ...[...campoutCodes.entries()].map(([c, date]) => ({ code: c, date, isCampout: true })),
        ...[...hikeCodes.entries()].map(([c, date]) => ({ code: c, date, isCampout: false }))
      ];
      const qualifyingDate = qualifyingDateFor(events, t.minActivities, t.minCampouts);

      const campoutDates = [...campoutCodes.values()].sort();
      const hikeDates = [...hikeCodes.values()].sort();
      const detailLines = [
        `Campouts (${campoutDates.length}): ${campoutDates.map(fmtDate).join(', ')}`,
        ...(hikeDates.length ? [`Hikes (${hikeDates.length}): ${hikeDates.map(fmtDate).join(', ')}`] : [])
      ];

      findings.push({
        checkId: 'activity-thresholds',
        scoutId: scout.id,
        scoutName: scoutNameById.get(scout.id) ?? scout.id,
        groupLabel: t.rankLabel,
        contextLine: `${totalActivities} activit${totalActivities === 1 ? 'y' : 'ies'} logged (incl. ${campouts} campout${campouts === 1 ? '' : 's'})`,
        qualifyingDate,
        detailLines,
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
