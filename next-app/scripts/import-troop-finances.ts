/**
 * One-shot importer: converts the treasurer's `Troop Accounts.xlsx` (CashFlow
 * + Scout Accounts sheets) into financial_transactions rows
 * (Plans/Troop-Finances.md Phase 1).
 *
 * Run:
 *   npm run import-troop-finances -- --xlsx="d:/path/Troop Accounts.xlsx" --people-csv="d:/path/people.csv"
 *     (dry run — validates, reports, writes nothing)
 *   npm run import-troop-finances -- --xlsx="..." --people-csv="..." --commit --sql-out="d:/path/reimport.sql"
 *     (writes a DELETE + INSERT .sql file — apply it yourself against the
 *     real database; this script never connects to Supabase at all)
 *
 * REWRITTEN 2026-08-20 to drop the supabase-js dependency entirely. The
 * original version read `people` and wrote `financial_transactions` both via
 * supabase-js against whatever NEXT_PUBLIC_SUPABASE_URL/SERVICE_ROLE_KEY
 * .env.local pointed at — which is the LOCAL dev database, not production
 * (see project memory: "local Docker = dev snapshot"). Person IDs resolved
 * against local dev would not match production at all. `--people-csv` takes
 * a plain `id,display_name` export (one query, read-only, run directly
 * against production via psql) instead, and `--sql-out` writes the mutation
 * as a file for a human (or an agent with an already-open DB connection) to
 * apply — nobody needs the production service role key for this at all.
 *
 * Same shape as scripts/import-spreadsheet.ts (the advancement-ledger
 * importer): dry-run by default, explicit dictionaries for the messy
 * free-text columns, a written report of anything that needed a judgment
 * call rather than a silent guess.
 *
 * THREE PASSES, per Plans/Troop-Finances.md (now with resolve() unconditional
 * rather than commit-only, so a dry run validates the exact numbers a commit
 * would write — the two paths were previously computing different things):
 *   1. normalize()  — raw sheet row -> typed NormalizedRow (no DB access)
 *   2. resolve()     — name -> person_id, memo formula, scholarship-fund
 *                       reclassification, against the --people-csv snapshot
 *   3. validate()    — self-verification against the sheet's own
 *                       running-balance columns AND the target balances
 *                       below (Patrick, 2026-08-20)
 * The .sql file is written only after resolve() has run cleanly for every
 * scout_account row — see main().
 *
 * Idempotent: the generated SQL first deletes any existing
 * financial_transactions rows tagged IMPORT_BATCH, so re-running (after
 * tuning a mapping dictionary) replaces cleanly rather than duplicating.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';
import { ACCOUNTS, type Account, type TransactionKind, type TransactionMethod } from '../src/lib/finance';

const IMPORT_BATCH = 'cashflow-2026';

/**
 * What the final balances should be once everything imports correctly
 * (Patrick, 2026-08-20 — "assuming that my spreadsheet is accurate"). Only
 * checking/savings/scholarship were given; sofi has no target here. Compared
 * against the IMPORT ALONE, not the app's current displayed balance — three
 * small `source='app'` rows (two rounding adjustments, one voided) exist
 * outside this import batch and are reported separately, since it's not
 * obvious without asking whether they're already folded into these targets.
 */
const BALANCE_TARGETS: Partial<Record<Account, number>> = {
  checking: 2288.11,
  savings: 3079.39,
  scholarship: 760.77
};

// ── Args ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const COMMIT = args.commit === true;
const XLSX_PATH = args.xlsx as string | undefined;
const PEOPLE_CSV_PATH = args['people-csv'] as string | undefined;
if (!XLSX_PATH || !PEOPLE_CSV_PATH) {
  console.error(
    'Usage: import-troop-finances --xlsx="<path>" --people-csv="<path>" [--commit --sql-out="<path>"]'
  );
  process.exit(1);
}
const REPORTS_DIR = (args['reports-dir'] as string | undefined) ?? join(dirname(XLSX_PATH), 'import-reports');
const SQL_OUT_PATH = (args['sql-out'] as string | undefined) ?? join(REPORTS_DIR, 'troop-finances-reimport.sql');

