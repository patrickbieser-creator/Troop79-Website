/**
 * Bank Match — the bank's own transaction list against the ledger
 * (Plans/Ledger-Audit.md). Patrick, 2026-09-29: "I am more suspicious of my
 * ledger than I am of the bank" — so the bank export is treated as the truth
 * and every function here asks where the ledger departs from it.
 *
 * Pure functions, no I/O: the uploaded CSV is parsed in a Server Action and
 * never stored. Cents arithmetic throughout, same reason as
 * lib/finance.ts computeBalance.
 */

export class BankCsvError extends Error {}

export interface BankRow {
  /** Posting date, YYYY-MM-DD. */
  date: string;
  /** Signed as the bank signs it: + deposit, − withdrawal. */
  amount: number;
  /** The bank's running balance after this row, when the export carries it. */
  balance: number | null;
  description: string;
  checkNumber: string | null;
  memo: string | null;
}

export interface ParsedStatement {
  /** Posted rows only, oldest first. */
  rows: BankRow[];
  pendingCount: number;
  firstDate: string;
  lastDate: string;
  /** Balance before the oldest row (its balance minus its amount). */
  openingBalance: number | null;
  closingBalance: number | null;
  /** opening + every amount === closing. False means rows are missing from
   *  the export, and every comparison below should be read with suspicion. */
  chainConsistent: boolean;
}

const cents = (n: number) => Math.round(n * 100);

/** RFC-4180-ish line splitter: quoted fields may hold commas and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** M/D/YYYY → YYYY-MM-DD, or null. */
function usDate(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const REQUIRED = ['Posting Date', 'Posting Status', 'Amount', 'Description', 'Balance'] as const;

/** Parse a Landmark Credit Union "Exported Transactions" CSV. Throws
 *  BankCsvError when the file isn't that export — a wrong file is an error
 *  to show, never a list of findings. */
export function parseLandmarkCsv(text: string): ParsedStatement {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new BankCsvError('The file is empty.');
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const missing = REQUIRED.filter((name) => col(name) === -1);
  if (missing.length) {
    throw new BankCsvError(`This doesn't look like a Landmark transaction export — missing column(s): ${missing.join(', ')}.`);
  }
  const iDate = col('Posting Date');
  const iStatus = col('Posting Status');
  const iAmount = col('Amount');
  const iDesc = col('Description');
  const iBal = col('Balance');
  const iCheck = col('Check Number');
  const iMemo = col('Memo');

  const newestFirst: BankRow[] = [];
  let pendingCount = 0;
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    if ((f[iStatus] ?? '').trim() !== 'Posted') {
      pendingCount++;
      continue;
    }
    const date = usDate(f[iDate] ?? '');
    const rawAmount = (f[iAmount] ?? '').trim();
    // Number('') is 0 — a blank cell must be an error, not a $0.00 row.
    const amount = rawAmount === '' ? NaN : Number(rawAmount);
    if (!date || !Number.isFinite(amount)) {
      throw new BankCsvError(`Couldn't read a row's date or amount: ${line.slice(0, 80)}`);
    }
    const bal = (f[iBal] ?? '').trim();
    newestFirst.push({
      date,
      amount: cents(amount) / 100,
      balance: bal === '' || !Number.isFinite(Number(bal)) ? null : cents(Number(bal)) / 100,
      description: (f[iDesc] ?? '').trim(),
      checkNumber: iCheck >= 0 && (f[iCheck] ?? '').trim() ? f[iCheck].trim() : null,
      memo: iMemo >= 0 && (f[iMemo] ?? '').trim() ? f[iMemo].trim() : null
    });
  }
  if (newestFirst.length === 0) throw new BankCsvError('The file has no posted transactions.');

  // Stable: rows sharing a date keep their relative (reversed) order.
  const rows = newestFirst.slice().reverse();
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const oldest = newestFirst[newestFirst.length - 1];
  const newest = newestFirst[0];
  const openingBalance = oldest.balance == null ? null : (cents(oldest.balance) - cents(oldest.amount)) / 100;
  const closingBalance = newest.balance;
  const chainConsistent =
    openingBalance != null &&
    closingBalance != null &&
    cents(openingBalance) + rows.reduce((n, r) => n + cents(r.amount), 0) === cents(closingBalance);

  return {
    rows,
    pendingCount,
    firstDate: rows[0].date,
    lastDate: rows[rows.length - 1].date,
    openingBalance,
    closingBalance,
    chainConsistent
  };
}

/** A live (non-voided) ledger row on the account being matched. */
export interface LedgerCashRow {
  id: number;
  occurred_on: string;
  amount: number;
  memo: string | null;
  kind: string;
  method: string | null;
}

export interface MatchedPair {
  bank: BankRow;
  ledger: LedgerCashRow;
  /** bank date − ledger date, in days. */
  lagDays: number;
}

