/**
 * Check: a scout has logged enough activities/campouts in the ledger to
 * satisfy Tenderfoot 1a (1 campout — see note below), Second Class 1a (5
 * activities, 3 campouts), or First Class 1a (10 activities, 6 campouts),
 * but doesn't have that specific requirement signed off yet.
 *
 * Counting rule (CORRECTED 2026-08-14 — Patrick):
 *   - "Activity" is an UMBRELLA over campouts, fundraisers, day outings and
 *     service projects. Everything except meetings counts toward "N
 *     activities", and an event counts toward its umbrella AND its quantity at
 *     the same time: a service project is service hours *and* an activity; a
 *     campout is nights *and* an activity.
 *   - Counts toward "N campouts" specifically: `camping_nights` rows only.
 *   - Meetings never count — BSA excludes troop and patrol meetings from 1a by
 *     name — so `meeting_attendance` is absent from ACTIVITY_KINDS.
 *   - Counted as distinct events (scout_id + code), keyed by CODE rather than
 *     by kind+code, so an accidental duplicate entry can't inflate the tally.
 *     That guard does real work: the duplicate-records audit found ~436
 *     duplicate groups on production.
 *
 *     Note a camping-plus-service weekend is NOT the case being defended
 *     against — Patrick, 2026-08-14: those would be entered as two separate
 *     events with two codes and SHOULD count as two. Keying by code is simply
 *     the honest unit of "one event", whatever kinds it logged.
 *
 * This REPLACES a narrower rule that had also been "confirmed with the user":
 * activities were `camping_nights` + `hiking_miles` only, with day outings,
 * fundraisers and service projects excluded. That under-counted every scout who
 * had attended one — their fundraisers and service days were invisible to 1a.
 * Expect this check to surface MORE scouts than it did before; that is the fix
 * working, not a regression.
 *
 * Longer term the count moves off the ledger entirely and onto attendance
 * rows, where "five SEPARATE activities" is structural rather than a dedup
 * heuristic (Plans/Roll-Call.md). Until Roll Call exists, this is the honest
 * approximation the ledger can support.
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
import { fmtDate } from '@/lib/format-date';
import type { Finding } from '../types';

const THRESHOLDS: { rankId: string; rankLabel: string; minActivities: number; minCampouts: number }[] = [
  { rankId: 'tenderfoot', rankLabel: 'Tenderfoot', minActivities: 0, minCampouts: 1 },
  { rankId: 'second-class', rankLabel: 'Second Class', minActivities: 5, minCampouts: 3 },
  { rankId: 'first-class', rankLabel: 'First Class', minActivities: 10, minCampouts: 6 }
];

/**
 * The event-linked kinds. `meeting_attendance` is deliberately absent — BSA
 * excludes meetings from 1a. `leadership`, the requirement kinds and the award
 * kinds are not events at all.
 */
const ACTIVITY_KINDS = [
  'camping_nights',
  'hiking_miles',
  'day_outing',
  'fundraiser',
  'service_hours'
] as const;

interface LedgerEvent {
  scout_id: string;
  code: string;
  date: string;
  kind: string;
}

/** One distinct activity: an event code a scout has at least one ledger row for. */
interface ScoutActivity {
  code: string;
  /** Earliest date on file for this code. */
  date: string;
  /** True when ANY row for this code is `camping_nights` — a weekend that
   *  logged both nights and service hours is one activity that IS a campout. */
  isCampout: boolean;
  /** Which kinds contributed, for the finding's detail lines. */
  kinds: Set<string>;
}

const KIND_LABEL: Record<string, string> = {
  camping_nights: 'Campouts',
  hiking_miles: 'Hikes',
  day_outing: 'Day outings',
  fundraiser: 'Fundraisers',
  service_hours: 'Service projects'
};

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
  const [activityRows, rankReqsRes, existing1aRows, scoutsRes] = await Promise.all([
    // One query across every activity kind — they are deduped together below,
    // so fetching them separately would only make that harder.
    fetchAllRows<LedgerEvent>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code, date, kind')
        .in('kind', ACTIVITY_KINDS as unknown as string[])
        .range(from, to)
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

  /*
   * Dedup by (scout_id, code) — one CODE is one activity, whatever kinds its
   * rows carry. The guard is against duplicate data entry, not against
   * multi-kind events: genuinely distinct events get distinct codes and count
   * separately. isCampout is OR-ed so a code with any camping_nights row counts
   * toward the campout threshold.
   */
  const activitiesByScout = new Map<string, Map<string, ScoutActivity>>();
  for (const row of activityRows) {
    const byCode = activitiesByScout.get(row.scout_id) ?? new Map<string, ScoutActivity>();
    const prev = byCode.get(row.code);
    if (prev) {
      if (row.date < prev.date) prev.date = row.date;
      if (row.kind === 'camping_nights') prev.isCampout = true;
      prev.kinds.add(row.kind);
    } else {
      byCode.set(row.code, {
        code: row.code,
        date: row.date,
        isCampout: row.kind === 'camping_nights',
        kinds: new Set([row.kind])
      });
    }
    activitiesByScout.set(row.scout_id, byCode);
  }

  const scouts = (scoutsRes.data ?? []) as { id: string; display_name: string }[];
  const findings: Finding[] = [];
  for (const scout of scouts) {
    const byCode = activitiesByScout.get(scout.id) ?? new Map<string, ScoutActivity>();
    const events = [...byCode.values()];
    const totalActivities = events.length;
    const campouts = events.filter((e) => e.isCampout).length;

    for (const t of THRESHOLDS) {
      if (totalActivities < t.minActivities || campouts < t.minCampouts) continue;
      const code = `${t.rankId}-1a`;
      if (existing1a.has(`${scout.id}|||${code}`)) continue;

      const qualifyingDate = qualifyingDateFor(events, t.minActivities, t.minCampouts);

      // Grouped by kind so a leader can see WHAT made up the tally — a campout
      // appears under Campouts even if it also logged service hours.
      const detailLines: string[] = [];
      for (const kind of ACTIVITY_KINDS) {
        const dates = events
          .filter((e) => (kind === 'camping_nights' ? e.isCampout : !e.isCampout && e.kinds.has(kind)))
          .map((e) => e.date)
          .sort();
        if (dates.length) {
          detailLines.push(`${KIND_LABEL[kind]} (${dates.length}): ${dates.map((d) => fmtDate(d)).join(', ')}`);
        }
      }

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