// ── Mapping dictionaries (Category/Method/Code -> our vocabulary) ──────────
// Every value below was read off the real spreadsheet's own distinct-value
// counts, not guessed. See Plans/Troop-Finances.md "Import / backfill" for
// the full accounting of what each maps to and why.

const CATEGORY_MAP: Record<string, TransactionKind | 'REVIEW_INCOME'> = {
  'Event Fee': 'event_fee',
  'Can Drive': 'fundraiser',
  Donation: 'donation',
  Transfer: 'transfer',
  Expense: 'expense',
  'Reservation Fee': 'expense',
  // 46 historical rows. Category alone doesn't say whether this was a
  // fundraiser deposit, bank interest, or something else — classified below
  // by scanning the row's own Event/Who text, and anything that still can't
  // be classified is flagged in the report for a human pass rather than
  // silently defaulted to 'income'.
  Income: 'REVIEW_INCOME'
};

interface ClassifyResult {
  kind: TransactionKind;
  /** false = a best-effort guess, ALWAYS flagged for manual review — never
   *  trusted silently, no matter how plausible the keyword match looks.
   *  Kind carries no direction of its own (2026-08-20) — a wrong guess here
   *  affects only the category tag, never the balance, which is why 229
   *  such flags on 646 rows is tolerable rather than alarming. */
  confident: boolean;
}

/**
 * Classifies a row that has no usable Category value — either the sheet's
 * Category cell was truly empty (424 of 647 rows; discovered only once the
 * import was actually run against the real file, not assumed from the
 * distinct-value counts) or it was the catch-all 'Income' label. Handles
 * BOTH cases with one function since, in practice, the same keyword
 * patterns show up in each.
 */
function classifyUnlabeledRow(eventText: string, whoText: string, notesText: string, amount: number): ClassifyResult {
  const s = `${eventText} ${whoText} ${notesText}`.toLowerCase();

  // High confidence: large, unambiguous, repeated patterns.
  if (s.includes('can drive')) return { kind: 'fundraiser', confident: true };
  if (s.includes('wreath')) return { kind: 'fundraiser', confident: true };
  if (s.includes('dividend') || s.includes('interest') || s.includes('intrest')) {
    return { kind: 'interest', confident: true };
  }
  if (s.includes('error correction') || s.includes('accounting adjustment')) {
    return { kind: 'adjustment', confident: true };
  }
  if (s.includes('close sofi account') || s.includes('sofi trans') || s.includes('transfer between banks')) {
    return { kind: 'transfer', confident: true };
  }

  // Best-effort only — flagged for review regardless of match.
  if (
    s.includes('brat fry') ||
    s.includes('pinewood derby') ||
    s.includes('pancake breakfast') ||
    s.includes('scrap metal') ||
    s.includes('fundraising') ||
    s.includes('concession')
  ) {
    return { kind: 'fundraiser', confident: false };
  }
  if (s.includes('xfer') || s.includes('transfer') || s.includes('cashout')) {
    return { kind: 'transfer', confident: false };
  }
  // Last resort: sign-based guess. `amount` is already signed (credit - debit).
  return { kind: amount < 0 ? 'expense' : 'income', confident: false };
}