export type NearMissReason = 'transposed' | 'sign' | 'cents';

export interface NearMiss {
  bank: BankRow;
  ledger: LedgerCashRow;
  reason: NearMissReason;
}

/** Several rows on one side that add up exactly to one row on the other —
 *  a Venmo cash-out or mobile deposit batching individual payments, or one
 *  ledger entry for a charge the bank split. */
export interface GroupedMatch {
  bank: BankRow[];
  ledger: LedgerCashRow[];
}

export interface MatchResult {
  matched: MatchedPair[];
  grouped: GroupedMatch[];
  /** In the bank, not in the ledger — money that moved and was never recorded. */
  bankOnly: BankRow[];
  /** In the ledger, not in the bank — recorded money that never moved. */
  ledgerOnly: LedgerCashRow[];
  /** An unmatched bank row and an unmatched ledger row that are probably the
   *  same transaction entered wrong. Both still appear in their only-lists. */
  nearMisses: NearMiss[];
}

function dayNumber(iso: string): number {
  return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

/** How far apart the two dates may be. Card and ACH rows post within days;
 *  a check posts when it's cashed, which can be weeks after it was written. */
function fits(b: BankRow, l: LedgerCashRow): boolean {
  const lag = daysBetween(l.occurred_on, b.date);
  const late = b.checkNumber ? 60 : 10;
  return lag >= -7 && lag <= late;
}

/** Most candidates a group search considers (nearest by date). Keeps the
 *  subset search small; a real batch is a handful of payments. */
const GROUP_CANDIDATES = 20;

/**
 * Smallest subset of `amounts` (at least two) summing exactly to `target`,
 * as indexes, or null. Breadth-first over subset size so the first hit is
 * the fewest rows — the likeliest reading of a batch.
 */
function exactSubset(amounts: readonly number[], target: number): number[] | null {
  const t = cents(target);
  const c = amounts.map(cents);
  // reachable[sum] = one subset (indexes, increasing) reaching it, per size level
  // First index per value — equal amounts (a row of $30 payments) must not
  // collapse into one entry, or no pair of them can ever be reached.
  let level = new Map<number, number[]>();
  c.forEach((v, i) => {
    if (!level.has(v)) level.set(v, [i]);
  });
  for (let size = 2; size <= c.length; size++) {
    const next = new Map<number, number[]>();
    for (const [sum, idxs] of level) {
      for (let i = idxs[idxs.length - 1] + 1; i < c.length; i++) {
        const s = sum + c[i];
        if (s === t) return [...idxs, i];
        if (!next.has(s)) next.set(s, [...idxs, i]);
      }
    }
    if (next.size === 0 || next.size > 200_000) return null;
    level = next;
  }
  return null;
}

function findGroups(
  bankOnly: BankRow[],
  ledgerOnly: LedgerCashRow[]
): { grouped: GroupedMatch[]; bankOnly: BankRow[]; ledgerOnly: LedgerCashRow[] } {
  const grouped: GroupedMatch[] = [];
  const usedB = new Set<BankRow>();
  const usedL = new Set<LedgerCashRow>();

  // Many ledger rows → one bank row (a batched deposit).
  for (const b of bankOnly) {
    const cands = ledgerOnly
      .filter((l) => !usedL.has(l) && Math.sign(l.amount) === Math.sign(b.amount) && fits(b, l))
      .sort((x, y) => Math.abs(daysBetween(x.occurred_on, b.date)) - Math.abs(daysBetween(y.occurred_on, b.date)) || x.id - y.id)
      .slice(0, GROUP_CANDIDATES);
    const hit = exactSubset(cands.map((l) => l.amount), b.amount);
    if (!hit) continue;
    const ledger = hit.map((i) => cands[i]).sort((x, y) => x.id - y.id);
    ledger.forEach((l) => usedL.add(l));
    usedB.add(b);
    grouped.push({ bank: [b], ledger });
  }

  // Many bank rows → one ledger row (a charge the bank split).
  for (const l of ledgerOnly) {
    if (usedL.has(l)) continue;
    const cands = bankOnly
      .filter((b) => !usedB.has(b) && Math.sign(b.amount) === Math.sign(l.amount) && fits(b, l))
      .sort((x, y) => Math.abs(daysBetween(l.occurred_on, x.date)) - Math.abs(daysBetween(l.occurred_on, y.date)))
      .slice(0, GROUP_CANDIDATES);
    const hit = exactSubset(cands.map((b) => b.amount), l.amount);
    if (!hit) continue;
    const bank = hit.map((i) => cands[i]).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    bank.forEach((b) => usedB.add(b));
    usedL.add(l);
    grouped.push({ bank, ledger: [l] });
  }

  grouped.sort((x, y) => (x.bank[0].date < y.bank[0].date ? -1 : x.bank[0].date > y.bank[0].date ? 1 : 0));
  return {
    grouped,
    bankOnly: bankOnly.filter((b) => !usedB.has(b)),
    ledgerOnly: ledgerOnly.filter((l) => !usedL.has(l))
  };
}

function isTransposition(a: number, b: number): boolean {
  const x = String(Math.abs(cents(a)));
  const y = String(Math.abs(cents(b)));
  if (x === y || x.length !== y.length || Math.sign(a) !== Math.sign(b)) return false;
  return [...x].sort().join('') === [...y].sort().join('');
}

function nearMissReason(b: BankRow, l: LedgerCashRow): NearMissReason | null {
  if (cents(b.amount) === -cents(l.amount)) return 'sign';
  if (isTransposition(b.amount, l.amount)) return 'transposed';
  const d = Math.abs(cents(b.amount) - cents(l.amount));
  if (Math.sign(b.amount) === Math.sign(l.amount) && d > 0 && d < 100) return 'cents';
  return null;
}

/**
 * One-to-one match of bank rows to ledger rows: exact cents, dates within
 * the window, nearest date first (ties: earliest ledger id). Greedy over
 * every candidate pair sorted by distance, which is optimal enough here —
 * the only ambiguity is several same-amount rows, and nearest-first is
 * exactly how a person would pair them by hand.
 */
export function matchStatement(bankRows: readonly BankRow[], ledgerRows: readonly LedgerCashRow[]): MatchResult {
  const pairs: { bi: number; li: number; dist: number }[] = [];
  ledgerRows.forEach((l, li) => {
    bankRows.forEach((b, bi) => {
      if (cents(b.amount) === cents(l.amount) && fits(b, l)) {
        pairs.push({ bi, li, dist: Math.abs(daysBetween(l.occurred_on, b.date)) });
      }
    });
  });
  pairs.sort((p, q) => p.dist - q.dist || ledgerRows[p.li].id - ledgerRows[q.li].id || p.bi - q.bi);

  const usedB = new Set<number>();
  const usedL = new Set<number>();
  const matched: MatchedPair[] = [];
  for (const p of pairs) {
    if (usedB.has(p.bi) || usedL.has(p.li)) continue;
    usedB.add(p.bi);
    usedL.add(p.li);
    const b = bankRows[p.bi];
    const l = ledgerRows[p.li];
    matched.push({ bank: b, ledger: l, lagDays: daysBetween(l.occurred_on, b.date) });
  }
  matched.sort((a, b) => (a.bank.date < b.bank.date ? -1 : a.bank.date > b.bank.date ? 1 : 0));

  const { grouped, bankOnly, ledgerOnly } = findGroups(
    bankRows.filter((_, i) => !usedB.has(i)),
    ledgerRows.filter((_, i) => !usedL.has(i))
  );

  const nearMisses: NearMiss[] = [];
  const claimedL = new Set<number>();
  for (const b of bankOnly) {
    for (const l of ledgerOnly) {
      if (claimedL.has(l.id) || !fits(b, l)) continue;
      const reason = nearMissReason(b, l);
      if (reason) {
        nearMisses.push({ bank: b, ledger: l, reason });
        claimedL.add(l.id);
        break;
      }
    }
  }

  return { matched, grouped, bankOnly, ledgerOnly, nearMisses };
}

export interface DriftPoint {
  date: string;
  bankBalance: number;
  ledgerBalance: number;
  /** ledger − bank. Negative: the ledger shows less money than the bank has. */
  diff: number;
}

/**
 * Ledger balance vs the bank's end-of-day balance on every date the bank
 * posted something. `ledgerOpening` is the ledger's balance through the day
 * before the statement's first date. Bank balances are rebuilt from the
 * statement's opening balance plus its amounts — within-day row order in an
 * export isn't reliable, the day's total is.
 */
export function dailyDrift(
  statement: ParsedStatement,
  ledgerRows: readonly LedgerCashRow[],
  ledgerOpening: number
): DriftPoint[] {
  const bankByDay = new Map<string, number>();
  for (const r of statement.rows) bankByDay.set(r.date, (bankByDay.get(r.date) ?? 0) + cents(r.amount));
  const ledgerSorted = ledgerRows
    .filter((l) => l.occurred_on >= statement.firstDate)
    .slice()
    .sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0));

  let bank = cents(statement.openingBalance ?? 0);
  let ledger = cents(ledgerOpening);
  let li = 0;
  const out: DriftPoint[] = [];
  for (const date of [...bankByDay.keys()].sort()) {
    bank += bankByDay.get(date)!;
    while (li < ledgerSorted.length && ledgerSorted[li].occurred_on <= date) ledger += cents(ledgerSorted[li++].amount);
    out.push({ date, bankBalance: bank / 100, ledgerBalance: ledger / 100, diff: (ledger - bank) / 100 });
  }
  return out;
}

