/**
 * Check: Roll Call attendance and the ledger credit it grants agree.
 *
 * WHY THIS EXISTS
 * Two decisions make it load-bearing rather than belt-and-braces
 * (Patrick, 2026-08-14):
 *
 *   1. Credit is AUTOMATIC — marking someone present writes a ledger row across
 *      a second table with no transaction boundary. That is the textbook setup
 *      for silent drift.
 *   2. Absences are INFERRED, never stored — so a roll call that failed halfway
 *      through looks exactly like a small event. There is no redundancy left to
 *      spot it with.
 *
 * Together those mean a discrepancy has no other way to surface. This check is
 * how it does.
 *
 * DELIBERATELY NOT FLAGGED: ledger rows whose `calendar_entry_id` is null.
 * ~9,700 historical rows predate the column, and Fast Entry may legitimately
 * record a scout who camped with another troop. Null means "not from Roll Call"
 * and is correct as it stands — flagging those would bury the real findings
 * under a decade of noise.
 */

import type { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';

export type ReconciliationKind =
  | 'credit_missing'
  | 'credit_orphaned'
  | 'qty_mismatch'
  | 'date_drift';

export interface ReconciliationFinding {
  key: string;
  kind: ReconciliationKind;
  entryId: number;
  entryTitle: string;
  entryDate: string;
  personName: string;
  detail: string;
}

const KIND_ORDER: ReconciliationKind[] = [
  'credit_orphaned',
  'credit_missing',
  'qty_mismatch',
  'date_drift'
];

export const RECONCILIATION_LABEL: Record<ReconciliationKind, string> = {
  credit_missing: 'Present, but no credit',
  credit_orphaned: 'Credit without attendance',
  qty_mismatch: 'Quantity disagrees',
  date_drift: 'Credit dated differently from its event'
};

interface AttendanceRow {
  calendar_entry_id: number;
  person_id: number;
  qty: number | null;
}
interface LedgerRow {
  id: number;
  scout_id: string;
  date: string;
  qty: number;
  calendar_entry_id: number;
}

export async function run(
  supabase: ReturnType<typeof createAdminClient>
): Promise<ReconciliationFinding[]> {
  const [attendanceRows, ledgerRows, entriesRes, categoriesRes, scouts, people] =
    await Promise.all([
      fetchAllRows<AttendanceRow>((from, to) =>
        supabase.from('event_attendance').select('calendar_entry_id, person_id, qty').range(from, to)
      ),
      fetchAllRows<LedgerRow>((from, to) =>
        supabase
          .from('ledger_active')
          .select('id, scout_id, date, qty, calendar_entry_id')
          .not('calendar_entry_id', 'is', null)
          .range(from, to)
      ),
      supabase.from('calendar_entries').select('id, title, entry_date, category'),
      supabase.from('calendar_categories').select('label, credit_kind'),
      /*
       * Paginated even though both tables are small today. A truncated `scouts`
       * read does not merely slow this check down — a scout missing from the
       * map is treated as an ADULT, silently skipped, and their missing credit
       * never reported. The one screen whose job is catching integrity problems
       * should not have an integrity problem of its own.
       */
      fetchAllRows<{ id: string; person_id: number | null; display_name: string }>((from, to) =>
        supabase.from('scouts').select('id, person_id, display_name').range(from, to)
      ),
      fetchAllRows<{ id: number; display_name: string }>((from, to) =>
        supabase.from('people').select('id, display_name').range(from, to)
      )
    ]);

  const entryById = new Map(
    ((entriesRes.data ?? []) as { id: number; title: string; entry_date: string; category: string }[]).map(
      (e) => [e.id, e]
    )
  );
  const creditByCategory = new Map(
    ((categoriesRes.data ?? []) as { label: string; credit_kind: string | null }[]).map((c) => [
      c.label,
      c.credit_kind
    ])
  );
  const scoutIdByPerson = new Map(
    scouts.filter((s) => s.person_id != null).map((s) => [s.person_id as number, s.id])
  );
  const personIdByScout = new Map(
    scouts.filter((s) => s.person_id != null).map((s) => [s.id, s.person_id as number])
  );
  const nameByPerson = new Map(people.map((p) => [p.id, p.display_name]));

  const findings: ReconciliationFinding[] = [];
  const push = (
    kind: ReconciliationKind,
    entryId: number,
    personId: number | null,
    detail: string
  ) => {
    const entry = entryById.get(entryId);
    findings.push({
      key: `${kind}:${entryId}:${personId ?? 'x'}`,
      kind,
      entryId,
      entryTitle: entry?.title ?? `Entry ${entryId}`,
      entryDate: entry?.entry_date ?? '',
      personName: personId != null ? (nameByPerson.get(personId) ?? `Person ${personId}`) : '—',
      detail
    });
  };

  // Ledger rows keyed by the pair Roll Call writes them against.
  const ledgerByPair = new Map<string, LedgerRow>();
  for (const row of ledgerRows) {
    ledgerByPair.set(`${row.calendar_entry_id}|${row.scout_id}`, row);
  }

  // ── attendance → credit ──
  const attendancePairs = new Set<string>();
  for (const att of attendanceRows) {
    const scoutId = scoutIdByPerson.get(att.person_id);
    if (!scoutId) continue; // adults have no ledger by design
    attendancePairs.add(`${att.calendar_entry_id}|${scoutId}`);

    const entry = entryById.get(att.calendar_entry_id);
    if (!entry) continue;
    const creditKind = creditByCategory.get(entry.category);
    if (!creditKind) continue; // category grants nothing

    const led = ledgerByPair.get(`${att.calendar_entry_id}|${scoutId}`);
    if (!led) {
      push(
        'credit_missing',
        att.calendar_entry_id,
        att.person_id,
        'Marked present, but no ledger credit was written. The scout is short this event.'
      );
      continue;
    }
    if (att.qty != null && Number(att.qty) !== Number(led.qty)) {
      push(
        'qty_mismatch',
        att.calendar_entry_id,
        att.person_id,
        `Roll Call says ${att.qty}, the ledger says ${led.qty}. An edit reached one side only.`
      );
    }
    if (led.date !== entry.entry_date) {
      push(
        'date_drift',
        att.calendar_entry_id,
        att.person_id,
        `Credit is dated ${led.date} but the event is ${entry.entry_date}. The entry moved and the credit did not follow.`
      );
    }
  }

  // ── credit → attendance ──
  // The harder direction to notice: an uncheck that failed to cascade leaves a
  // scout holding credit for an event they were removed from.
  for (const row of ledgerRows) {
    if (attendancePairs.has(`${row.calendar_entry_id}|${row.scout_id}`)) continue;
    push(
      'credit_orphaned',
      row.calendar_entry_id,
      personIdByScout.get(row.scout_id) ?? null,
      'Holds credit stamped with this event, but is not on its Roll Call. An uncheck did not cascade.'
    );
  }

  return findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      b.entryDate.localeCompare(a.entryDate)
  );
}
