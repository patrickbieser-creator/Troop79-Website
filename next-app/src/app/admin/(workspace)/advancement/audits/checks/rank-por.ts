/**
 * Check: a scout has logged a Position of Responsibility since earning the
 * prior rank, satisfying Star 5 or Life 5 (both literally "Position of
 * Responsibility" in the stored catalog), but that requirement isn't signed
 * off yet.
 *
 * Per the user: unlike time-in-grade/merit-badges, POR is only relevant once
 * the scout has already earned the rank below the one being checked (Star 5
 * requires First Class already earned; Life 5 requires Star already earned)
 * — so this check IS gated on a prior rank_award existing, unlike its
 * sibling checks in this audit.
 *
 * Eligible positions: any `leadership` ledger row counts — the schema has no
 * rank-specific eligible-position list, and Fast Entry's Leadership tab
 * already draws from a curated `leadership_positions` lookup, so any logged
 * term is presumed to be a real qualifying position (confirmed with user).
 *
 * Eligible term dates: only leadership entries dated ON OR AFTER the
 * prerequisite rank's award date count — a POR term served before earning
 * the prior rank isn't credited toward the next rank's requirement. This is
 * an assumption, not stored data (no per-term "which rank tier" field
 * exists) — revisit if it doesn't match how the troop actually tracks this.
 *
 * No duration tracking exists (a `leadership` row has one `date`, not a
 * start/end range) — presence of the row is treated as a completed
 * qualifying term, same "ledger row = completed fact" philosophy as
 * rank_award and every other kind in this schema (confirmed with user).
 */

import { fmtDate } from '@/lib/format-date';
import type { Finding } from '../types';
import { activeScouts, ledgerOfKind, type AuditInput } from '../audit-input';

const THRESHOLDS: { rankId: string; rankLabel: string; prereqRankId: string; prereqLabel: string }[] = [
  { rankId: 'star', rankLabel: 'Star', prereqRankId: 'first-class', prereqLabel: 'First Class' },
  { rankId: 'life', rankLabel: 'Life', prereqRankId: 'star', prereqLabel: 'Star' }
];

export async function run(input: AuditInput): Promise<Finding[]> {
  const rankIds = new Set(THRESHOLDS.map((t) => t.rankId));
  const prereqRankIds = new Set(THRESHOLDS.map((t) => t.prereqRankId));
  const codes5 = new Set(THRESHOLDS.map((t) => `${t.rankId}-5`));
  const awardRows = ledgerOfKind(input.ledger, ['rank_award']).filter((r) => prereqRankIds.has(r.code));
  const leadershipRows = ledgerOfKind(input.ledger, ['leadership']);
  const existingRows = ledgerOfKind(input.ledger, ['rank_requirement']).filter((r) => codes5.has(r.code));
  const scouts = activeScouts(input.scouts);

  const labelByRank = new Map<string, string>();
  for (const r of input.rankRequirements) {
    if (r.code === '5' && rankIds.has(r.rank_id)) labelByRank.set(r.rank_id, r.label);
  }
  const scoutNameById = new Map<string, string>();
  for (const s of scouts) {
    scoutNameById.set(s.id, s.display_name);
  }
  const existing = new Set<string>();
  for (const row of existingRows) {
    existing.add(`${row.scout_id}|||${row.code}`);
  }

  const awardDateByScoutRank = new Map<string, string>();
  for (const row of awardRows) {
    const key = `${row.scout_id}|||${row.code}`;
    const prev = awardDateByScoutRank.get(key);
    if (!prev || row.date < prev) awardDateByScoutRank.set(key, row.date);
  }

  const termsByScout = new Map<string, { label: string; date: string }[]>();
  for (const row of leadershipRows) {
    const list = termsByScout.get(row.scout_id) ?? [];
    list.push({ label: row.label ?? 'Leadership position', date: row.date });
    termsByScout.set(row.scout_id, list);
  }

  const findings: Finding[] = [];
  for (const scout of scouts) {
    for (const t of THRESHOLDS) {
      const code = `${t.rankId}-5`;
      if (existing.has(`${scout.id}|||${code}`)) continue;

      const awardDate = awardDateByScoutRank.get(`${scout.id}|||${t.prereqRankId}`);
      if (!awardDate) continue;

      const terms = (termsByScout.get(scout.id) ?? [])
        .filter((term) => term.date >= awardDate)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (terms.length === 0) continue;

      const earliest = terms[0];
      findings.push({
        checkId: 'rank-por',
        scoutId: scout.id,
        scoutName: scoutNameById.get(scout.id) ?? scout.id,
        groupLabel: t.rankLabel,
        contextLine: `${terms.length} qualifying position${terms.length === 1 ? '' : 's'} logged since earning ${t.prereqLabel}`,
        qualifyingDate: earliest.date,
        detailLines: [terms.map((term) => `${term.label} (${fmtDate(term.date)})`).join(', ')],
        missing: [
          {
            code,
            shortCode: '5',
            label: labelByRank.get(t.rankId) ?? '5',
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
