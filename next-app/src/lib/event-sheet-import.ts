/**
 * Event sheet import — the campout Google Sheet's per-event tab as pure
 * functions (Plans/Event-Logistics.md §F). Two halves:
 *
 *   parseEventSheet(rows)      tab cells → what the sheet says (people rows,
 *                              payments by column, expenses, reimbursements)
 *   buildImportPlan(parsed, …) what the sheet says + resolved people → the
 *                              exact rows the importer writes, or a warning
 *                              for every cell it refuses to guess about
 *
 * Nothing here touches the database; scripts/import-event-sheet.ts resolves
 * names against `people` and applies the plan. Tests use a sanitized fixture
 * (names / emails / phones replaced), never the real workbook.
 *
 * Sheet conventions mirrored (Pinewoods '25 is the exemplar tab):
 *   - column A is a type code: A adult · S scout · JL junior leader · AOL
 *     Arrow-of-Light (Webelos) guest; anything else is carried as-is and the
 *     database decides (a matched scout is a scout, a matched adult an adult)
 *   - "Car To" / "Car Back" hold a driver's first name (or a prefix of it)
 *   - the two "Seats" columns are the driver's seats INCLUDING the driver
 *     (Patrick, 2026-08-22: "Patrick 4/4") — a number here means "drives"
 *   - payment columns are labelled by method: Ck · $$ · PPal / Venmo · Cans
 *   - summary blocks sit below a blank row: "Expenses" (amount / date /
 *     note), "Income" (derived — ignored), "Reimbursements" (amount / date /
 *     note naming the person), "Credit for Future Campouts"
 */

export type SheetCell = string | number | boolean | null | undefined;
export type SheetRow = readonly SheetCell[];

export type PaymentMethod = 'venmo' | 'check' | 'cash' | 'other';

export interface SheetPerson {
  /** 0-based row index in the tab — the stable handle the plan uses. */
  row: number;
  typeCode: string;
  firstName: string;
  lastName: string;
  carTo: string | null;
  carBack: string | null;
  /** Grouping columns by set label, e.g. { Patrols: 'Kraken' }. */
  groups: Record<string, string>;
  seatsOut: number | null;
  seatsBack: number | null;
  notes: string | null;
  /** One entry per payment column with a positive number in it. */
  payments: { method: PaymentMethod; amount: number; column: string }[];
  email: string | null;
  phone: string | null;
}

export interface SheetMoneyLine {
  amount: number;
  /** ISO date when the sheet had a parseable one. */
  date: string | null;
  note: string | null;
}

export interface ParsedEventSheet {
  title: string | null;
  people: SheetPerson[];
  expenses: SheetMoneyLine[];
  reimbursements: SheetMoneyLine[];
  credits: SheetMoneyLine[];
  /** Grouping set labels present on the tab, in column order. */
  groupSets: { label: string; kind: 'patrol' | 'crew' | 'tent' | 'team' }[];
}

// ── helpers ───────────────────────────────────────────────────────────────

