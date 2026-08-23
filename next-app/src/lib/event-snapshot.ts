/**
 * The event snapshot — the campout sheet's one tab, as a printable document
 * (Plans/Event-Logistics.md §E). Everything below is pure: the route loads
 * rows and renders what these functions shape, so the document's shape is
 * testable without a printer.
 *
 * WHAT IS DELIBERATELY ABSENT (same rule as lib/roster-print.ts): medical
 * content of any kind. The roster's free-text "things we should know" field
 * is never read here; free-text LEADER-ONLY columns print only when the
 * leader flagged them print_allowed
 * (qa-lead, 2026-08-22 — a free-text "Meds" column would otherwise be the
 * backdoor the 2026-07-13 decision closed). Checkbox and number columns
 * always print.
 */

import { LEG_LABEL, type Leg, type RideStatus, RIDE_STATUS_LABEL } from '@/lib/transport';
import { money } from '@/lib/event-money';

export interface SnapshotPerson {
  entryId: number;
  name: string;
  classLabel: string;
  /** Grid shorthand (S / A / JL / Cub / W / G) for the roster table cell;
   *  classLabel stays the full word for counts and contacts. */
  classShort?: string;
  isYouth: boolean;
  status: string; // yes | waitlist
  participation: string;
  grade: string | null;
  /** Adult's own phone, or a scout's guardian phone(s) — leader-only surface. */
  phone: string | null;
  email: string | null;
  household: string | null;
  drivesOut: boolean;
  drivesBack: boolean;
  vehicleSeatsOut: number | null;
  vehicleSeatsBack: number | null;
  rideOut: RideStatus | null;
  rideBack: RideStatus | null;
  slipReceived: boolean;
  owed: number;
  paid: number;
  balance: number;
  notes: string | null;
  /** question id → value, leader-only questions only. */
  leaderAnswers: Record<number, string>;
  /** question id → value, family questions. */
  answers: Record<number, string>;
}

export interface SnapshotQuestion {
  id: number;
  prompt: string;
  inputType: 'text' | 'number' | 'choice';
  leaderOnly: boolean;
  printAllowed: boolean;
}

export interface SnapshotSet {
  id: number;
  label: string;
  kind: string;
  leg: Leg | null;
  groups: { id: number; name: string; capacity: number | null; driverEntryId: number | null; notes: string | null; memberEntryIds: number[] }[];
}

export interface SnapshotInput {
  title: string;
  dateLabel: string;
  location: string | null;
  people: SnapshotPerson[];
  questions: SnapshotQuestion[];
  sets: SnapshotSet[];
  expenses: { occurredOn: string; amount: number; memo: string | null; method: string | null }[];
  reimbursements: { requesterName: string; amount: number; status: string; description: string }[];
  milestones: { label: string; dueOn: string; amount: number | null; kind: string }[];
  incomeByMethod: Record<string, number>;
  totals: { owed: number; paid: number; due: number; income: number; expenses: number; reimbursementsPending: number; net: number };
}

/** Which question columns print: family questions always; leader-only
 *  checkbox/number always; leader-only TEXT only when print_allowed. */
export function printableQuestions(questions: readonly SnapshotQuestion[]): SnapshotQuestion[] {
  return questions.filter((q) => !q.leaderOnly || q.inputType !== 'text' || q.printAllowed);
}

export interface SnapshotRosterSection {
  heading: string;
  rows: SnapshotPerson[];
}

/** How the printed roster is ordered (Patrick, 2026-08-22): by patrol (the
 *  sheet), A–Z by last name, or by class — adults, junior leaders, scouts,
 *  then everyone else. */
export type RosterOrder = 'patrol' | 'alpha' | 'class';
export const ROSTER_ORDERS: readonly RosterOrder[] = ['patrol', 'alpha', 'class'];
export const ROSTER_ORDER_LABEL: Record<RosterOrder, string> = {
  patrol: 'By patrol',
  alpha: 'A–Z by last name',
  class: 'Adults · JLs · Scouts'
};
export function parseRosterOrder(v: unknown): RosterOrder {
  return v === 'alpha' || v === 'class' ? v : 'patrol';
}

/** adults 0 · junior leaders 1 · scouts 2 · everyone else 3. */
export function classRank(classLabel: string): number {
  const c = classLabel.trim().toLowerCase();
  if (c === 'adult') return 0;
  if (c === 'junior leader') return 1;
  if (c === 'scout') return 2;
  return 3;
}