const METHOD_MAP: Record<string, TransactionMethod | null> = {
  'Checking Account LCU': 'bank',
  'Savings Account LCU': 'bank',
  Venmo: 'venmo',
  'Venmo - PB': 'venmo',
  'Venmo from Landmark': 'venmo',
  'Venmo From Landmark': 'venmo',
  'Venmo from Patrick': 'venmo',
  'ACH from Landmark': 'bank',
  'ACH to Landmark': 'bank',
  'ACH to Landmark from UWCU': 'bank',
  Check: 'check',
  'Check LCU': 'check',
  'Check from Landmark': 'check',
  'Paypal - PB': 'other',
  Paypal: 'other',
  'Scout Account': 'scout_account',
  'Scout Accout': 'scout_account', // spreadsheet typo
  Cash: 'cash',
  'Cash to Patrick': 'cash',
  'Cash - PB': 'cash',
  'Sofi Transfer to BLC': 'bank',
  'Tranfer to Sofi': 'bank', // spreadsheet typo
  'Transfer from Sofi': 'bank',
  'Bank Transfer': 'bank',
  Square: 'other',
  'Jason T79 Debit Card': 'other',
  // Not really payment methods — the Category already carries the meaning;
  // leaving method null here is correct, not a gap.
  Donation: null,
  'Sofi Interest': null,
  'Accounting Adjustment': null
};

const CODE_TO_ACCOUNT: Record<string, Account> = {
  BLC: 'checking',
  BLS: 'savings',
  SA: 'scout_account',
  SoFi: 'sofi',
  Sofi: 'sofi'
  // bare "BL" is NOT here on purpose — resolved per-row in resolve() by
  // checking which running-balance column actually moved.
};

/** Known person-name typos/variants in this spreadsheet -> canonical name
 *  to match against people.display_name. Same idea as import-spreadsheet.ts's
 *  NAME_TYPO_FIX, confirmed against the actual "Scout Accounts" sheet rows. */
const NAME_ALIAS: Record<string, string> = {
  'Anjlai Sankpal-Tatera': 'Anjali Sankpal-Tatera',
  // Nickname, not a typo — confirmed against people.display_name (id 28).
  'Ronnie Kleinfeldt': 'Veronica Kleinfeldt'
};

/**
 * Row-number overrides. Take precedence over CODE_TO_ACCOUNT (not just a
 * fallback for a missing/bare code) — these are corrections to a code the
 * sheet got WRONG, confirmed by hand, not gaps the script couldn't resolve.
 *
 *  - 258: bare "BL" code, the only occurrence in the sheet.
 *    inferAccountFromMovedColumn() can't resolve it — the sheet's own BLC
 *    balance is identical between row 258 and its same-date neighbor (row
 *    259), a spreadsheet data-entry gap, not an account ambiguity. Content
 *    is unambiguous: "Samoset Council - Reservation" paid via "Jason T79
 *    Debit Card" is plainly a checking-account charge.
 *
 * Row 568 ("Transfer In From Patrick as Debbie Takes over Treasurer", coded
 * BLS +$974.78) was investigated and is CORRECTLY coded — confirmed by
 * Patrick: a real initial funding of the savings account at the treasurer
 * handoff, not a miscoded checking wash. The resulting ~$974.78
 * checking-side drift from here forward is known, expected, and
 * deliberately NOT chased further — Patrick: "we will reconcile the whole
 * thing when we're done" (the Phase 2 monthly reconciliation flow is the
 * intended mechanism for that).
 */
const ROW_ACCOUNT_OVERRIDE: Record<number, Account> = {
  258: 'checking'
};

/**
 * Row-number amount corrections — same "confirmed wrong, not just missing"
 * standard as ROW_ACCOUNT_OVERRIDE, above.
 *
 *  - 4: High Cliff 2 Group Site reservation. The sheet has -$208.60; the
 *    real figure is -$218.60 (Patrick, 2026-08-20 — "an error I recently
 *    caught" in the spreadsheet itself, not in this script). Applied AFTER
 *    the debit/credit read so a future spreadsheet fix (whenever the sheet
 *    itself gets corrected) needs this entry removed, not silently
 *    overridden forever.
 */
const ROW_AMOUNT_OVERRIDE: Record<number, number> = {
  4: -218.6
};

// ── Sheet reading ────────────────────────────────────────────────────────

