/**
 * Check: a scout has logged enough service hours for a rank's service requirement, but it isn't signed off yet
 * (Patrick, 2026-11-15).
 *
 *   - Tenderfoot 7b (1 hour), Second Class 8e (2 more: 3 in all), First Class 9d (3 more: 6 in all) — cumulative
 *     hours from every `service_hours` row, any date, not gated on rank (same as the activity-thresholds check).
 *   - Star 4 (6 hours while a First Class Scout) and Life 4 (6 hours while a Star Scout) — only hours dated on or
 *     after the prior rank's award count, and only once that award is on record (same gate as rank-por).
 *
 * Life 4 also asks that 3 of the 6 hours be conservation. The ledger doesn't record that, so the finding says to
 * check it rather than pretending to know.
 *
 * The sign-off date defaults to the day the running total reached the threshold.
 */

import { fmtDate } from '@/lib/format-date';
import type { Finding } from '../types';
import { activeScouts, ledgerOfKind, type AuditInput, type AuditLedgerRow } from '../audit-input';

interface Rule {
  rankId: string;
  rankLabel: string;
  code: string;
  hours: number;
  /** Count only hours on or after this rank's award; the check is skipped until it is awarded. */
  sinceRankId?: string;
  sinceLabel?: string;
  note?: string;
}

const RULES: Rule[] = [
  { rankId: 'tenderfoot', rankLabel: 'Tenderfoot', code: '7b', hours: 1 },
  { rankId: 'second-class', rankLabel: 'Second Class', code: '8e', hours: 3 },
  { rankId: 'first-class', rankLabel: 'First Class', code: '9d', hours: 6 },
  { rankId: 'star', rankLabel: 'Star', code: '4', hours: 6, sinceRankId: 'first-class', sinceLabel: 'First Class' },
  {
    rankId: 'life',
    rankLabel: 'Life',
    code: '4',
    hours: 6,
    sinceRankId: 'star',
    sinceLabel: 'Star',
    note: 'Check that at least 3 of these hours were conservation; the ledger doesn’t record that.'
  }
];

const fmtHours = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} hour${n === 1 ? '' : 's'}`;

export async function run(input: AuditInput): Promise<Finding[]> {
  const scouts = activeScouts(input.scouts);
  const service = ledgerOfKind(input.ledger, ['service_hours']);
  const awards = ledgerOfKind(input.ledger, ['rank_award']);
  const signedOff = new Set(ledgerOfKind(input.ledger, ['rank_requirement']).map((r) => `${r.scout_id}|${r.code}`));

  const labelOf = new Map(input.rankRequirements.map((r) => [`${r.rank_id}-${r.code}`, r.label]));
  const serviceByScout = new Map<string, AuditLedgerRow[]>();
  for (const r of service) {
    const list = serviceByScout.get(r.scout_id) ?? [];
    list.push(r);
    serviceByScout.set(r.scout_id, list);
  }
  const awardDate = new Map<string, string>();
  for (const r of awards) {
    const key = `${r.scout_id}|${r.code}`;
    const prev = awardDate.get(key);
    if (!prev || r.date < prev) awardDate.set(key, r.date);
  }

  const findings: Finding[] = [];
  for (const scout of scouts) {
    const rows = (serviceByScout.get(scout.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    if (rows.length === 0) continue;
    for (const rule of RULES) {
      const code = `${rule.rankId}-${rule.code}`;
      if (signedOff.has(`${scout.id}|${code}`)) continue;
      let since: string | undefined;
      if (rule.sinceRankId) {
        since = awardDate.get(`${scout.id}|${rule.sinceRankId}`);
        if (!since) continue;
      }
      const counted = since ? rows.filter((r) => r.date >= since) : rows;
      let total = 0;
      let reachedOn: string | null = null;
      for (const r of counted) {
        total += Number(r.qty) || 0;
        if (reachedOn === null && total >= rule.hours) reachedOn = r.date;
      }
      if (reachedOn === null) continue;

      findings.push({
        checkId: 'service-hours',
        scoutId: scout.id,
        scoutName: scout.display_name,
        groupLabel: rule.rankLabel,
        contextLine: since
          ? `${fmtHours(total)} of service logged since earning ${rule.sinceLabel} (${fmtDate(since)}); ${rule.hours} needed`
          : `${fmtHours(total)} of service logged in all; ${rule.hours} needed by ${rule.rankLabel}`,
        qualifyingDate: reachedOn,
        detailLines: [
          counted.map((r) => `${r.label ?? r.code} · ${fmtHours(Number(r.qty) || 0)} (${fmtDate(r.date)})`).join(', '),
          ...(rule.note ? [rule.note] : [])
        ],
        missing: [{ code, shortCode: rule.code, label: labelOf.get(code) ?? rule.code, parentCode: null, parentLabel: null }]
      });
    }
  }

  findings.sort((a, b) => a.scoutName.localeCompare(b.scoutName) || a.groupLabel.localeCompare(b.groupLabel));
  return findings;
}