export interface DriftShift {
  from: number;
  to: number;
  /** The last bank date the ledger was still off by `from`… */
  lastSeenAtFrom: string;
  /** …and the first date it was off by `to`. The entry that caused the shift
   *  lies between these two dates (or just before, allowing for posting lag). */
  firstSeenAtTo: string;
}

/**
 * The gaps that LAST. Most day-to-day differences are timing — the ledger
 * records a payment on Tuesday, the bank posts it Thursday — and close on
 * their own. A level that holds for `settleDays` or more (or is where the
 * series ends) is a real difference; this reports every change between
 * consecutive real levels.
 */
export function persistentShifts(points: readonly DriftPoint[], settleDays = 14): DriftShift[] {
  if (points.length === 0) return [];
  // Runs of equal diff.
  const runs: { value: number; start: number }[] = [];
  points.forEach((p, i) => {
    if (runs.length === 0 || cents(runs[runs.length - 1].value) !== cents(p.diff)) runs.push({ value: p.diff, start: i });
  });
  const persistent = runs.filter((run, k) => {
    if (k === 0 || k === runs.length - 1) return true;
    return daysBetween(points[run.start].date, points[runs[k + 1].start].date) >= settleDays;
  });

  const shifts: DriftShift[] = [];
  for (let k = 1; k < persistent.length; k++) {
    const prev = persistent[k - 1];
    const cur = persistent[k];
    if (cents(prev.value) === cents(cur.value)) continue;
    let lastSeen = prev.start;
    for (let i = prev.start; i < cur.start; i++) if (cents(points[i].diff) === cents(prev.value)) lastSeen = i;
    shifts.push({ from: prev.value, to: cur.value, lastSeenAtFrom: points[lastSeen].date, firstSeenAtTo: points[cur.start].date });
  }
  return shifts;
}