interface NormalizedRow {
  rowNumber: number; // 1-based spreadsheet row, for the audit trail + report
  occurredOn: string; // YYYY-MM-DD
  account: Account;
  amount: number; // signed
  kind: TransactionKind;
  method: TransactionMethod | null;
  whoRaw: string; // column B, verbatim (trimmed)
  notesRaw: string | null; // column L, verbatim (trimmed) — was silently
  // dropped before 2026-08-20; see computeMemo().
  activityLabel: string | null;
  needsReview: boolean;
  sheetBalances: { blc: number | null; bls: number | null; sa: number | null };
}

/** Excel serial date -> YYYY-MM-DD. Handles both real Date objects (xlsx's
 *  cellDates: true gives us these for well-formed cells) and the raw serial
 *  number the "Winnie Black" row is corrupted into. */
function toIsoDate(value: unknown, rowNumber: number): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    // XLSX serial epoch is 1899-12-30.
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return d.toISOString().slice(0, 10);
  }
  throw new Error(`Row ${rowNumber}: unreadable date value: ${JSON.stringify(value)}`);
}

function readCashFlow(workbook: XLSX.WorkBook): NormalizedRow[] {
  const sheet = workbook.Sheets['CashFlow'];
  if (!sheet) throw new Error('CashFlow sheet not found.');
  // Positional read (aoa) — the sheet's headers repeat ("Balance" 3x) so
  // sheet_to_json-by-header would collide; index by column letter instead.
  // raw: true (not false) — this is deliberate: raw:false stringifies dates
  // to locale-formatted display text ("8/14/2026") using the cell's number
  // format, which defeats cellDates:true on the workbook read and breaks
  // toIsoDate's Date/serial-number handling. raw:true preserves the real
  // Date objects (or the bare numeric serial for a malformed cell, e.g. the
  // "Winnie Black" row) that toIsoDate expects.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const out: NormalizedRow[] = [];
  const reviewCount = { n: 0 };

  // The sheet is sorted NEWEST-first (row 4 is the most recent transaction,
  // the last row is the oldest). Its own running-balance columns accumulate
  // forward through TIME, i.e. oldest-to-newest — the opposite of file
  // order. Every downstream calculation here (running-balance validation,
  // inferAccountFromMovedColumn's "prior row" lookup) needs to walk
  // chronologically, so build the data-row list first, then reverse it,
  // rather than iterating the sheet's own top-to-bottom order. `rowNumber`
  // still reports each row's real 1-based sheet position for the audit
  // trail — only the PROCESSING order changes, not what gets reported.
  const dataRows: { rowNumber: number; r: unknown[] }[] = [];
  for (let i = 3; i < rows.length; i++) {
    // Data starts row 4 (index 3) — rows 1-3 are the title/sub-header/header.
    const r = rows[i] as unknown[];
    const rowNumber = i + 1;
    if (r[0] == null && r[1] == null) continue; // blank spacer row
    dataRows.push({ rowNumber, r });
  }
  dataRows.reverse();

  for (const { rowNumber, r } of dataRows) {
    const [dateRaw, who, event, debitRaw, creditRaw, category, method, code, blcRaw, blsRaw, saRaw, notes] = r;

    const debit = debitRaw != null && debitRaw !== '' ? Number(debitRaw) : 0;
    const credit = creditRaw != null && creditRaw !== '' ? Number(creditRaw) : 0;
    const amount = ROW_AMOUNT_OVERRIDE[rowNumber] ?? credit - debit;
    if (amount === 0) continue; // both blank, or a $0 row — nothing to import

    const codeStr = String(code ?? '').trim();
    // Row overrides win over the sheet's own code — they exist specifically
    // for rows where the code itself is confirmed wrong, not just missing.
    let account = ROW_ACCOUNT_OVERRIDE[rowNumber] ?? CODE_TO_ACCOUNT[codeStr];
    if (!account) {
      // Bare "BL" or a casing variant — infer from which running-balance
      // column actually differs from the PRIOR row we already emitted for
      // that column. This doubles as this row's own verification.
      account = inferAccountFromMovedColumn(out, blcRaw, blsRaw, saRaw, rowNumber);
    }

    const categoryStr = String(category ?? '').trim();
    const mappedKind = categoryStr ? CATEGORY_MAP[categoryStr] : undefined;
    let kind: TransactionKind;
    let needsReview = false;
    if (categoryStr === '' || mappedKind === 'REVIEW_INCOME') {
      // Either the Category cell was genuinely empty (the common case — 424
      // of 647 rows), or it was the 'Income' catch-all label. Same
      // classifier either way; see classifyUnlabeledRow's own comment.
      const classified = classifyUnlabeledRow(String(event ?? ''), String(who ?? ''), String(notes ?? ''), amount);
      kind = classified.kind;
      needsReview = !classified.confident;
      if (needsReview) reviewCount.n++;
    } else if (mappedKind) {
      kind = mappedKind;
    } else {
      throw new Error(`Row ${rowNumber}: unmapped Category "${categoryStr}".`);
    }

    const methodStr = String(method ?? '').trim();
    let mappedMethod: TransactionMethod | null;
    if (!methodStr) {
      mappedMethod = null;
    } else if (methodStr in METHOD_MAP) {
      // `in`, not `??` — METHOD_MAP legitimately maps some keys to `null`
      // ("Accounting Adjustment" isn't really a payment method), and `??`
      // can't tell that apart from "key absent", which sent every one of
      // those rows through the unmapped-method throw below.
      mappedMethod = METHOD_MAP[methodStr];
    } else {
      throw new Error(`Row ${rowNumber}: unmapped Method "${methodStr}".`);
    }

    out.push({
      rowNumber,
      occurredOn: toIsoDate(dateRaw, rowNumber),
      account,
      amount,
      kind,
      method: mappedMethod ?? null,
      whoRaw: String(who ?? '').trim(),
      notesRaw: String(notes ?? '').trim() || null,
      activityLabel: String(event ?? '').trim() || null,
      needsReview,
      sheetBalances: {
        blc: blcRaw != null && blcRaw !== '' ? Number(blcRaw) : null,
        bls: blsRaw != null && blsRaw !== '' ? Number(blsRaw) : null,
        sa: saRaw != null && saRaw !== '' ? Number(saRaw) : null
      }
    });
  }

  console.log(`CashFlow: read ${out.length} transaction rows (${reviewCount.n} flagged for manual review).`);
  return out;
}