const str = (c: SheetCell): string => (c == null ? '' : String(c)).trim();
const lower = (c: SheetCell): string => str(c).toLowerCase();
const num = (c: SheetCell): number | null => {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = str(c).replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const isBlankRow = (r: SheetRow | undefined): boolean => !r || r.every((c) => str(c) === '');

/** Excel serial (days since 1899-12-30) → YYYY-MM-DD; ISO/US strings pass through. */
export function sheetDateToISO(c: SheetCell): string | null {
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    const ms = Math.round((c - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = str(c);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return null;
}

const PAYMENT_HEADERS: Record<string, PaymentMethod> = {
  ck: 'check',
  check: 'check',
  checks: 'check',
  $$: 'cash',
  cash: 'cash',
  ppal: 'venmo',
  paypal: 'venmo',
  venmo: 'venmo',
  cans: 'other',
  wreath: 'other',
  wreaths: 'other'
};

const GROUP_HEADERS: Record<string, { label: string; kind: 'patrol' | 'crew' | 'tent' | 'team' }> = {
  patrol: { label: 'Patrols', kind: 'patrol' },
  patrols: { label: 'Patrols', kind: 'patrol' },
  crew: { label: 'Crews', kind: 'crew' },
  crews: { label: 'Crews', kind: 'crew' },
  tent: { label: 'Tents', kind: 'tent' },
  tents: { label: 'Tents', kind: 'tent' },
  team: { label: 'Teams', kind: 'team' },
  teams: { label: 'Teams', kind: 'team' }
};

/** Strip a trailing " - Sept 2025"-style suffix from the A1 title. */
export function cleanSheetTitle(raw: string | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  return s.replace(/\s+[-–—]\s+.*$/, '').trim() || s;
}

// ── parse ─────────────────────────────────────────────────────────────────

export function parseEventSheet(rows: readonly SheetRow[]): ParsedEventSheet {
  const headerIdx = rows.findIndex((r) => r.some((c) => lower(c) === 'name'));
  if (headerIdx < 0) throw new Error('No header row: expected a cell reading "NAME"');
  const header = rows[headerIdx];
  const col = (pred: (h: string, i: number) => boolean): number => header.findIndex((c, i) => pred(lower(c), i));

  const nameCol = col((h) => h === 'name');
  const carToCol = col((h) => h === 'car to');
  const carBackCol = col((h) => h === 'car back');
  const notesCol = col((h) => h === 'notes');
  const emailCol = col((h) => h === 'email' || h === 'e-mail');
  const phoneCol = col((h) => h === 'phone');
  // Seats: the first "Out" / "Back" headers to the right of the car columns.
  const after = Math.max(carToCol, carBackCol, nameCol);
  const seatsOutCol = col((h, i) => i > after && h === 'out');
  const seatsBackCol = col((h, i) => i > after && h === 'back');

  const paymentCols: { col: number; method: PaymentMethod; column: string }[] = [];
  const groupCols: { col: number; label: string; kind: 'patrol' | 'crew' | 'tent' | 'team' }[] = [];
  header.forEach((c, i) => {
    const h = lower(c);
    if (h in PAYMENT_HEADERS) paymentCols.push({ col: i, method: PAYMENT_HEADERS[h], column: str(c) });
    if (h in GROUP_HEADERS) groupCols.push({ col: i, ...GROUP_HEADERS[h] });
  });

  const people: SheetPerson[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row)) break;
    const first = str(row[nameCol]);
    const last = str(row[nameCol + 1]);
    if (!first && !last) continue;
    const groups: Record<string, string> = {};
    for (const g of groupCols) {
      const v = str(row[g.col]);
      if (v) groups[g.label] = v.replace(/\s+/g, ' ');
    }
    const payments: SheetPerson['payments'] = [];
    for (const p of paymentCols) {
      const v = num(row[p.col]);
      if (v != null && v > 0) payments.push({ method: p.method, amount: v, column: p.column });
    }
    people.push({
      row: r,
      typeCode: str(row[0]).toUpperCase(),
      firstName: first,
      lastName: last,
      carTo: carToCol >= 0 ? str(row[carToCol]) || null : null,
      carBack: carBackCol >= 0 ? str(row[carBackCol]) || null : null,
      groups,
      seatsOut: seatsOutCol >= 0 ? num(row[seatsOutCol]) : null,
      seatsBack: seatsBackCol >= 0 ? num(row[seatsBackCol]) : null,
      notes: notesCol >= 0 ? str(row[notesCol]) || null : null,
      payments,
      email: emailCol >= 0 ? str(row[emailCol]).replace(/[<>]/g, '') || null : null,
      phone: phoneCol >= 0 ? str(row[phoneCol]) || null : null
    });
  }

  const block = (heading: RegExp): SheetMoneyLine[] => {
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].findIndex((cell) => heading.test(lower(cell)));
      if (c < 0) continue;
      const out: SheetMoneyLine[] = [];
      for (let k = r + 1; k < rows.length; k++) {
        const amount = num(rows[k][c]);
        if (amount == null) break; // the block ends at the first blank amount cell
        const date = sheetDateToISO(rows[k][c + 1]);
        const note = str(rows[k][c + 2]) || null;
        if (date == null && note == null) break; // a bare total row, not a line
        out.push({ amount, date, note });
      }
      return out;
    }
    return [];
  };

  return {
    title: cleanSheetTitle(str(rows[0]?.[0]) || null),
    people,
    expenses: block(/^expenses?$/),
    reimbursements: block(/^reimbursements?$/),
    credits: block(/^credit/),
    groupSets: groupCols.map(({ label, kind }) => ({ label, kind }))
  };
}

