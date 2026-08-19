/**
 * One-shot importer: converts the treasurer's `Troop Accounts.xlsx` (CashFlow
 * + Scout Accounts sheets) into financial_transactions rows
 * (Plans/Troop-Finances.md Phase 1).
 *
 * Run:
 *   npm run import-troop-finances -- --xlsx="d:/path/Troop Accounts.xlsx"            (dry run)
 *   npm run import-troop-finances -- --xlsx="d:/path/Troop Accounts.xlsx" --commit   (mutates)
 *
 * Same shape as scripts/import-spreadsheet.ts (the advancement-ledger
 * importer): dry-run by default, explicit dictionaries for the messy
 * free-text columns, a written report of anything that needed a judgment
 * call rather than a silent guess.
 *
 * TWO PASSES, per Plans/Troop-Finances.md — this file does BOTH, but keeps
 * them as clearly separate functions rather than one blur:
 *   1. normalize()  — raw sheet row -> typed NormalizedRow (no DB access)
 *   2. resolve()     — name -> person_id, self-verification against the
 *                       sheet's own running-balance columns (DB reads only)
 * INSERT happens only with --commit, and only after resolve() has run
 * cleanly for every row — see main().
 *
 * Idempotent via import_batch: a --commit run first deletes any existing
 * financial_transactions rows tagged with IMPORT_BATCH, so this script is
 * safe to re-run while the mapping dictionaries are still being tuned.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';
import type { Account, TransactionKind, TransactionMethod } from '../src/lib/finance';

const IMPORT_BATCH = 'cashflow-2026';

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
if (!XLSX_PATH) {
  console.error('Usage: import-troop-finances --xlsx="<path-to-xlsx>" [--commit]');
  process.exit(1);
}
const REPORTS_DIR = (args['reports-dir'] as string | undefined) ?? join(dirname(XLSX_PATH), 'import-reports');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var is required (see next-app/.env.local).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

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
   *  trusted silently, no matter how plausible the keyword match looks. */
  confident: boolean;
}

/**
 * Classifies a row that has no usable Category value — either the sheet's
 * Category cell was truly empty (424 of 647 rows; discovered only once the
 * import was actually run against the real file, not assumed from the
 * distinct-value counts) or it was the catch-all 'Income' label. Handles
 * BOTH cases with one function since, in practice, the same keyword
 * patterns show up in each.
 *
 * A large share of the blank rows are unambiguous (Can Drive / Wreaths /
 * Dividends line items repeated hundreds of times) — those are classified
 * confidently and skip manual review. The rest are raw bank/payment-
 * processor statement lines the treasurer evidently pasted in bulk without
 * ever filling in a category ("VENMO 250526PPZZER - PAYMENT", "Check #
 * 1033: Completed") — a script has no reliable way to know what those were
 * for, so every one of them gets a best-effort guess AND a mandatory review
 * flag. Never silently trust a guess on real financial history.
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
 * handoff, not a miscoded checking wash. (An earlier version of this
 * override incorrectly recoded it to checking based on the adjacent row
 * 569's "Scouts' fundraising acct" label — that label belongs to row 569's
 * own miscount, not row 568's account code. Left here as a note, not a
 * ROW_ACCOUNT_OVERRIDE entry, so the mistake doesn't get quietly repeated.)
 * The resulting ~$974.78 checking-side drift from here forward is known,
 * expected, and deliberately NOT chased further — Patrick: "we will
 * reconcile the whole thing when we're done" (the Phase 2 monthly
 * reconciliation flow is the intended mechanism for that).
 */
const ROW_ACCOUNT_OVERRIDE: Record<number, Account> = {
  258: 'checking'
};

// ── Sheet reading ────────────────────────────────────────────────────────

