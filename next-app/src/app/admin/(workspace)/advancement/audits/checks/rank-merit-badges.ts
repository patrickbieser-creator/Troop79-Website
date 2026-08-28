/**
 * Check: a scout has earned enough merit badges (and enough Eagle-required
 * ones among them) to satisfy Star 3 (6 badges, 4 Eagle-required) or Life 3
 * (5 MORE badges on top of Star's 6 — 11 total, 3 MORE Eagle-required — 7
 * total), but that requirement isn't signed off yet.
 *
 * Counts are cumulative totals, not "the specific 6/11 badges used for the
 * prior rank" — a scout keeps every earned badge forever, and each rank's
 * requirement is phrased as a running total (confirmed by the stored label
 * text: "Five MORE Merit Badges (3 Eagle-required)").
 *
 * Deliberately does NOT gate on current_rank/prior rank award — per the
 * user, only the non-merit-badge requirements (time-in-rank, POR) require
 * having already earned the prior rank. A scout can reasonably show up here
 * well ahead of formally starting work on the rank.
 */

import { mbIdFromAwardCode } from '@/lib/scout-detail';
import type { Finding } from '../types';
import { activeScouts, ledgerOfKind, type AuditInput } from '../audit-input';

const THRESHOLDS: { rankId: string; rankLabel: string; minTotal: number; minEagle: number }[] = [
  { rankId: 'star', rankLabel: 'Star', minTotal: 6, minEagle: 4 },
  { rankId: 'life', rankLabel: 'Life', minTotal: 11, minEagle: 7 }
];

interface MbAwardEvent {
  scout_id: string;
  code: string; // MB:<id>
  date: string;
}

/** Same "later of the two thresholds" logic as activity-thresholds.ts. */
function qualifyingDateFor(
  events: { date: string; isEagle: boolean }[],
  minTotal: number,
  minEagle: number
): string {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let runningTotal = 0;
  let runningEagle = 0;
  let totalThresholdDate: string | null = null;
  let eagleThresholdDate: string | null = null;
  for (const e of sorted) {
    runningTotal++;
    if (e.isEagle) runningEagle++;
    if (totalThresholdDate === null && runningTotal >= minTotal) totalThresholdDate = e.date;
    if (eagleThresholdDate === null && runningEagle >= minEagle) eagleThresholdDate = e.date;
  }
  const dates = [totalThresholdDate, eagleThresholdDate].filter((d): d is string => d !== null);
  return dates.length ? dates.sort().at(-1)! : (sorted.at(-1)?.date ?? '');
}

export async function run(input: AuditInput): Promise<Finding[]> {
  const mbCatalogRes = await input.supabase.from('merit_badges').select('id, name, eagle');
  const rankIds = new Set(THRESHOLDS.map((t) => t.rankId));
  const codes3 = new Set(THRESHOLDS.map((t) => `${t.rankId}-3`));
  const awardRows: MbAwardEvent[] = ledgerOfKind(input.ledger, ['merit_badge_award']);
  const existingRows = ledgerOfKind(input.ledger, ['rank_requirement']).filter((r) => codes3.has(r.code));
  const scouts = activeScouts(input.scouts);

  const eagleById = new Map<string, boolean>();
  const nameByMbId = new Map<string, string>();
  for (const m of (mbCatalogRes.data ?? []) as { id: string; name: string; eagle: boolean }[]) {
    eagleById.set(m.id, m.eagle);
    nameByMbId.set(m.id, m.name);
  }
  const labelByRank = new Map<string, string>();
  for (const r of input.rankRequirements) {
    if (r.code === '3' && rankIds.has(r.rank_id)) labelByRank.set(r.rank_id, r.label);
  }
  const scoutNameById = new Map<string, string>();
  for (const s of scouts) {
    scoutNameById.set(s.id, s.display_name);
  }
  const existing = new Set<string>();
  for (const row of existingRows) {
    existing.add(`${row.scout_id}|||${row.code}`);
  }

  // Dedup by (scout_id, mb_id), keeping the earliest award date on file.
  const mbByScout = new Map<string, Map<string, string>>(); // scout_id -> mb_id -> earliest date
  for (const row of awardRows) {
    const mbId = mbIdFromAwardCode(row.code);
    if (!mbId) continue;
    const byMb = mbByScout.get(row.scout_id) ?? new Map<string, string>();
    const prev = byMb.get(mbId);
    if (!prev || row.date < prev) byMb.set(mbId, row.date);
    mbByScout.set(row.scout_id, byMb);
  }

  const findings: Finding[] = [];
  for (const scout of scouts) {
    const byMb = mbByScout.get(scout.id) ?? new Map<string, string>();
    const mbIds = [...byMb.keys()];
    const eagleIds = mbIds.filter((id) => eagleById.get(id) === true);
    const total = mbIds.length;
    const eagleCount = eagleIds.length;

    for (const t of THRESHOLDS) {
      if (total < t.minTotal || eagleCount < t.minEagle) continue;
      const code = `${t.rankId}-3`;
      if (existing.has(`${scout.id}|||${code}`)) continue;

      const events = mbIds.map((id) => ({ date: byMb.get(id)!, isEagle: eagleById.get(id) === true }));
      const qualifyingDate = qualifyingDateFor(events, t.minTotal, t.minEagle);

      const otherIds = mbIds.filter((id) => !eagleById.get(id));
      const detailLines = [
        `Eagle-required (${eagleIds.length}): ${eagleIds.map((id) => nameByMbId.get(id) ?? id).sort().join(', ')}`,
        ...(otherIds.length ? [`Other (${otherIds.length}): ${otherIds.map((id) => nameByMbId.get(id) ?? id).sort().join(', ')}`] : [])
      ];

      findings.push({
        checkId: 'rank-merit-badges',
        scoutId: scout.id,
        scoutName: scoutNameById.get(scout.id) ?? scout.id,
        groupLabel: t.rankLabel,
        contextLine: `${total} merit badge${total === 1 ? '' : 's'} earned (${eagleCount} Eagle-required)`,
        qualifyingDate,
        detailLines,
        missing: [
          {
            code,
            shortCode: '3',
            label: labelByRank.get(t.rankId) ?? '3',
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