// ── plan ──────────────────────────────────────────────────────────────────

/** What the importer learned about one sheet row from the database. */
export interface ResolvedPerson {
  row: number;
  personId: number;
  displayName: string;
  isScout: boolean;
  householdId: number | null;
}

export interface PlanEntry {
  row: number;
  personId: number;
  displayName: string;
  personKind: 'scout' | 'adult';
  participantClass: 'junior_leader' | null;
  householdId: number | null;
  drivesOut: boolean;
  drivesBack: boolean;
  vehicleSeatsOut: number | null;
  vehicleSeatsBack: number | null;
  rideOut: 'needs_ride' | null;
  rideBack: 'needs_ride' | null;
  notes: string | null;
}

export interface PlanPlacement {
  row: number;
  setLabel: string;
  /** Car sets: the driver's row; named sets: the group name. */
  driverRow?: number;
  groupName?: string;
}

export interface PlanPayment {
  row: number;
  personId: number;
  amount: number;
  method: PaymentMethod;
  memo: string | null;
}

export interface PlanExpense {
  amount: number; // positive; stored negative
  memo: string;
  occurredOn: string;
}

export interface PlanReimbursement {
  requesterRow: number;
  requesterPersonId: number;
  amount: number;
  description: string;
}

export interface ImportPlan {
  /** The common fee — the mode of per-person totals; null when no one paid. */
  price: number | null;
  entries: PlanEntry[];
  placements: PlanPlacement[];
  payments: PlanPayment[];
  expenses: PlanExpense[];
  reimbursements: PlanReimbursement[];
  /** Sheet rows the importer will NOT write, each with the reason. */
  warnings: string[];
}

const JUNIOR_LEADER_CODES = new Set(['JL']);

function fullName(p: SheetPerson): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/** "Pat" → the one driver whose first name starts with it (or last name equals it). */
function resolveDriver(token: string, drivers: readonly SheetPerson[]): SheetPerson | 'ambiguous' | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const exact = drivers.filter((d) => d.firstName.toLowerCase() === t || d.lastName.toLowerCase() === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return 'ambiguous';
  const prefix = drivers.filter((d) => d.firstName.toLowerCase().startsWith(t));
  if (prefix.length === 1) return prefix[0];
  return prefix.length > 1 ? 'ambiguous' : null;
}