/** "Anjali Sankpal-Tatera" → "sankpal-tatera anjali": last name first, so an
 *  alphabetical roster reads the way the troop's paper lists do. */
export function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim().toLowerCase();
  return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`.toLowerCase();
}

/** Roster grouped by the first patrol/crew set when one exists (the sheet's
 *  Patrol column), else one flat section. Unplaced people go last.
 *  `order='alpha'` (Patrick, 2026-08-22) ignores the sets: one section, A–Z by
 *  last name — the other way the roster gets printed. */
export function buildRosterSections(input: SnapshotInput, order: RosterOrder = 'patrol'): SnapshotRosterSection[] {
  const live = input.people.filter((p) => p.status === 'yes' || p.status === 'waitlist');
  const byName = (a: SnapshotPerson, b: SnapshotPerson) => a.name.localeCompare(b.name);
  const byLast = (a: SnapshotPerson, b: SnapshotPerson) => lastNameKey(a.name).localeCompare(lastNameKey(b.name));
  if (order === 'alpha') {
    return [{ heading: 'Everyone, A–Z by last name', rows: [...live].sort(byLast) }];
  }
  if (order === 'class') {
    return [
      {
        heading: 'Everyone — adults, junior leaders, scouts',
        rows: [...live].sort((a, b) => classRank(a.classLabel) - classRank(b.classLabel) || byLast(a, b))
      }
    ];
  }
  const grouping = input.sets.find((s) => s.kind === 'patrol' || s.kind === 'crew');
  if (!grouping) return [{ heading: 'Everyone', rows: [...live].sort(byName) }];
  const placed = new Set<number>();
  const sections: SnapshotRosterSection[] = [];
  for (const g of [...grouping.groups].sort((a, b) => a.name.localeCompare(b.name))) {
    const rows = live.filter((p) => g.memberEntryIds.includes(p.entryId)).sort(byName);
    rows.forEach((r) => placed.add(r.entryId));
    if (rows.length > 0) sections.push({ heading: g.name, rows });
  }
  const rest = live.filter((p) => !placed.has(p.entryId)).sort(byName);
  if (rest.length > 0) sections.push({ heading: `Not in a ${grouping.kind}`, rows: rest });
  return sections;
}

export interface SnapshotCar {
  leg: Leg;
  driverName: string;
  driverPhone: string | null;
  capacity: number | null;
  notes: string | null;
  riders: string[];
}

/** Car manifests per leg, driver first, plus who still needs a seat and who
 *  travels on their own — the sheet's Car To / Car Back columns. */
export function buildCarManifests(input: SnapshotInput): {
  leg: Leg;
  cars: SnapshotCar[];
  unplaced: string[];
  onTheirOwn: { name: string; how: string }[];
}[] {
  const byId = new Map(input.people.map((p) => [p.entryId, p]));
  return (['out', 'back'] as Leg[])
    .map((leg) => {
      const set = input.sets.find((s) => s.kind === 'car' && s.leg === leg);
      if (!set) return null;
      const placed = new Set<number>();
      const cars: SnapshotCar[] = set.groups.map((g) => {
        const driver = g.driverEntryId != null ? byId.get(g.driverEntryId) : null;
        const riders = g.memberEntryIds
          .filter((id) => id !== g.driverEntryId)
          .map((id) => byId.get(id)?.name)
          .filter((n): n is string => !!n)
          .sort();
        g.memberEntryIds.forEach((id) => placed.add(id));
        return {
          leg,
          driverName: driver?.name ?? g.name,
          driverPhone: driver?.phone ?? null,
          capacity: g.capacity,
          notes: g.notes,
          riders
        };
      });
      const drives = (p: SnapshotPerson) => (leg === 'out' ? p.drivesOut : p.drivesBack);
      const ride = (p: SnapshotPerson) => (leg === 'out' ? p.rideOut : p.rideBack);
      const live = input.people.filter((p) => p.status === 'yes' && p.participation !== 'contributor');
      const unplaced = live.filter((p) => !drives(p) && ride(p) === 'needs_ride' && !placed.has(p.entryId)).map((p) => p.name).sort();
      const onTheirOwn = live
        .filter((p) => !drives(p) && ride(p) && ride(p) !== 'needs_ride')
        .map((p) => ({ name: p.name, how: RIDE_STATUS_LABEL[ride(p) as RideStatus] }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { leg, cars: cars.sort((a, b) => a.driverName.localeCompare(b.driverName)), unplaced, onTheirOwn };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

/** The other sets (tents, teams, cooking groups) as name lists. */
/** The non-car sets that print as roster COLUMNS ("Patrol", "Tent" …): every
 *  non-car set except the one the roster is already sectioned by (order
 *  'patrol' → the patrol/crew set is the heading, not a column). Returns each
 *  set with a lookup from entry id → group name. */
export function rosterSetColumns(
  input: SnapshotInput,
  order: RosterOrder
): { id: number; label: string; groupNameFor: (entryId: number) => string }[] {
  const grouping = order === 'patrol' ? input.sets.find((s) => s.kind === 'patrol' || s.kind === 'crew') : undefined;
  return input.sets
    .filter((s) => s.kind !== 'car' && s.id !== grouping?.id)
    .map((s) => {
      const nameByEntry = new Map<number, string>();
      for (const g of s.groups) for (const id of g.memberEntryIds) nameByEntry.set(id, g.name);
      // "Patrols" → "Patrol": the column is one person's value.
      const label = s.label.replace(/s$/i, '');
      return { id: s.id, label, groupNameFor: (entryId: number) => nameByEntry.get(entryId) ?? '' };
    });
}

export function buildOtherSets(input: SnapshotInput): { label: string; groups: { name: string; capacity: number | null; members: string[] }[] }[] {
  const byId = new Map(input.people.map((p) => [p.entryId, p]));
  const grouping = input.sets.find((s) => s.kind === 'patrol' || s.kind === 'crew');
  return input.sets
    .filter((s) => s.kind !== 'car' && s.id !== grouping?.id)
    .map((s) => ({
      label: s.label,
      groups: [...s.groups]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => ({
          name: g.name,
          capacity: g.capacity,
          members: g.memberEntryIds.map((id) => byId.get(id)?.name).filter((n): n is string => !!n).sort()
        }))
    }));
}

/** Contact list: adults with phone/email, youth with their guardian phone. */
export function buildContacts(input: SnapshotInput): { name: string; role: string; phone: string | null; email: string | null }[] {
  return input.people
    .filter((p) => p.status === 'yes')
    .map((p) => ({
      name: p.name,
      role: p.isYouth ? `${p.classLabel}${p.grade ? ` · ${p.grade}` : ''}${p.household ? ` · ${p.household}` : ''}` : p.classLabel,
      phone: p.phone,
      email: p.isYouth ? null : p.email
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Money lines for the snapshot: who still owes, income by method, P&L. */
export function buildMoneyLines(input: SnapshotInput): {
  stillOwe: { name: string; balance: number }[];
  incomeLines: string[];
  pl: string[];
} {
  const stillOwe = input.people
    .filter((p) => p.status === 'yes' && p.balance > 0)
    .map((p) => ({ name: p.name, balance: p.balance }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const incomeLines = Object.entries(input.incomeByMethod).map(([m, v]) => `${m}: ${money(v)}`);
  const t = input.totals;
  const pl = [
    `Owed ${money(t.owed)} · paid ${money(t.paid)} · still due ${money(t.due)}`,
    `Income ${money(t.income)} · expenses ${money(t.expenses)}${t.reimbursementsPending > 0 ? ` · reimbursements pending ${money(t.reimbursementsPending)}` : ''}`,
    t.net < 0 ? `Cost to the troop ${money(-t.net)}` : `Net ${money(t.net)}`
  ];
  return { stillOwe, incomeLines, pl };
}

/** Headcount tiles — the sheet's Counts block. */
export function buildCounts(input: SnapshotInput): { label: string; value: number }[] {
  const going = input.people.filter((p) => p.status === 'yes' && p.participation === 'full');
  const byClass = new Map<string, number>();
  for (const p of going) byClass.set(p.classLabel, (byClass.get(p.classLabel) ?? 0) + 1);
  return [
    { label: 'Youth', value: going.filter((p) => p.isYouth).length },
    { label: 'Adults', value: going.filter((p) => !p.isYouth).length },
    ...[...byClass.entries()].sort().map(([label, value]) => ({ label, value })),
    { label: 'Driver-only', value: input.people.filter((p) => p.status === 'yes' && p.participation === 'driver_only').length },
    { label: 'Total', value: going.length }
  ];
}

export { LEG_LABEL };
