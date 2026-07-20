/**
 * Loader + matcher for the Troop 79 roster CSV.
 *
 * Run:
 *   npm run import-roster-csv -- "<path to csv>"              (dry run)
 *   npm run import-roster-csv -- "<path to csv>" --apply      (writes staging)
 *
 * WHAT THIS DOES AND DOES NOT DO
 * Writes ONLY to import_batches / import_rows / merge_suggestions. It never
 * touches people, scouts, leaders, or scout_parents. Its output is a review
 * queue; a human accepts suggestions, and a separate apply step (not this
 * script) performs the actual writes.
 *
 * MATCHING IS EXACT-ONLY, BY DESIGN
 * Candidates come from exact BSA member id, exact normalized email, or exact
 * normalized full name — in that order of confidence. There is deliberately no
 * fuzzy, phonetic, or edit-distance matching. Two production bugs in one week
 * came from fuzzy name matching ("JamieLynn"/"Jamie Lynn", "Dan"/"Daniel"), and
 * the answer to a matcher that guesses wrong is not a cleverer matcher, it is a
 * human looking at the two records. `name_only` candidates are emitted but are
 * flagged as the weakest class precisely so the UI refuses to pre-accept them.
 *
 * The Relationship column is NOT parsed. It holds 56 distinct phrasings and
 * points in two directions (adult rows say "Mom of X"; scout rows say "Dad
 * Patrick, Mom Jamie Lynn"). It is carried through verbatim for a human to read.
 *
 * FIELD CHANGES ARE CLASSIFIED, NOT APPLIED
 * For each candidate, every comparable field is recorded as 'fill' (DB empty),
 * 'conflict' (both present and different), or 'same'. The source file is known
 * to contain stale values, so nothing is auto-preferred in either direction.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const csvPath = args.find((a) => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: npm run import-roster-csv -- "<path to csv>" [--apply]');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required. Put it in .env.local.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ── CSV parsing ────────────────────────────────────────────────────────────
// Hand-rolled rather than adding a dependency: the file is small, quoted
// fields and embedded commas are the only cases that occur.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const clean = (s: string | undefined | null) => (s ?? '').trim();
const normEmail = (s: string | undefined | null) => clean(s).toLowerCase();
const normName = (s: string | undefined | null) =>
  clean(s).toLowerCase().replace(/\s+/g, ' ');

/** Source DOB is m/d/yyyy. Returns ISO or null; never throws on junk. */
function parseDate(s: string): string | null {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * The source packs several emails into one cell separated by ';'. Only the
 * first is treated as primary; the rest stay in `raw` for the reviewer.
 * Stray angle brackets appear in the source ("addr@x.com>") and are stripped.
 */
function firstEmail(s: string): string {
  return clean(clean(s).split(/[;,]/)[0]).replace(/[<>]/g, '');
}

/**
 * Guard against the family-email trap.
 *
 * A shared address is NOT identity. Households hand one email to the troop, so
 * danbieser@hotmail.com sits on both Dan Bieser's record and his son Ben's.
 * Matching on email alone therefore proposed merging a child into a parent —
 * on the first dry run it offered Ben Bieser -> Daniel Bieser, Kevin Barry ->
 * Piper Kingston (male adult into female scout), and Summer Curtis -> Fiona
 * Kimble (mother into daughter). Accepting any of those would destroy two
 * people's records, which is far worse than the duplicate listing this whole
 * effort exists to fix.
 *
 * So an email match must be corroborated by the name: either the full names
 * agree, or the surnames agree AND one first name is a prefix of the other
 * ("Adi" / "Aditya"). The prefix rule is what separates a nickname from a
 * relative — "Ben" is not a prefix of "Daniel", but "Adi" is of "Aditya".
 * Anything uncorroborated falls through to weaker evidence or to "new person",
 * which is the safe direction: a missed match costs a reviewer one click, a
 * wrong merge costs two people's data.
 */
function nameCorroborates(csvFirst: string, csvLast: string, p: PersonRow): boolean {
  const cFull = normName(`${csvFirst} ${csvLast}`);
  if (cFull && cFull === normName(p.display_name)) return true;
  const cl = normName(csvLast);
  const pl = normName(p.last_name ?? '');
  if (!cl || !pl || cl !== pl) return false;
  const cf = normName(csvFirst);
  const pf = normName(p.first_name ?? '');
  if (!cf || !pf) return false;
  if (cf === pf) return true;
  const [short, long] = cf.length <= pf.length ? [cf, pf] : [pf, cf];
  return short.length >= 3 && long.startsWith(short);
}

interface CsvRecord {
  lineNo: number;
  raw: Record<string, string>;
  bsa: string;
  first: string;
  last: string;
  displayName: string;
  roleCode: string;
  birthdate: string | null;
  gender: string;
  school: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  relationshipText: string;
}

const text = readFileSync(csvPath, 'utf8');
const rows = parseCsv(text);
const header = rows[0].map((h) => clean(h));
// The BSA id column ships with an empty header.
const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
const idxBsa = 0;
const I = {
  first: col('First'), last: col('Last'), role: col('W/S/JL/A'),
  dob: col('DOB'), gender: col('Gender'), school: col('School'),
  rel: col('Relationship'), email: col('eMail'), cell: col('Cell'),
  addr: col('Address'), city: col('City'), state: col('State'), zip: col('Zip')
};

const records: CsvRecord[] = rows.slice(1).map((r, i) => {
  const raw: Record<string, string> = {};
  header.forEach((h, j) => { raw[h || 'bsa_member_id'] = clean(r[j]); });
  const first = clean(r[I.first]);
  const last = clean(r[I.last]);
  return {
    lineNo: i + 2,
    raw,
    bsa: clean(r[idxBsa]),
    first, last,
    displayName: `${first} ${last}`.replace(/\s+/g, ' ').trim(),
    roleCode: clean(r[I.role]),
    birthdate: parseDate(clean(r[I.dob])),
    gender: clean(r[I.gender]),
    school: clean(r[I.school]),
    email: firstEmail(clean(r[I.email])),
    phone: clean(r[I.cell]),
    address1: clean(r[I.addr]),
    city: clean(r[I.city]),
    state: clean(r[I.state]),
    zip: clean(r[I.zip]),
    relationshipText: clean(r[I.rel])
  };
});

// ── Load existing people ───────────────────────────────────────────────────
interface PersonRow {
  id: number; display_name: string; first_name: string | null; last_name: string | null;
  primary_email: string | null; primary_phone: string | null; bsa_member_id: string | null;
  birthdate: string | null; gender: string | null;
}

async function loadPeople(): Promise<PersonRow[]> {
  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, first_name, last_name, primary_email, primary_phone, bsa_member_id, birthdate, gender')
    .is('merged_into_person_id', null);
  if (error) throw new Error(`loading people: ${error.message}`);
  return (data ?? []) as PersonRow[];
}

type Kind = 'fill' | 'conflict' | 'same';
interface FieldChange { field: string; csv_value: string; db_value: string; kind: Kind }

/** Compares only fields the CSV actually carries a value for. */
function compareFields(rec: CsvRecord, p: PersonRow): FieldChange[] {
  const pairs: [string, string, string | null][] = [
    ['display_name', rec.displayName, p.display_name],
    ['primary_email', rec.email, p.primary_email],
    ['primary_phone', rec.phone, p.primary_phone],
    ['bsa_member_id', rec.bsa, p.bsa_member_id],
    ['birthdate', rec.birthdate ?? '', p.birthdate],
    ['gender', rec.gender, p.gender]
  ];
  const out: FieldChange[] = [];
  for (const [field, csvRaw, dbRaw] of pairs) {
    const csv = clean(csvRaw);
    const db = clean(dbRaw);
    if (!csv) continue;                       // CSV silent — nothing to propose
    const same = field.includes('email')
      ? csv.toLowerCase() === db.toLowerCase()
      : normName(csv) === normName(db);
    out.push({ field, csv_value: csv, db_value: db, kind: !db ? 'fill' : same ? 'same' : 'conflict' });
  }
  return out;
}

async function main() {
  const people = await loadPeople();

  const byBsa = new Map<string, PersonRow[]>();
  const byEmail = new Map<string, PersonRow[]>();
  const byName = new Map<string, PersonRow[]>();
  const push = <K,>(m: Map<K, PersonRow[]>, k: K, v: PersonRow) =>
    m.set(k, [...(m.get(k) ?? []), v]);
  for (const p of people) {
    if (clean(p.bsa_member_id)) push(byBsa, clean(p.bsa_member_id), p);
    if (clean(p.primary_email)) push(byEmail, normEmail(p.primary_email), p);
    push(byName, normName(p.display_name), p);
  }

  interface Suggestion {
    lineNo: number;
    personId: number | null;
    confidence: 'bsa_member_id' | 'email' | 'name_only' | 'none';
    evidence: Record<string, unknown>;
    fieldChanges: FieldChange[];
  }
  const suggestions: Suggestion[] = [];
  const tally = { bsa_member_id: 0, email: 0, name_only: 0, none: 0 };

  for (const rec of records) {
    // Strongest available evidence class wins. Candidates are NOT accumulated
    // across classes: a BSA-id match makes a same-name coincidence irrelevant,
    // and offering both would invite a reviewer to pick the weaker one.
    let matches: PersonRow[] = [];
    let confidence: Suggestion['confidence'] = 'none';

    if (rec.bsa && byBsa.has(rec.bsa)) {
      matches = byBsa.get(rec.bsa)!;
      confidence = 'bsa_member_id';
    } else if (
      rec.email &&
      byEmail.has(normEmail(rec.email)) &&
      // Shared family address — see nameCorroborates() above.
      byEmail.get(normEmail(rec.email))!.some((p) => nameCorroborates(rec.first, rec.last, p))
    ) {
      matches = byEmail.get(normEmail(rec.email))!.filter((p) => nameCorroborates(rec.first, rec.last, p));
      confidence = 'email';
    } else if (byName.has(normName(rec.displayName))) {
      matches = byName.get(normName(rec.displayName))!;
      confidence = 'name_only';
    }

    tally[confidence] += 1;

    if (matches.length === 0) {
      suggestions.push({
        lineNo: rec.lineNo, personId: null, confidence: 'none',
        evidence: { reason: 'no exact match on BSA id, email, or full name' },
        fieldChanges: []
      });
      continue;
    }

    for (const p of matches) {
      suggestions.push({
        lineNo: rec.lineNo,
        personId: p.id,
        confidence,
        evidence: {
          matched_on: confidence,
          csv_value:
            confidence === 'bsa_member_id' ? rec.bsa :
            confidence === 'email' ? rec.email : rec.displayName,
          person_display_name: p.display_name,
          candidate_count: matches.length
        },
        fieldChanges: compareFields(rec, p)
      });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const conflicts = suggestions.filter((s) => s.fieldChanges.some((f) => f.kind === 'conflict'));
  const multi = new Map<number, number>();
  suggestions.forEach((s) => multi.set(s.lineNo, (multi.get(s.lineNo) ?? 0) + 1));

  console.log(`\nSource: ${csvPath}`);
  console.log(`Rows: ${records.length}   Existing people: ${people.length}\n`);
  console.log('Match confidence (one class per row, strongest wins):');
  console.log(`  BSA member id : ${tally.bsa_member_id}`);
  console.log(`  email         : ${tally.email}`);
  console.log(`  name only     : ${tally.name_only}   <- weakest, never pre-accepted`);
  console.log(`  no match      : ${tally.none}   -> would become new people`);
  console.log(`\nSuggestion rows: ${suggestions.length}`);
  console.log(`Rows with >1 candidate: ${[...multi.values()].filter((n) => n > 1).length}`);
  console.log(`Suggestions carrying a field conflict: ${conflicts.length}`);

  if (conflicts.length) {
    console.log('\nField conflicts (CSV value vs stored value):');
    for (const s of conflicts.slice(0, 40)) {
      const rec = records.find((r) => r.lineNo === s.lineNo)!;
      for (const f of s.fieldChanges.filter((f) => f.kind === 'conflict')) {
        console.log(`  L${s.lineNo} ${rec.displayName} [${f.field}] csv="${f.csv_value}" db="${f.db_value}"`);
      }
    }
  }

  const nameOnly = suggestions.filter((s) => s.confidence === 'name_only');
  if (nameOnly.length) {
    console.log('\nName-only candidates (each needs an explicit human decision):');
    for (const s of nameOnly) {
      const rec = records.find((r) => r.lineNo === s.lineNo)!;
      console.log(`  L${s.lineNo} ${rec.displayName} (${rec.roleCode}) -> person ${s.personId}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to create the staging batch.');
    return;
  }

  // ── Write staging ────────────────────────────────────────────────────────
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      source_label: `Roster CSV ${new Date().toISOString().slice(0, 10)}`,
      source_filename: csvPath,
      row_count: records.length,
      notes: 'Relationship column intentionally unparsed; entered by hand during review.'
    })
    .select('id')
    .single();
  if (batchErr || !batch) throw new Error(`creating batch: ${batchErr?.message}`);

  const { data: inserted, error: rowsErr } = await supabase
    .from('import_rows')
    .insert(records.map((r) => ({
      batch_id: batch.id,
      line_no: r.lineNo,
      raw: r.raw,
      bsa_member_id: r.bsa || null,
      first_name: r.first || null,
      last_name: r.last || null,
      display_name: r.displayName,
      role_code: r.roleCode || null,
      birthdate: r.birthdate,
      gender: r.gender || null,
      school: r.school || null,
      email: r.email || null,
      phone: r.phone || null,
      address_line1: r.address1 || null,
      city: r.city || null,
      state: r.state || null,
      zip: r.zip || null,
      relationship_text: r.relationshipText || null
    })))
    .select('id, line_no');
  if (rowsErr || !inserted) throw new Error(`inserting rows: ${rowsErr?.message}`);

  const idByLine = new Map(inserted.map((r) => [r.line_no as number, r.id as number]));
  const { error: sugErr } = await supabase
    .from('merge_suggestions')
    .insert(suggestions.map((s) => ({
      import_row_id: idByLine.get(s.lineNo)!,
      person_id: s.personId,
      confidence: s.confidence,
      evidence: s.evidence,
      field_changes: s.fieldChanges
    })));
  if (sugErr) throw new Error(`inserting suggestions: ${sugErr.message}`);

  console.log(`\nStaged batch ${batch.id}: ${inserted.length} rows, ${suggestions.length} suggestions.`);
  console.log('Nothing in people/scouts/leaders/scout_parents was modified.');
}

main().catch((e) => { console.error(e); process.exit(1); });