/** The sheet person a free-text note names ("Due to Patrick less fees"). */
function personNamedIn(note: string | null, candidates: readonly SheetPerson[]): SheetPerson | 'ambiguous' | null {
  if (!note) return null;
  const words = new Set(note.toLowerCase().split(/[^a-z']+/).filter(Boolean));
  const hits = candidates.filter((c) => words.has(c.firstName.toLowerCase()) || words.has(c.lastName.toLowerCase()));
  if (hits.length === 1) return hits[0];
  return hits.length > 1 ? 'ambiguous' : null;
}

function mode(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

export interface PlanOptions {
  /** YYYY-MM-DD — the calendar entry's date; expense rows are dated here. */
  eventDate: string;
}

export function buildImportPlan(
  parsed: ParsedEventSheet,
  resolved: readonly ResolvedPerson[],
  opts: PlanOptions
): ImportPlan {
  const warnings: string[] = [];
  const byRow = new Map(resolved.map((r) => [r.row, r]));
  const entries: PlanEntry[] = [];
  const payments: PlanPayment[] = [];
  const placements: PlanPlacement[] = [];

  const matched = parsed.people.filter((p) => byRow.has(p.row));
  for (const p of parsed.people) {
    if (!byRow.has(p.row)) warnings.push(`row ${p.row + 1}: "${fullName(p)}" not found in people — skipped`);
  }

  for (const p of matched) {
    const r = byRow.get(p.row) as ResolvedPerson;
    const drivesOut = p.seatsOut != null && p.seatsOut >= 1;
    const drivesBack = p.seatsBack != null && p.seatsBack >= 1;
    entries.push({
      row: p.row,
      personId: r.personId,
      displayName: r.displayName,
      personKind: r.isScout ? 'scout' : 'adult',
      participantClass: r.isScout && JUNIOR_LEADER_CODES.has(p.typeCode) ? 'junior_leader' : null,
      householdId: r.householdId,
      drivesOut,
      drivesBack,
      vehicleSeatsOut: drivesOut ? Math.trunc(p.seatsOut as number) : null,
      vehicleSeatsBack: drivesBack ? Math.trunc(p.seatsBack as number) : null,
      rideOut: drivesOut ? null : 'needs_ride',
      rideBack: drivesBack ? null : 'needs_ride',
      notes: p.notes
    });
    for (const pay of p.payments) {
      payments.push({ row: p.row, personId: r.personId, amount: pay.amount, method: pay.method, memo: p.notes });
    }
  }

  // Cars: "Car To" / "Car Back" name a driver; the rider is placed in that
  // driver's system-owned car for that leg.
  const driversOut = matched.filter((p) => p.seatsOut != null && p.seatsOut >= 1);
  const driversBack = matched.filter((p) => p.seatsBack != null && p.seatsBack >= 1);
  for (const p of matched) {
    for (const [token, leg, drivers] of [
      [p.carTo, 'Cars there', driversOut],
      [p.carBack, 'Cars back', driversBack]
    ] as const) {
      if (!token) continue;
      const d = resolveDriver(token, drivers);
      if (d === 'ambiguous') warnings.push(`row ${p.row + 1}: ${leg} "${token}" matches more than one driver — not placed`);
      else if (!d) warnings.push(`row ${p.row + 1}: ${leg} "${token}" is not a driver on this sheet — not placed`);
      else if (d.row !== p.row) placements.push({ row: p.row, setLabel: leg, driverRow: d.row });
    }
    for (const [label, name] of Object.entries(p.groups)) {
      placements.push({ row: p.row, setLabel: label, groupName: name });
    }
  }

  // Money. Expenses are troop-paid rows; a negative "expense" is the sheet
  // netting something (fees against a reimbursement) — refused, reported.
  const expenses: PlanExpense[] = [];
  for (const e of parsed.expenses) {
    if (e.amount <= 0) {
      warnings.push(`expense ${e.amount} "${e.note ?? ''}" is not positive — skipped (sheet netting, enter by hand if real)`);
      continue;
    }
    expenses.push({ amount: e.amount, memo: e.note ?? 'Expense', occurredOn: e.date ?? opts.eventDate });
  }
  const adults = matched.filter((p) => !(byRow.get(p.row) as ResolvedPerson).isScout);
  const reimbursements: PlanReimbursement[] = [];
  for (const r of parsed.reimbursements) {
    if (r.amount <= 0) {
      warnings.push(`reimbursement ${r.amount} "${r.note ?? ''}" is not positive — skipped`);
      continue;
    }
    const who = personNamedIn(r.note, adults);
    if (who === 'ambiguous' || who == null) {
      warnings.push(`reimbursement ${r.amount} "${r.note ?? ''}": ${who ? 'names more than one adult' : 'names no adult on this sheet'} — skipped`);
      continue;
    }
    reimbursements.push({
      requesterRow: who.row,
      requesterPersonId: (byRow.get(who.row) as ResolvedPerson).personId,
      amount: r.amount,
      description: r.note ?? 'Reimbursement'
    });
  }
  for (const c of parsed.credits) warnings.push(`credit ${c.amount} "${c.note ?? ''}" — credits are not imported (enter as a scout-account adjustment)`);

  const totals = matched.map((p) => p.payments.reduce((n, x) => n + x.amount, 0)).filter((n) => n > 0);
  return { price: mode(totals), entries, placements, payments, expenses, reimbursements, warnings };
}