function inferAccountFromMovedColumn(
  priorRows: NormalizedRow[],
  blcRaw: unknown,
  blsRaw: unknown,
  saRaw: unknown,
  rowNumber: number
): Account {
  const blc = blcRaw != null && blcRaw !== '' ? Number(blcRaw) : null;
  const bls = blsRaw != null && blsRaw !== '' ? Number(blsRaw) : null;
  const sa = saRaw != null && saRaw !== '' ? Number(saRaw) : null;
  const lastBlc = [...priorRows].reverse().find((r) => r.sheetBalances.blc != null)?.sheetBalances.blc ?? null;
  const lastBls = [...priorRows].reverse().find((r) => r.sheetBalances.bls != null)?.sheetBalances.bls ?? null;
  const lastSa = [...priorRows].reverse().find((r) => r.sheetBalances.sa != null)?.sheetBalances.sa ?? null;

  if (blc != null && lastBlc != null && blc !== lastBlc) return 'checking';
  if (bls != null && lastBls != null && bls !== lastBls) return 'savings';
  if (sa != null && lastSa != null && sa !== lastSa) return 'scout_account';
  throw new Error(
    `Row ${rowNumber}: bare/ambiguous account code and no running-balance column moved — needs a manual mapping entry.`
  );
}

interface ScoutAccountRawRow {
  name: string;
  balance: number;
}

