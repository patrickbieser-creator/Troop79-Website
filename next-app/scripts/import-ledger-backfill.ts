/**
 * One-time backfill: inserts historical ledger_entries rows reconciled from
 * the old Google Sheets "History" tab against the current Supabase ledger.
 * Scope for this run: Tenderfoot/Second Class/First Class First Aid,
 * Fitness, and Lashings sub-requirements (the "unofficial" child codes Fast
 * Entry signs off individually but the old sheet tracked under its own RID
 * scheme — see the reconciliation session for full methodology).
 *
 * Input JSON is an array of:
 *   { scoutId, code, dateCompleted, created, approvedBy, subLabel, ... }
 * (extra fields from the reconciliation, e.g. scoutName/rid/conflict, are
 * ignored — only the fields below are read.)
 *
 * date        <- dateCompleted (the historical completion date; preserved exactly)
 * entered_at  <- created (the sheet's own "Created" column; preserved so this
 *                backfill doesn't read as "916 things happened today" in the
 *                Universal Ledger's entered_at-desc default sort or Fast
 *                Entry's Audit Tape)
 * by          <- approvedBy
 * label       <- subLabel
 * qty/unit    <- DB defaults (1 / 'complete'), same as every other
 *                rank_requirement row
 *
 * Safety:
 *   - Defaults to a DRY RUN — prints what would be inserted, writes nothing.
 *     Pass --commit to actually write.
 *   - Re-checks ledger_active immediately before inserting (not just the
 *     snapshot the reconciliation was built from) and skips any (scout_id,
 *     code) pair that already exists, so the script is safe to re-run.
 *
 * Run:  npm run import-ledger-backfill -- <path-to-json> [--commit]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var is required (see next-app/.env.local).');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--commit');
const commit = process.argv.includes('--commit');
const inputPath = args[0];

if (!inputPath) {
  console.error('Usage: npm run import-ledger-backfill -- <path-to-json> [--commit]');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

interface InputRow {
  scoutId: string;
  scoutDisplay: string;
  code: string;
  subLabel: string;
  dateCompleted: string;
  created: string;
  approvedBy: string;
}

const rows = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as InputRow[];

// M/D/YYYY or M/D/YY -> 'YYYY-MM-DD'
function toDateString(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) throw new Error(`Unparseable date: "${s}"`);
  const [, mo, d, yRaw] = m;
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Same format, but as a timestamp (noon, no explicit zone — day-level
// precision is all that matters for entered_at here).
function toTimestampString(s: string): string {
  return `${toDateString(s)}T12:00:00`;
}

async function main() {
  const targetCodes = [...new Set(rows.map((r) => r.code))];
  const { data: existingRows, error: existingErr } = await supabase
    .from('ledger_active')
    .select('scout_id,code')
    .eq('kind', 'rank_requirement')
    .in('code', targetCodes);
  if (existingErr) throw new Error(existingErr.message);
  const existingKey = new Set((existingRows ?? []).map((e) => `${e.scout_id}|||${e.code}`));

  const toInsert: {
    scout_id: string;
    date: string;
    kind: 'rank_requirement';
    code: string;
    label: string;
    by: string;
    entered_at: string;
  }[] = [];
  let skippedAlreadyPresent = 0;

  for (const r of rows) {
    const key = `${r.scoutId}|||${r.code}`;
    if (existingKey.has(key)) {
      skippedAlreadyPresent++;
      continue;
    }
    toInsert.push({
      scout_id: r.scoutId,
      date: toDateString(r.dateCompleted),
      kind: 'rank_requirement',
      code: r.code,
      label: r.subLabel,
      by: r.approvedBy,
      entered_at: toTimestampString(r.created)
    });
  }

  console.log(`Input rows: ${rows.length}`);
  console.log(`Already present in ledger (skipped): ${skippedAlreadyPresent}`);
  console.log(`To insert: ${toInsert.length}`);

  const byCode = new Map<string, number>();
  for (const row of toInsert) byCode.set(row.code.replace(/\.\d+$/, ''), (byCode.get(row.code.replace(/\.\d+$/, '')) ?? 0) + 1);
  console.log('\nBy requirement:');
  for (const [req, n] of [...byCode.entries()].sort()) console.log(`  ${req}: ${n}`);

  console.log('\nSample rows (first 5):');
  for (const row of toInsert.slice(0, 5)) {
    console.log(`  ${row.scout_id}  ${row.code}  date=${row.date}  entered_at=${row.entered_at}  by=${row.by}  "${row.label}"`);
  }

  if (!commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to insert these rows.');
    return;
  }

  console.log(`\nCommitting ${toInsert.length} rows...`);
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await supabase.from('ledger_entries').insert(chunk);
    if (error) throw new Error(`insert chunk starting at ${i}: ${error.message}`);
    inserted += chunk.length;
    console.log(`  ${inserted} / ${toInsert.length}`);
  }
  console.log(`Done. Inserted ${inserted} rows.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