interface NormalizedRow {
  rowNumber: number; // 1-based spreadsheet row, for the audit trail + report
  occurredOn: string; // YYYY-MM-DD
  account: Account;
  amount: number; // signed
  kind: TransactionKind;
  method: TransactionMethod | null;
  whoRaw: string;
  isScoutAccountRow: boolean;
  memo: string | null;
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
    const amount = credit - debit;
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
      isScoutAccountRow: account === 'scout_account',
      memo: account === 'scout_account' ? null : String(who ?? '').trim() || null,
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

// ── Person resolution ───────────────────────────────────────────────────

async function loadPeopleByName(client: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await client.from('people').select('id, display_name');
  if (error) throw new Error(`people lookup failed: ${error.message}`);
  const map = new Map<string, number>();
  for (const p of (data ?? []) as { id: number; display_name: string }[]) {
    map.set(p.display_name.trim().toLowerCase(), p.id);
  }
  return map;
}

function resolvePersonId(rawName: string, nameMap: Map<string, number>): number | null {
  const aliased = NAME_ALIAS[rawName] ?? rawName;
  return nameMap.get(aliased.trim().toLowerCase()) ?? null;
}

// ── Validation ───────────────────────────────────────────────────────────

interface ValidationResult {
  ok: boolean;
  mismatches: string[];
  finalByAccount: Record<Account, number>;
  finalByPerson: Map<string, number>; // keyed by raw sheet name
}

function validate(rows: NormalizedRow[], scoutAccounts: ScoutAccountRawRow[]): ValidationResult {
  const mismatches: string[] = [];
  const running: Record<'checking' | 'savings' | 'scout_account', number> = {
    checking: 0,
    savings: 0,
    scout_account: 0
  };
  const perPerson = new Map<string, number>();

  for (const r of rows) {
    if (r.account === 'checking' || r.account === 'savings' || r.account === 'scout_account') {
      running[r.account] = Math.round((running[r.account] + r.amount) * 100) / 100;
    }
    if (r.account === 'scout_account') {
      const prior = perPerson.get(r.whoRaw) ?? 0;
      perPerson.set(r.whoRaw, Math.round((prior + r.amount) * 100) / 100);
    }
    const sheetVal =
      r.account === 'checking' ? r.sheetBalances.blc : r.account === 'savings' ? r.sheetBalances.bls : null;
    if (sheetVal != null && Math.abs(sheetVal - running[r.account as 'checking' | 'savings']) > 0.01) {
      mismatches.push(
        `Row ${r.rowNumber} (${r.account}): computed running total ${running[r.account as 'checking' | 'savings']} vs sheet ${sheetVal}`
      );
    }
  }

  for (const sa of scoutAccounts) {
    const computed = perPerson.get(sa.name) ?? perPerson.get(Object.keys(NAME_ALIAS).find((k) => NAME_ALIAS[k] === sa.name) ?? '') ?? 0;
    if (Math.abs(computed - sa.balance) > 0.01) {
      mismatches.push(
        `Scout account "${sa.name}": CashFlow-derived balance ${computed} vs Scout Accounts sheet ${sa.balance} — likely needs an opening-balance adjustment row for pre-2022 history.`
      );
    }
  }

  const total = Object.values(Object.fromEntries(perPerson)).reduce((s, v) => s + v, 0);
  console.log(`Derived scout-account total: $${total.toFixed(2)} (sheet total: $2,942.85).`);

  return {
    ok: mismatches.length === 0,
    mismatches,
    finalByAccount: { checking: running.checking, savings: running.savings, scout_account: running.scout_account, scholarship: 0, sofi: 0 },
    finalByPerson: perPerson
  };
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const workbook = XLSX.readFile(XLSX_PATH!, { cellDates: true });
  const cashFlowRows = readCashFlow(workbook);
  const scoutAccounts = readScoutAccounts(workbook);

  const validation = validate(cashFlowRows, scoutAccounts);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = join(REPORTS_DIR, 'troop-finances-import-report.txt');
  const reviewRows = cashFlowRows.filter((r) => r.needsReview);
  const reportLines = [
    `Troop Finances import — ${new Date().toISOString()}`,
    `Source: ${XLSX_PATH}`,
    `Rows read: ${cashFlowRows.length}`,
    `Rows flagged for manual review (best-effort kind guess, not confidently mapped): ${reviewRows.length}`,
    ...reviewRows.map(
      (r) => `  Row ${r.rowNumber}: ${r.occurredOn} "${r.whoRaw}" / "${r.activityLabel}" $${r.amount} — guessed kind='${r.kind}'`
    ),
    '',
    `Validation mismatches: ${validation.mismatches.length}`,
    ...validation.mismatches.map((m) => `  - ${m}`)
  ];
  writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`Report written: ${reportPath}`);

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
    console.log(`\nDRY RUN — no rows written. Re-run with --commit to import ${cashFlowRows.length} transactions.`);
    return;
  }

  const nameMap = await loadPeopleByName(supabase);
  const unresolved = new Set<string>();

  const insertRows = cashFlowRows.map((r) => {
    let personId: number | null = null;
    if (r.account === 'scout_account') {
      if (r.whoRaw.toLowerCase() === 'scholarship fund') {
        return { ...r, account: 'scholarship' as Account, personId: null };
      }
      personId = resolvePersonId(r.whoRaw, nameMap);
      if (personId == null) unresolved.add(r.whoRaw);
    }
    return { ...r, personId };
  });

  if (unresolved.size > 0) {
    console.error(`\nCannot commit — ${unresolved.size} scout name(s) did not resolve to a person:`);
    for (const name of unresolved) console.error(`  - "${name}"`);
    console.error('Add a NAME_ALIAS entry (or fix the person record) and re-run.');
    process.exit(1);
  }

  console.log(`\nDeleting any existing rows tagged import_batch='${IMPORT_BATCH}' (idempotent re-run)...`);
  const { error: delErr } = await supabase.from('financial_transactions').delete().eq('import_batch', IMPORT_BATCH);
  if (delErr) throw new Error(`cleanup delete failed: ${delErr.message}`);

  const payload = insertRows.map((r) => ({
    occurred_on: r.occurredOn,
    account: r.account,
    amount: r.amount,
    kind: r.kind,
    method: r.method,
    person_id: r.personId,
    memo: r.memo,
    activity_label: r.activityLabel,
    source: 'import',
    import_row: r.rowNumber,
    import_batch: IMPORT_BATCH
  }));

  console.log(`Inserting ${payload.length} rows...`);
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase.from('financial_transactions').insert(payload.slice(i, i + CHUNK));
    if (error) throw new Error(`insert failed at offset ${i}: ${error.message}`);
  }

  console.log(`Done. ${payload.length} rows imported under import_batch='${IMPORT_BATCH}'.`);
  console.log('NOTE: pre-2022 opening-balance adjustment rows (if the validation report flagged any) are NOT');
  console.log('auto-created — insert those manually with kind=\'adjustment\' after reviewing the report.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