function readScoutAccounts(workbook: XLSX.WorkBook): ScoutAccountRawRow[] {
  const sheet = workbook.Sheets['Scout Accounts'];
  if (!sheet) throw new Error('Scout Accounts sheet not found.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const out: ScoutAccountRawRow[] = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const [name, balance] = r;
    if (name == null || typeof name !== 'string' || !name.trim()) continue;
    if (typeof balance !== 'number') continue;
    out.push({ name: name.trim(), balance });
  }
  return out;
}

// ── Person resolution (offline — from --people-csv, never supabase-js) ────

/** `id,display_name` per line, no header — exactly what
 *  `psql -t -A -F',' -c "select id, display_name from people order by id"`
 *  produces. Read-only production query; nothing in this script ever writes
 *  through a live connection. */
function loadPeopleFromCsv(path: string): Map<string, number> {
  const text = readFileSync(path, 'utf8');
  const map = new Map<string, number>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const comma = trimmed.indexOf(',');
    if (comma < 0) continue;
    const id = Number(trimmed.slice(0, comma));
    const name = trimmed.slice(comma + 1).trim();
    if (!Number.isFinite(id) || !name) continue;
    map.set(name.toLowerCase(), id);
  }
  return map;
}

function resolvePersonId(rawName: string, nameMap: Map<string, number>): number | null {
  if (!rawName) return null;
  const aliased = NAME_ALIAS[rawName] ?? rawName;
  return nameMap.get(aliased.trim().toLowerCase()) ?? null;
}

/**
 * The memo formula (Patrick, 2026-08-20):
 *   1. Column L (notes), verbatim, if present.
 *   2. Column B (who) is appended too, UNLESS it resolved to a real person —
 *      in that case it's already captured by person_id (shown as "Who" in
 *      the UI), and repeating the name in memo is exactly the redundant
 *      pattern being removed. "Other than a name, or in addition to a
 *      name" (e.g. "Reimb Amy Joyce - Signs VENMO - PAYMENT") never matches
 *      a person exactly, so it falls through to this branch and the WHOLE
 *      cell is kept — the rule doesn't ask for partial name-extraction from
 *      a mixed string, just a binary "did this resolve cleanly or not".
 *   Joined with "; " when both parts are present.
 */
function computeMemo(notesRaw: string | null, whoRaw: string, personResolved: boolean): string | null {
  const parts: string[] = [];
  if (notesRaw) parts.push(notesRaw);
  if (!personResolved && whoRaw) parts.push(whoRaw);
  return parts.length > 0 ? parts.join('; ') : null;
}

interface ResolvedRow extends NormalizedRow {
  personId: number | null;
  memo: string | null;
}

/**
 * Runs unconditionally now (dry run AND commit) — previously person
 * resolution only happened inside the --commit branch, which meant a dry
 * run validated different numbers than a commit would actually write. Also
 * where "Scholarship Fund" rows get reclassified off scout_account, so a
 * dry run's balance report can verify the scholarship figure at all (the
 * old validate() silently hardcoded it to 0 — never actually checked).
 */
function resolveRows(
  rows: NormalizedRow[],
  nameMap: Map<string, number>
): { resolved: ResolvedRow[]; unresolvedScoutNames: Set<string> } {
  const unresolvedScoutNames = new Set<string>();
  const resolved = rows.map((r): ResolvedRow => {
    const isScholarship = r.account === 'scout_account' && r.whoRaw.toLowerCase() === 'scholarship fund';
    const account: Account = isScholarship ? 'scholarship' : r.account;
    // Scholarship is a fund, not a person — there is no "Scholarship Fund"
    // person record to resolve, and none should be attempted.
    const personId = isScholarship ? null : resolvePersonId(r.whoRaw, nameMap);
    if (account === 'scout_account' && personId == null && r.whoRaw) {
      unresolvedScoutNames.add(r.whoRaw);
    }
    const memo = computeMemo(r.notesRaw, r.whoRaw, personId != null);
    return { ...r, account, personId, memo };
  });
  return { resolved, unresolvedScoutNames };
}

