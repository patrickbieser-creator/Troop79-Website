/**
 * Ledger edits are audited (Patrick, 2026-10-22): every change to a ledger_entries row — a field edit (date, scout,
 * kind, code, label, by, qty, unit, notes), archive, delete or restore — writes one audit_log row per ledger row in
 * the 'advancement' area, as the acting leader (recordAudit), with before → after for the fields that changed in
 * `details` and the scout as a subject (so it shows on their record's History). The summary names the scout and the
 * requirement the short way: "Changed Anjali S Second Class BoR: date Aug 18, 2026 → Oct 5, 2025".
 *
 * Callers snapshot the rows BEFORE their write (loadLedgerForAudit), write, then hand the snapshot and what they
 * wrote to auditLedgerEdits / auditLedgerStatus. Never throws (recordAudit's invariant: auditing never breaks a save).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit, type AuditDetail, type AuditEntry } from '@/lib/audit';
import { fmtDate } from '@/lib/format-date';
import { boardName } from '@/lib/meeting-board-shared';

export interface LedgerAuditRow {
  id: number;
  scout_id: string;
  date: string;
  kind: string;
  code: string;
  label: string | null;
  by: string | null;
  qty: number;
  unit: string | null;
  notes: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  /** The scout's display name, for the summary. */
  scoutName: string;
  personId: number | null;
}

/** The editable fields, in the order a change reads. */
type Field = 'date' | 'scout_id' | 'kind' | 'code' | 'label' | 'by' | 'qty' | 'unit' | 'notes';
const FIELDS: readonly Field[] = ['date', 'scout_id', 'kind', 'code', 'label', 'by', 'qty', 'unit', 'notes'];
const FIELD_NAME: Record<Field, string> = { date: 'date', scout_id: 'scout', kind: 'kind', code: 'code', label: 'label', by: 'by', qty: 'qty', unit: 'unit', notes: 'notes' };

const RANK_NAME: Readonly<Record<string, string>> = {
  scout: 'Scout',
  tenderfoot: 'Tenderfoot',
  'second-class': 'Second Class',
  'first-class': 'First Class',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};
const RANK_IDS = Object.keys(RANK_NAME).sort((a, b) => b.length - a.length);

const shown = (v: unknown): string => (v == null || v === '' ? '—' : String(v));
const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What the row records, the short way: 'Second Class BoR', 'Star rank', 'Robotics', else its label or code. */
export function ledgerThing(row: Pick<LedgerAuditRow, 'kind' | 'code' | 'label'>): string {
  if (row.kind === 'rank_requirement') {
    const rank = RANK_IDS.find((id) => row.code.startsWith(`${id}-`));
    if (rank) return `${RANK_NAME[rank]} ${row.code.slice(rank.length + 1)}`;
  }
  if (row.kind === 'rank_award' && RANK_NAME[row.code]) return `${RANK_NAME[row.code]} rank`;
  const label = row.label?.trim().replace(/[.*\s]+$/, '');
  return label ? clip(label) : row.code;
}

/** Before → after for the fields that differ. Dates read 'Aug 18, 2026'; a scout reads by name when `names` has them. */
export function ledgerChanges(before: LedgerAuditRow, after: Partial<Record<Field, unknown>>, names: ReadonlyMap<string, string> = new Map()): AuditDetail[] {
  const out: AuditDetail[] = [];
  for (const f of FIELDS) {
    if (!(f in after)) continue;
    const a = after[f] ?? null;
    const b = before[f] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    if (f === 'date') out.push({ field: 'date', from: fmtDate(b as string | null), to: fmtDate(a as string | null) });
    else if (f === 'scout_id') out.push({ field: 'scout', from: before.scoutName || shown(b), to: names.get(String(a)) ?? shown(a) });
    else out.push({ field: FIELD_NAME[f], from: shown(b), to: shown(a) });
  }
  return out;
}

const whoWhat = (row: LedgerAuditRow) => `${boardName(row.scoutName) || row.scout_id} ${ledgerThing(row)}`;

