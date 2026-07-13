/**
 * Check: a scout has been active long enough since their prior rank's award
 * date to satisfy Star 1 (4 months since First Class), Life 1 (6 months
 * since Star), or Eagle 1 (6 months since Life) — but that requirement
 * isn't signed off yet.
 *
 * "Active" is purely calendar time from the prerequisite rank's rank_award
 * date to today — the schema has no leave-of-absence/inactive-period
 * concept, so that's the only thing this can compute.
 *
 * Deliberately does NOT gate on current_rank being exactly the prerequisite
 * rank (a scout who's since advanced further still keeps their earlier
 * rank_award rows) — matches activity-thresholds.ts's philosophy: fire off
 * raw ledger evidence vs. whether the leaf is signed off, so it also
 * backfills historical completeness for scouts who've already moved on.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { centralToday } from '@/lib/dates';
import type { Finding } from '../types';

const THRESHOLDS: { rankId: string; rankLabel: string; prereqRankId: string; prereqLabel: string; minMonths: number }[] = [
  { rankId: 'star', rankLabel: 'Star', prereqRankId: 'first-class', prereqLabel: 'First Class', minMonths: 4 },
  { rankId: 'life', rankLabel: 'Life', prereqRankId: 'star', prereqLabel: 'Star', minMonths: 6 },
  { rankId: 'eagle', rankLabel: 'Eagle', prereqRankId: 'life', prereqLabel: 'Life', minMonths: 6 }
];

function monthsBetween(startISO: string, endISO: string): number {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months--;
  return months;
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export async function run(supabase: ReturnType<typeof createAdminClient>): Promise<Finding[]> {
  const today = centralToday();
  const [awardRows, rankReqsRes, existingRows, scoutsRes] = await Promise.all([
    fetchAllRows<{ scout_id: string; code: string; date: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code, date')
        .eq('kind', 'rank_award')
        .in('code', THRESHOLDS.map((t) => t.prereqRankId))
        .range(from, to)
    ),
    supabase
      .from('rank_requirements')
      .select('rank_id, label')
      .in('rank_id', THRESHOLDS.map((t) => t.rankId))
      .eq('code', '1'),
    supabase
      .from('ledger_active')
      .select('scout_id, code')
      .eq('kind', 'rank_requirement')
      .in('code', THRESHOLDS.map((t) => `${t.rankId}-1`)),
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
  const existing = new Set<string>();
  for (const row of (existingRows.data ?? []) as { scout_id: string; code: string }[]) {
    existing.add(`${row.scout_id}|||${row.code}`);
  }

  // Earliest award date per (scout, prereq rank) — same defensive dedup as
  // activity-thresholds.ts, in case a rank was accidentally logged twice.
  const awardDateByScoutRank = new Map<string, string>();
  for (const row of awardRows) {
    const key = `${row.scout_id}|||${row.code}`;
    const prev = awardDateByScoutRank.get(key);
    if (!prev || row.date < prev) awardDateByScoutRank.set(key, row.date);
  }

  const scouts = (scoutsRes.data ?? []) as { id: string; display_name: string }[];
  const findings: Finding[] = [];
  for (const scout of scouts) {
    for (const t of THRESHOLDS) {
      const code = `${t.rankId}-1`;
      if (existing.has(`${scout.id}|||${code}`)) continue;

      const awardDate = awardDateByScoutRank.get(`${scout.id}|||${t.prereqRankId}`);
      if (!awardDate) continue;

      const months = monthsBetween(awardDate, today);
      if (months < t.minMonths) continue;

      findings.push({
        checkId: 'rank-time-in-grade',
        scoutId: scout.id,
        scoutName: scoutNameById.get(scout.id) ?? scout.id,
        groupLabel: t.rankLabel,
        contextLine: `${months} month${months === 1 ? '' : 's'} since earning ${t.prereqLabel} (${fmtDate(awardDate)})`,
        qualifyingDate: addMonths(awardDate, t.minMonths),
        missing: [
          {
            code,
            shortCode: '1',
            label: labelByRank.get(t.rankId) ?? '1',
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
