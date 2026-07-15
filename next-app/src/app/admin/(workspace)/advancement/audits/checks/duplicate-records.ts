/**
 * Check: a scout has more than one ledger row for what looks like the same
 * real-world fact — same merit badge/rank award, same requirement leaf, same
 * "other award" (kind='award'), or the same event/service/leadership entry
 * on the same date. Usually a Fast Entry double-click or a re-import, not a
 * legitimate second occurrence.
 *
 * Grouping key depends on the kind:
 *   - ONE_TIME kinds (award/requirement leaves) group by scout+kind+code
 *     only — you can't earn the same rank, merit badge, or requirement leaf
 *     twice, so ANY repeat at ANY date is a duplicate.
 *   - DATE_SCOPED kinds (events, service, leadership, meeting attendance)
 *     also include `date` in the key — a recurring named event (e.g. an
 *     annual "Pancake Breakfast") reuses the same code every year, so only
 *     a repeat on the SAME date is a duplicate; different years are real,
 *     separate occurrences.
 *
 * This is a distinct shape from the other audits' `Finding` (which is about
 * MISSING sign-offs) — a duplicate's fix is "delete the extras", not "add a
 * sign-off", so it gets its own type, card, and action instead of being
 * force-fit into that interface.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { LedgerKind } from '@/lib/supabase/types';

const ONE_TIME_KINDS: ReadonlySet<LedgerKind> = new Set([
  'rank_award',
  'merit_badge_award',
  'rank_requirement',
  'merit_badge_requirement',
  'award'
]);

const KIND_LABEL: Record<LedgerKind, string> = {
  rank_requirement: 'Rank req',
  rank_award: 'Rank award',
  merit_badge_requirement: 'MB req',
  merit_badge_award: 'MB award',
  service_hours: 'Service',
  camping_nights: 'Campout',
  hiking_miles: 'Hike',
  day_outing: 'Day Outing',
  fundraiser: 'Fundraiser',
  leadership: 'Leadership',
  award: 'Other award',
  meeting_attendance: 'Meeting'
};

export interface DuplicateRecord {
  id: number;
  date: string | null;
  by: string | null;
  qty: number;
  unit: string;
  notes: string | null;
  enteredBy: string | null;
  enteredAt: string;
}

export interface DuplicateGroup {
  key: string;
  scoutId: string;
  scoutName: string;
  kind: LedgerKind;
  kindLabel: string;
  code: string;
  label: string;
  records: DuplicateRecord[]; // oldest first
  defaultKeepId: number;
}

interface LedgerRow {
  id: number;
  scout_id: string;
  kind: LedgerKind;
  code: string;
  label: string | null;
  date: string | null;
  by: string | null;
  qty: number;
  unit: string;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
}

export async function run(supabase: ReturnType<typeof createAdminClient>): Promise<DuplicateGroup[]> {
  const [rows, scoutsRes] = await Promise.all([
    fetchAllRows<LedgerRow>((from, to) =>
      supabase
        .from('ledger_active')
        .select('id, scout_id, kind, code, label, date, by, qty, unit, notes, entered_by, entered_at')
        .range(from, to)
    ),
    supabase.from('scouts').select('id, display_name')
  ]);

  const scoutNameById = new Map<string, string>();
  for (const s of (scoutsRes.data ?? []) as { id: string; display_name: string }[]) {
    scoutNameById.set(s.id, s.display_name);
  }

  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const key = ONE_TIME_KINDS.has(row.kind)
      ? `${row.scout_id}|||${row.kind}|||${row.code}`
      : `${row.scout_id}|||${row.kind}|||${row.code}|||${row.date}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const findings: DuplicateGroup[] = [];
  for (const [key, groupRows] of groups) {
    if (groupRows.length < 2) continue;

    const sorted = [...groupRows].sort((a, b) => {
      const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
      if (dateCmp !== 0) return dateCmp;
      return a.entered_at.localeCompare(b.entered_at);
    });

    const records: DuplicateRecord[] = sorted.map((r) => ({
      id: r.id,
      date: r.date,
      by: r.by,
      qty: r.qty,
      unit: r.unit,
      notes: r.notes,
      enteredBy: r.entered_by,
      enteredAt: r.entered_at
    }));

    const first = sorted[0];
    findings.push({
      key,
      scoutId: first.scout_id,
      scoutName: scoutNameById.get(first.scout_id) ?? first.scout_id,
      kind: first.kind,
      kindLabel: KIND_LABEL[first.kind],
      code: first.code,
      label: first.label ?? first.code,
      records,
      defaultKeepId: records[0].id
    });
  }

  findings.sort((a, b) => a.scoutName.localeCompare(b.scoutName) || a.label.localeCompare(b.label));
  return findings;
}