// ── Validation ───────────────────────────────────────────────────────────

interface ValidationResult {
  ok: boolean;
  mismatches: string[];
  finalByAccount: Record<Account, number>;
  finalByPerson: Map<string, number>; // keyed by raw sheet name
}

function validate(rows: ResolvedRow[], scoutAccounts: ScoutAccountRawRow[]): ValidationResult {
  const mismatches: string[] = [];
  const running = Object.fromEntries(ACCOUNTS.map((a) => [a, 0])) as Record<Account, number>;
  const perPerson = new Map<string, number>();

  for (const r of rows) {
    running[r.account] = Math.round((running[r.account] + r.amount) * 100) / 100;
    if (r.account === 'scout_account') {
      const prior = perPerson.get(r.whoRaw) ?? 0;
      perPerson.set(r.whoRaw, Math.round((prior + r.amount) * 100) / 100);
    }
    const sheetVal =
      r.account === 'checking' ? r.sheetBalances.blc : r.account === 'savings' ? r.sheetBalances.bls : null;
    if (sheetVal != null && Math.abs(sheetVal - running[r.account]) > 0.01) {
      mismatches.push(
        `Row ${r.rowNumber} (${r.account}): computed running total ${running[r.account]} vs sheet ${sheetVal}`
      );
    }
  }

  for (const sa of scoutAccounts) {
    // Scholarship Fund is reclassified out of scout_account entirely
    // (resolveRows) — it will never appear in perPerson, and comparing it
    // here would be a guaranteed false-positive, not a real mismatch.
    if (sa.name.toLowerCase() === 'scholarship fund') continue;
    const computed = perPerson.get(sa.name) ?? perPerson.get(Object.keys(NAME_ALIAS).find((k) => NAME_ALIAS[k] === sa.name) ?? '') ?? 0;
    if (Math.abs(computed - sa.balance) > 0.01) {
      mismatches.push(
        `Scout account "${sa.name}": CashFlow-derived balance ${computed} vs Scout Accounts sheet ${sa.balance} — likely needs an opening-balance adjustment row for pre-2022 history.`
      );
    }
  }

  const total = [...perPerson.values()].reduce((s, v) => s + v, 0);
  console.log(`Derived scout-account total: $${total.toFixed(2)} (sheet total: $2,942.85).`);

  return { ok: mismatches.length === 0, mismatches, finalByAccount: running, finalByPerson: perPerson };
}

// ── SQL generation ──────────────────────────────────────────────────────