export interface ShiftWithCandidates extends DriftShift {
  /** Unmatched rows dated where the shift opened — the likeliest causes. */
  candidates: { bank: BankRow[]; ledger: LedgerCashRow[] };
}

export interface BankMatchReport {
  statement: Omit<ParsedStatement, 'rows'> & { rowCount: number };
  /** Ledger − bank before the statement's first row. Nonzero: the gap is
   *  older than anything this export can explain. */
  openingDiff: number;
  /** Ledger − bank at the statement's last posted date. */
  closingDiff: number;
  match: MatchResult;
  shifts: ShiftWithCandidates[];
  bankOnlyTotal: number;
  ledgerOnlyTotal: number;
}

/** Share of bank rows that must match before the file is trusted to be the
 *  account it was uploaded as. */
const MIN_MATCH_SHARE = 0.2;

/**
 * The whole comparison for one account: `ledgerRows` are every live ledger
 * row on the account (any date). Rows before the statement set the opening
 * balance; rows inside its date range are matched; later rows are ignored
 * (the bank can't have seen them yet).
 */
export function buildBankMatchReport(statement: ParsedStatement, ledgerRows: readonly LedgerCashRow[]): BankMatchReport {
  const before = ledgerRows.filter((l) => l.occurred_on < statement.firstDate);
  const inRange = ledgerRows.filter((l) => l.occurred_on >= statement.firstDate && l.occurred_on <= statement.lastDate);
  const ledgerOpening = before.reduce((n, l) => n + cents(l.amount), 0) / 100;

  const match = matchStatement(statement.rows, inRange);
  const bankMatched = match.matched.length + match.grouped.reduce((n, g) => n + g.bank.length, 0);
  if (statement.rows.length >= 5 && bankMatched / statement.rows.length < MIN_MATCH_SHARE) {
    throw new BankCsvError(
      `Only ${bankMatched} of ${statement.rows.length} bank rows match this account's ledger — is this the right account's export?`
    );
  }

  const points = dailyDrift(statement, inRange, ledgerOpening);
  const shifts = persistentShifts(points).map((s) => {
    const inWindow = (date: string) => daysBetween(s.lastSeenAtFrom, date) >= -10 && date <= s.firstSeenAtTo;
    return {
      ...s,
      candidates: {
        bank: match.bankOnly.filter((b) => inWindow(b.date)),
        ledger: match.ledgerOnly.filter((l) => inWindow(l.occurred_on))
      }
    };
  });

  const { rows, ...rest } = statement;
  return {
    statement: { ...rest, rowCount: rows.length },
    openingDiff: (cents(ledgerOpening) - cents(statement.openingBalance ?? 0)) / 100,
    closingDiff: points.length ? points[points.length - 1].diff : 0,
    match,
    shifts,
    bankOnlyTotal: match.bankOnly.reduce((n, b) => n + cents(b.amount), 0) / 100,
    ledgerOnlyTotal: match.ledgerOnly.reduce((n, l) => n + cents(l.amount), 0) / 100
  };
}
