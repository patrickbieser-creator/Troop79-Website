/**
 * Roll Call — pure helpers and types only.
 *
 * This file deliberately imports nothing but a type: like `calendar-shared.ts`
 * and `calendar-categories.ts`, it is imported by Client Components, so it must
 * not pull in the server-only Supabase client. The loaders live in
 * `lib/attendance.ts`.
 *
 * Attendance is the fourth LAYER on `calendar_entries`, after story, agenda and
 * signup. It records PRESENCE — a row means "was there", and absence is the
 * absence of a row (Patrick, 2026-08-14). It is not the store for advancement
 * quantities: marking someone present WRITES a ledger row, so everything that
 * reads the ledger keeps working untouched. See Plans/Roll-Call.md.
 */

import type { CalendarCategoryRow } from '@/lib/calendar-categories';

/** The ledger kinds a category can grant. Null grants nothing. */
export type CreditKind =
  | 'camping_nights'
  | 'hiking_miles'
  | 'service_hours'
  | 'day_outing'
  | 'fundraiser'
  | 'meeting_attendance';

export interface CategoryCreditRule {
  creditKind: CreditKind | null;
  creditUnit: string | null;
  countsAsActivity: boolean;
}

export interface AttendanceRow {
  id: number;
  personId: number;
  qty: number | null;
  source: 'signup' | 'manual' | 'import';
  note: string | null;
}

/**
 * People who can be on the roll but are NOT in person_directory — guests
 * (Plans/Guests-As-People.md) — get a candidate row of their own when they
 * signed up or already hold an attendance row. Without this a guest seeded
 * from the signup was counted by the tab pill yet had no checkbox to unmark
 * (Patrick, 2026-08-27: the Eagle Court of Honor's phantom "1 present").
 * Pure; `loadCandidates` supplies the people rows.
 */
export function withOffDirectoryCandidates(
  directory: AttendeeCandidate[],
  people: { id: number; display_name: string }[],
  signedUp: Set<number>
): AttendeeCandidate[] {
  const known = new Set(directory.map((c) => c.personId));
  const extras = people
    .filter((p) => !known.has(p.id))
    .map((p) => ({
      personId: p.id,
      displayName: p.display_name,
      scoutId: null,
      tab: 'guest',
      signedUp: signedUp.has(p.id)
    }));
  return [...directory, ...extras];
}

export interface AttendeeCandidate {
  personId: number;
  displayName: string;
  scoutId: string | null;
  tab: string;
  /** True when this person said yes on the event's signup — the pre-check. */
  signedUp: boolean;
}

/**
 * Nights a campout grants by default: its own date span.
 *
 * Patrick, 2026-08-14 — the entry already knows its dates, and a Friday-to-
 * Sunday campout is two nights. A per-person override handles partial stays,
 * which is also the only way to express "came Saturday for the day": zero
 * nights, but still an activity.
 *
 * Service hours start at 0 because nobody can guess how long a project ran;
 * the leader sets them. Everything else grants 1 of its unit.
 */
export function defaultQtyFor(
  creditKind: CreditKind | null,
  entryDate: string,
  endDate: string | null
): number {
  if (creditKind === 'camping_nights') {
    if (!endDate) return 1;
    const start = new Date(`${entryDate}T12:00:00Z`).getTime();
    const end = new Date(`${endDate}T12:00:00Z`).getTime();
    const nights = Math.round((end - start) / 86_400_000);
    return nights > 0 ? nights : 1;
  }
  if (creditKind === 'service_hours') return 0;
  if (creditKind === null) return 0;
  return 1;
}

/**
 * What quantity to write when resolving a "present, but no credit" audit
 * finding. Roll Call's own qty is used when it's on record; otherwise falls
 * back to the same default() Roll Call would use for a fresh check-in today.
 *
 * Found the hard way 2026-08-20: pre-Roll-Call imported attendance rows
 * (source='import', the historical spreadsheet backfill) never had a qty at
 * all — the resolve button required one and just sat there disabled with no
 * explanation. For every kind but service_hours, defaultQtyFor already knows
 * the right answer (nights from the entry's own date span, or 1) — no need
 * to leave the leader stuck. service_hours truly has no safe default (nobody
 * can guess how long a project ran), so that one still refuses and points at
 * Roll Call instead of guessing.
 */
export function qtyForMissingCreditResolution(
  creditKind: CreditKind | null,
  recordedQty: number | null | undefined,
  entryDate: string,
  endDate: string | null
): { qty: number } | { error: string } {
  if (recordedQty != null && recordedQty > 0) return { qty: recordedQty };
  const fallback = defaultQtyFor(creditKind, entryDate, endDate);
  if (fallback <= 0) {
    return {
      error:
        "Roll Call never recorded a quantity for this person, and this category has no safe default — set it from Roll Call directly."
    };
  }
  return { qty: fallback };
}

/** The credit rule a category carries. Tolerant of a category this render
 *  doesn't know, the same way colorFor() and templateOf() are. */
export function creditRuleFor(
  rows: (CalendarCategoryRow & {
    credit_kind?: string | null;
    credit_unit?: string | null;
    counts_as_activity?: boolean;
  })[],
  category: string
): CategoryCreditRule {
  const row = rows.find((r) => r.label === category);
  return {
    creditKind: (row?.credit_kind as CreditKind | null) ?? null,
    creditUnit: row?.credit_unit ?? null,
    countsAsActivity: row?.counts_as_activity ?? true
  };
}

/**
 * The ledger `code` Roll Call writes for an entry. Meetings keep the historic
 * `MTG:<date>` shape so backfilled rows and new ones agree; everything else is
 * keyed by entry id, which survives a rename or a date move.
 */
export function ledgerCodeFor(creditKind: CreditKind, entryId: number, entryDate: string): string {
  return creditKind === 'meeting_attendance' ? `MTG:${entryDate}` : `EVT:${entryId}`;
}

/**
 * Signed up but not marked present, and present but never signed up.
 *
 * Worth surfacing for its own sake: the first is someone who owes money and did
 * not come, the second is someone who came and was never invoiced. It is also
 * the only place a no-show is visible at all, since absences are not stored.
 */
export function reconcileWithSignup(
  candidates: AttendeeCandidate[],
  attended: Set<number>
): { missedSignup: AttendeeCandidate[]; unexpected: AttendeeCandidate[] } {
  return {
    missedSignup: candidates.filter((c) => c.signedUp && !attended.has(c.personId)),
    unexpected: candidates.filter((c) => !c.signedUp && attended.has(c.personId))
  };
}