/** "Changed Anjali S Second Class BoR: date Aug 18, 2026 → Oct 5, 2025; by PB → MB". */
export function ledgerEditSummary(row: LedgerAuditRow, changes: readonly AuditDetail[]): string {
  return `Changed ${whoWhat(row)}: ${changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join('; ')}`;
}

export type LedgerStatusAction = 'archive' | 'delete' | 'restore';
const VERB: Record<LedgerStatusAction, string> = { archive: 'Archived', delete: 'Deleted', restore: 'Restored' };

/** "Deleted Anjali S Second Class BoR (Duplicate)"; the reason in brackets when there is one. */
export function ledgerStatusSummary(row: LedgerAuditRow, action: LedgerStatusAction, reason: string | null): string {
  return `${VERB[action]} ${whoWhat(row)}${reason ? ` (${reason})` : ''}`;
}

const statusOf = (row: LedgerAuditRow) => (row.deleted_at ? 'Deleted' : row.archived_at ? 'Archived' : 'Active');

const SELECT = 'id, scout_id, date, kind, code, label, by, qty, unit, notes, archived_at, deleted_at, scouts(display_name, person_id)';
type Raw = Omit<LedgerAuditRow, 'scoutName' | 'personId'> & { scouts: { display_name: string; person_id: number | null } | { display_name: string; person_id: number | null }[] | null };

/** The rows as they are now (before a write), by id. A failed read gives an empty map: the save still goes ahead. */
export async function loadLedgerForAudit(sb: SupabaseClient, ids: readonly number[]): Promise<Map<number, LedgerAuditRow>> {
  const out = new Map<number, LedgerAuditRow>();
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from('ledger_entries').select(SELECT).in('id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as unknown as Raw[]) {
        const s = Array.isArray(r.scouts) ? r.scouts[0] : r.scouts;
        const { scouts: _s, ...rest } = r;
        void _s;
        out.set(r.id, { ...rest, scoutName: s?.display_name ?? '', personId: s?.person_id ?? null });
      }
    }
  } catch (e) {
    console.error('ledger audit snapshot failed:', e);
  }
  return out;
}

/** Display names for scout ids (a scout change reads "Anjali Shah → Finn Parker"). */
export async function scoutNamesFor(sb: SupabaseClient, scoutIds: readonly string[]): Promise<Map<string, string>> {
  if (!scoutIds.length) return new Map();
  const { data } = await sb.from('scouts').select('id, display_name').in('id', [...new Set(scoutIds)]);
  return new Map(((data ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
}

function entry(row: LedgerAuditRow, action: string, summary: string, details: AuditDetail[]): AuditEntry {
  return {
    area: 'advancement',
    action,
    entityType: 'ledger_entry',
    entityId: row.id,
    summary,
    details,
    ...(row.personId != null ? { subjects: [row.personId] } : {})
  };
}

/** One audit row per edited ledger row whose fields actually changed; `patch` is what was written to every row. */
export async function auditLedgerEdits(before: ReadonlyMap<number, LedgerAuditRow>, patch: Partial<Record<Field, unknown>>, names?: ReadonlyMap<string, string>): Promise<void> {
  await Promise.all(
    [...before.values()].map((row) => {
      const changes = ledgerChanges(row, patch, names);
      return changes.length ? recordAudit(entry(row, 'update', ledgerEditSummary(row, changes), changes)) : null;
    })
  );
}

/** One audit row per archived / deleted / restored ledger row (a row already in that state is skipped). */
export async function auditLedgerStatus(before: ReadonlyMap<number, LedgerAuditRow>, action: LedgerStatusAction, reason: string | null): Promise<void> {
  const to = action === 'restore' ? 'Active' : VERB[action];
  await Promise.all(
    [...before.values()].map((row) => {
      const from = statusOf(row);
      if (from === to) return null;
      const details: AuditDetail[] = [{ field: 'status', from, to }, ...(reason ? [{ field: 'reason', from: '—', to: reason }] : [])];
      return recordAudit(entry(row, action, ledgerStatusSummary(row, action, reason), details));
    })
  );
}