function sqlString(value: string | null): string {
  if (value == null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | null): string {
  return value == null ? 'NULL' : String(value);
}

function buildSql(rows: ResolvedRow[]): string {
  const lines: string[] = [
    '-- Troop Finances reimport — generated by scripts/import-troop-finances.ts',
    `-- ${new Date().toISOString()}`,
    'BEGIN;',
    '',
    `DELETE FROM financial_transactions WHERE import_batch = ${sqlString(IMPORT_BATCH)};`,
    ''
  ];
  const cols = [
    'occurred_on',
    'account',
    'amount',
    'kind',
    'method',
    'person_id',
    'memo',
    'activity_label',
    'source',
    'import_row',
    'import_batch'
  ];
  lines.push(`INSERT INTO financial_transactions (${cols.join(', ')}) VALUES`);
  const valueLines = rows.map((r) => {
    const vals = [
      sqlString(r.occurredOn),
      sqlString(r.account),
      sqlNumber(r.amount),
      sqlString(r.kind),
      sqlString(r.method),
      sqlNumber(r.personId),
      sqlString(r.memo),
      sqlString(r.activityLabel),
      sqlString('import'),
      sqlNumber(r.rowNumber),
      sqlString(IMPORT_BATCH)
    ];
    return `  (${vals.join(', ')})`;
  });
  lines.push(valueLines.join(',\n') + ';');
  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const workbook = XLSX.readFile(XLSX_PATH!, { cellDates: true });
  const cashFlowRows = readCashFlow(workbook);
  const scoutAccounts = readScoutAccounts(workbook);

  const nameMap = loadPeopleFromCsv(PEOPLE_CSV_PATH!);
  const { resolved, unresolvedScoutNames } = resolveRows(cashFlowRows, nameMap);

  if (unresolvedScoutNames.size > 0) {
    console.error(`\n${unresolvedScoutNames.size} scout name(s) did not resolve to a person:`);
    for (const name of unresolvedScoutNames) console.error(`  - "${name}"`);
    console.error('Add a NAME_ALIAS entry (or fix the person record) and re-run — even a dry run needs this.');
    process.exit(1);
  }

  const validation = validate(resolved, scoutAccounts);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = join(REPORTS_DIR, 'troop-finances-import-report.txt');
  const reviewRows = resolved.filter((r) => r.needsReview);
  const balanceLines = (Object.keys(BALANCE_TARGETS) as Account[]).map((account) => {
    const computed = validation.finalByAccount[account];
    const target = BALANCE_TARGETS[account]!;
    const diff = Math.round((computed - target) * 100) / 100;
    const pass = Math.abs(diff) <= 0.01;
    return `  ${account}: computed $${computed.toFixed(2)} vs target $${target.toFixed(2)} — ${
      pass ? 'MATCH' : `OFF BY $${diff.toFixed(2)}`
    }`;
  });
  const reportLines = [
    `Troop Finances import — ${new Date().toISOString()}`,
    `Source: ${XLSX_PATH}`,
    `Rows read: ${cashFlowRows.length}`,
    '',
    `Balance check (import rows only — does not include the 3 source='app' rows outside this batch):`,
    ...balanceLines,
    '',
    `Rows flagged for manual review (best-effort kind guess, not confidently mapped — the SIGN is always read directly from the sheet, never guessed, so these never affect balance): ${reviewRows.length}`,
    ...reviewRows.map(
      (r) => `  Row ${r.rowNumber}: ${r.occurredOn} "${r.whoRaw}" / "${r.activityLabel}" $${r.amount} — guessed kind='${r.kind}'`
    ),
    '',
    `Validation mismatches (running-balance vs. sheet's own columns): ${validation.mismatches.length}`,
    ...validation.mismatches.map((m) => `  - ${m}`)
  ];
  writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`Report written: ${reportPath}`);
  console.log('\nAll computed account totals (import rows only):');
  for (const a of ACCOUNTS) console.log(`  ${a}: $${validation.finalByAccount[a].toFixed(2)}`);
  console.log('\nBalance check:');
  for (const line of balanceLines) console.log(line);

  if (!validation.ok) {
    // Historically accumulated drift (mostly 2023-2024 rows where the
    // treasurer's own spreadsheet left the savings/scout-account balance
    // columns blank) is NOT a reason to refuse import — Patrick, 2026-08-18:
    // "we will reconcile the whole thing when we're done" (the Phase 2
    // monthly reconciliation flow is the intended mechanism for that, not
    // this one-shot script achieving penny-perfect replay of 4 years of
    // hand-kept balances). Loudly reported, never silently swept under the
    // rug — full detail is in the written report either way.
    console.warn(
      `\n${validation.mismatches.length} validation mismatch(es) — see the report for detail. ` +
        `Proceeding is expected here (known historical drift, to be reconciled later), not a script failure.`
    );
  } else {
    console.log('\nValidation passed: derived balances match the spreadsheet exactly.');
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN — no SQL written. Re-run with --commit --sql-out="<path>" to generate the reimport SQL.`);
    return;
  }

  const sql = buildSql(resolved);
  writeFileSync(SQL_OUT_PATH, sql);
  console.log(`\nSQL written: ${SQL_OUT_PATH} (${resolved.length} rows). Apply it against the real database — this script does not connect to one.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
