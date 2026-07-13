/**
 * Historical meeting-attendance importer.
 *
 * Input: a CSV with one attendee per row — a name column and a date column
 * (header names are detected loosely: name/scout/attendee/who + date/meeting).
 * Names may be scouts OR leaders; each is matched against both tables.
 *
 * Run:
 *   npm run import-attendance -- --csv="d:/path/to/attendance.csv"           (dry run)
 *   npm run import-attendance -- --csv="d:/path/to/attendance.csv" --apply   (mutates)
 *
 * Behavior:
 *   1. Creates a draft `meetings` row (date + 'Troop Meeting') for any date
 *      that doesn't have one — drafts stay off the public archive but show in
 *      the admin list.
 *   2. Scout rows → ledger_entries (kind='meeting_attendance',
 *      code='MTG:<date>', qty 1, unit 'meeting', by null, entered_by 'Import').
 *   3. Leader rows → meeting_attendance_leaders (status='attended').
 *   4. Idempotent: existing ledger rows (scout+code) and leader rows
 *      (date+leader) are skipped, so re-running is safe.
 *   5. Unmatched names land in import-reports/unmatched-attendance.csv next
 *      to the input — extend ALIASES below and re-run.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Args ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true;
const CSV_PATH = args.csv as string | undefined;
if (!CSV_PATH) {
  console.error('Usage: import-attendance --csv="<path-to-csv>" [--apply]');
  process.exit(1);
}
const REPORTS_DIR = join(dirname(CSV_PATH), 'import-reports');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required (put it in .env.local).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/** Known name variants → canonical name as it appears in scouts/leaders.
 *  Same idea as the spreadsheet importer's fixups — extend as the dry-run
 *  report surfaces mismatches. Keys are lowercase. */
const ALIASES: Record<string, string> = {
  issac: 'Isaac Hall',
  miles: 'Myles Maciejewski',
  xavi: 'Xavier Juchemich',
  'oliver vestest': 'Oliver Vest',
  'quinn barryarry': 'Quinn Barry',
  patty: 'Paddy Joyce',
  // "Ronnie" = Veronica Kleinfeldt's nickname (56 check-ins, and "Veronica"
  // never appears in the form data) — confirmed guess, remove if wrong.
  ronnie: 'Veronica Kleinfeldt',
  'ronnie kleinfeldt': 'Veronica Kleinfeldt',
  // Typos seen in the Google Form data.
  isacc: 'Isaac Hall',
  mylies: 'Myles Maciejewski',
  soloman: 'Solomon Rader',
  xavior: 'Xavier Juchemich',
  damien: 'Damian Nikolaus',
  eieanor: 'Eleanor Hooper',
  illessa: 'Ilessa Pasquesi',
  jamison: 'Jameson Kimble',
  bodahn: 'Bohdan Dukat',
  liky: 'Lily Porter',
  'oscar v': 'Oscar Belle',
  // Un-hyphenated variants.
  'anjali sankpal tatera': 'Anjali Sankpal-Tatera',
  'maya sankpal tatera': 'Maya Sankpal-Tatera',
  // The form sometimes doubled the tail of a name.
  'finn paltzer paltzer': 'Finn Paltzer',
  'oliver kosmoskiosmoski': 'Oliver Kosmoski',
  quinnb: 'Quinn Barry',
  // Nicknames / context.
  gus: 'August Winklebleck',
  'henry (new kid)': 'Henry Ellerman',
  oli: 'Oliver Vest',
  luxy: 'Lucy Lyden',
  'piper barry': 'Piper Kingston'
};

/** Patrick's rulings (2026-07-12) for bare first names shared by two scouts.
 *  Applied only when same-date exclusion can't resolve the row from evidence.
 *  Remaining unmatched names in the data ("Ronin", "Ellen", "Adam Nikolaus",
 *  "Michael Dukat", "Jack S"/"Jacks") are adults without leader records —
 *  deliberately skipped. */
const AMBIGUOUS_DEFAULTS: Record<string, string> = {
  quinn: 'Quinn Barry',
  lucy: 'Lucy Lyden',
  oliver: 'Oliver Vest'
};

/** Hand-verified check-ins the CSV can't express: the compound
 *  "Hazel Stollenwerk lucy violet" row (three kids, one submission) and the
 *  second Oliver on 10/1/23 (Patrick: both Olivers attended that day). */
const MANUAL_CHECKINS: [string, string][] = [
  ['2023-10-01', 'Oliver Kosmoski'],
  ['2024-10-27', 'Hazel Stollenwerk'],
  ['2024-10-27', 'Lucy Lyden'],
  ['2024-10-27', 'Violet Babby']
];

// ── CSV parsing ───────────────────────────────────────────────────────────

/** Minimal CSV parser: handles quoted fields and embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** '7/14/2024', '2024-07-14', '7/14/2024 15:03:10' (Google Form timestamps)
 *  → '2024-07-14' (or null). A trailing time-of-day is ignored. */
function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s|$)/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const text = readFileSync(CSV_PATH!, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length === 0) {
    console.error('CSV is empty.');
    process.exit(1);
  }

  // Header detection: look for a name-ish and a date-ish column. If the first
  // row doesn't look like a header, assume [name, date].
  const header = rows[0].map(norm);
  let nameCol = header.findIndex((h) => /name|scout|attendee|who|person/.test(h));
  let dateCol = header.findIndex((h) => /date|meeting|when|time/.test(h));
  let dataRows = rows;
  if (nameCol >= 0 && dateCol >= 0) {
    dataRows = rows.slice(1);
  } else {
    nameCol = 0;
    dateCol = 1;
    if (toIsoDate(rows[0][1] ?? '') === null) dataRows = rows.slice(1); // header we didn't recognize
  }

  // Roster lookups.
  const [{ data: scouts, error: sErr }, { data: leaders, error: lErr }] = await Promise.all([
    supabase.from('scouts').select('id, display_name, first_name, last_name'),
    supabase.from('leaders').select('code, name')
  ]);
  if (sErr || lErr) throw new Error((sErr ?? lErr)!.message);

  // Matching tiers (the form mostly collected bare first names):
  //   1. exact full name        — scout display/first+last, leader name
  //   2. unique first name      — scouts before leaders (kids fill the form)
  //   3. first name + last initial — "Lucy L", "Quinn S", "Jack p"
  // Anything with multiple candidates is reported as ambiguous, never guessed.
  const scoutExact = new Map<string, string>();
  const multi = (m: Map<string, string[]>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k)!.includes(v)) m.get(k)!.push(v);
  };
  const scoutFirst = new Map<string, string[]>();
  const scoutFirstInitial = new Map<string, string[]>();
  const scoutLabel = new Map<string, string>();
  for (const s of scouts ?? []) {
    scoutExact.set(norm(s.display_name), s.id);
    scoutExact.set(norm(`${s.first_name} ${s.last_name}`), s.id);
    multi(scoutFirst, norm(s.first_name), s.id);
    multi(scoutFirstInitial, norm(`${s.first_name} ${(s.last_name ?? '').charAt(0)}`), s.id);
    scoutLabel.set(s.id, `${s.first_name} ${s.last_name}`);
  }
  const leaderExact = new Map<string, string>();
  const leaderFirst = new Map<string, string[]>();
  for (const l of leaders ?? []) {
    leaderExact.set(norm(l.name), l.code);
    multi(leaderFirst, norm(l.name.split(/\s+/)[0]), l.code);
  }

  type Match =
    | { kind: 'scout'; id: string }
    | { kind: 'leader'; code: string }
    | { kind: 'ambiguous'; candidates: string[]; label: string }
    | null;

  function matchName(raw: string): Match {
    const key = norm(ALIASES[norm(raw)] ?? raw);
    const exactScout = scoutExact.get(key);
    if (exactScout) return { kind: 'scout', id: exactScout };
    const exactLeader = leaderExact.get(key);
    if (exactLeader) return { kind: 'leader', code: exactLeader };

    for (const tier of [scoutFirst.get(key), scoutFirstInitial.get(key)]) {
      if (!tier) continue;
      if (tier.length === 1) return { kind: 'scout', id: tier[0] };
      return {
        kind: 'ambiguous',
        candidates: tier,
        label: tier.map((id) => `${id} ${scoutLabel.get(id)}`).join(' / ')
      };
    }
    const lf = leaderFirst.get(key);
    if (lf) {
      if (lf.length === 1) return { kind: 'leader', code: lf[0] };
      return { kind: 'ambiguous', candidates: [], label: lf.join(' / ') };
    }
    return null;
  }

  // Classify every CSV row.
  const scoutAtt = new Map<string, Set<string>>(); // date → scout ids
  const leaderAtt = new Map<string, Set<string>>(); // date → leader codes
  const unmatched: { name: string; date: string; reason: string }[] = [];
  const ambiguous: { name: string; date: string; candidates: string[]; label: string }[] = [];
  let resolvedAmbiguous = 0;
  let defaultedAmbiguous = 0;
  let parsed = 0;

  for (const row of dataRows) {
    const rawName = (row[nameCol] ?? '').trim();
    const iso = toIsoDate(row[dateCol] ?? '');
    if (!rawName && !iso) continue;
    if (!iso) {
      unmatched.push({ name: rawName, date: row[dateCol] ?? '', reason: 'unparseable date' });
      continue;
    }
    parsed++;
    const match = matchName(rawName);
    if (match?.kind === 'scout') {
      if (!scoutAtt.has(iso)) scoutAtt.set(iso, new Set());
      scoutAtt.get(iso)!.add(match.id);
    } else if (match?.kind === 'leader') {
      if (!leaderAtt.has(iso)) leaderAtt.set(iso, new Set());
      leaderAtt.get(iso)!.add(match.code);
    } else if (match?.kind === 'ambiguous' && match.candidates.length > 0) {
      ambiguous.push({ name: rawName, date: iso, candidates: match.candidates, label: match.label });
    } else {
      unmatched.push({ name: rawName, date: iso, reason: 'no scout or leader match' });
    }
  }

  // Hand-verified check-ins (exact names — see MANUAL_CHECKINS).
  for (const [iso, name] of MANUAL_CHECKINS) {
    const match = matchName(name);
    if (match?.kind === 'scout') {
      if (!scoutAtt.has(iso)) scoutAtt.set(iso, new Set());
      scoutAtt.get(iso)!.add(match.id);
    }
  }

  // Second pass: same-date exclusion for ambiguous first names. If "Oliver
  // Vest" already checked in on a date, a bare "Oliver" must be Kosmoski.
  // And N bare "Oliver" rows on one date with exactly N absent candidates
  // means all of them were there. Anything still unresolved falls back to
  // Patrick's AMBIGUOUS_DEFAULTS ruling, then the report.
  {
    const byDateName = new Map<string, typeof ambiguous>();
    for (const a of ambiguous) {
      const k = `${a.date}|${norm(a.name)}`;
      if (!byDateName.has(k)) byDateName.set(k, []);
      byDateName.get(k)!.push(a);
    }
    for (const group of byDateName.values()) {
      const { date, candidates, label } = group[0];
      const present = scoutAtt.get(date) ?? new Set<string>();
      const absent = candidates.filter((id) => !present.has(id));
      if (absent.length === group.length) {
        if (!scoutAtt.has(date)) scoutAtt.set(date, new Set());
        for (const id of absent) scoutAtt.get(date)!.add(id);
        resolvedAmbiguous += group.length;
        continue;
      }
      const fallback = AMBIGUOUS_DEFAULTS[norm(group[0].name)];
      const fallbackId = fallback ? scoutExact.get(norm(fallback)) : undefined;
      if (fallbackId && candidates.includes(fallbackId)) {
        if (!scoutAtt.has(date)) scoutAtt.set(date, new Set());
        scoutAtt.get(date)!.add(fallbackId);
        defaultedAmbiguous += group.length;
        continue;
      }
      for (const a of group) {
        unmatched.push({ name: a.name, date: a.date, reason: `ambiguous: ${label}` });
      }
    }
  }

  // Fold stragglers: a Google Form check-in submitted the next morning lands
  // on the wrong date (e.g. Monday 4:44 AM after a Sunday meeting). Any date
  // with fewer than 3 check-ins whose PREVIOUS day has 3 or more is treated
  // as part of that previous day's meeting.
  const checkinsOn = (d: string) => (scoutAtt.get(d)?.size ?? 0) + (leaderAtt.get(d)?.size ?? 0);
  const prevDay = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  };
  const folds: [string, string][] = [];
  for (const d of [...new Set([...scoutAtt.keys(), ...leaderAtt.keys()])].sort()) {
    const prev = prevDay(d);
    if (checkinsOn(d) < 3 && checkinsOn(prev) >= 3) {
      for (const id of scoutAtt.get(d) ?? []) {
        if (!scoutAtt.has(prev)) scoutAtt.set(prev, new Set());
        scoutAtt.get(prev)!.add(id);
      }
      for (const c of leaderAtt.get(d) ?? []) {
        if (!leaderAtt.has(prev)) leaderAtt.set(prev, new Set());
        leaderAtt.get(prev)!.add(c);
      }
      scoutAtt.delete(d);
      leaderAtt.delete(d);
      folds.push([d, prev]);
    }
  }

  const allDates = [...new Set([...scoutAtt.keys(), ...leaderAtt.keys()])].sort();
  const scoutRowCount = [...scoutAtt.values()].reduce((n, s) => n + s.size, 0);
  const leaderRowCount = [...leaderAtt.values()].reduce((n, s) => n + s.size, 0);

  // Existing data (for idempotency + meeting creation).
  const { data: existingMeetings } = await supabase.from('meetings').select('meeting_date');
  const meetingDates = new Set((existingMeetings ?? []).map((m) => m.meeting_date as string));
  const missingMeetings = allDates.filter((d) => !meetingDates.has(d));

  const existingLedger = await fetchAllPages<{ scout_id: string; code: string }>((from, to) =>
    supabase
      .from('ledger_entries')
      .select('scout_id, code')
      .eq('kind', 'meeting_attendance')
      .is('deleted_at', null)
      .range(from, to)
  );
  const haveLedger = new Set(existingLedger.map((r) => `${r.scout_id}|${r.code}`));

  const existingLeaderRows = await fetchAllPages<{ meeting_date: string; leader_code: string }>(
    (from, to) =>
      supabase.from('meeting_attendance_leaders').select('meeting_date, leader_code').range(from, to)
  );
  const haveLeader = new Set(existingLeaderRows.map((r) => `${r.meeting_date}|${r.leader_code}`));

  const ledgerInserts: Record<string, unknown>[] = [];
  for (const [date, ids] of scoutAtt) {
    for (const scoutId of ids) {
      if (haveLedger.has(`${scoutId}|MTG:${date}`)) continue;
      ledgerInserts.push({
        scout_id: scoutId,
        date,
        kind: 'meeting_attendance',
        code: `MTG:${date}`,
        label: 'Troop Meeting',
        by: null,
        qty: 1,
        unit: 'meeting',
        entered_by: 'Import'
      });
    }
  }
  const leaderInserts: Record<string, unknown>[] = [];
  for (const [date, codes] of leaderAtt) {
    for (const leaderCode of codes) {
      if (haveLeader.has(`${date}|${leaderCode}`)) continue;
      leaderInserts.push({ meeting_date: date, leader_code: leaderCode, status: 'attended' });
    }
  }

  // Report.
  console.log(`Parsed ${parsed} attendance rows across ${allDates.length} meeting dates.`);
  if (resolvedAmbiguous > 0) {
    console.log(`  Ambiguous first names resolved by same-date exclusion: ${resolvedAmbiguous}`);
  }
  if (defaultedAmbiguous > 0) {
    console.log(`  Ambiguous first names resolved by ruling (Quinn/Lucy/Oliver): ${defaultedAmbiguous}`);
  }
  if (folds.length > 0) {
    console.log(`  Next-morning stragglers folded into the prior day's meeting:`);
    for (const [d, prev] of folds) console.log(`    ${d} → ${prev}`);
  }
  console.log('\nPer-date check-ins (scouts + leaders; ⚠ = fewer than 3):');
  for (const d of allDates) {
    const s = scoutAtt.get(d)?.size ?? 0;
    const l = leaderAtt.get(d)?.size ?? 0;
    console.log(`  ${d}  ${String(s).padStart(2)} + ${l}${s + l < 3 ? '  ⚠' : ''}`);
  }
  console.log('');
  console.log(`  Scout check-ins:  ${scoutRowCount} (${ledgerInserts.length} new)`);
  console.log(`  Leader check-ins: ${leaderRowCount} (${leaderInserts.length} new)`);
  console.log(`  Meetings to create as drafts: ${missingMeetings.length}`);
  console.log(`  Unmatched rows: ${unmatched.length}`);
  if (unmatched.length > 0) {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const csv =
      'name,date,reason\n' +
      unmatched.map((u) => `"${u.name.replace(/"/g, '""')}",${u.date},${u.reason}`).join('\n');
    const path = join(REPORTS_DIR, 'unmatched-attendance.csv');
    writeFileSync(path, csv);
    console.log(`  → ${path} (add ALIASES entries and re-run)`);
    const distinct = [...new Set(unmatched.map((u) => u.name))].sort();
    console.log(`  Distinct unmatched names: ${distinct.join(', ')}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to import.');
    return;
  }

  if (missingMeetings.length > 0) {
    const { error } = await supabase.from('meetings').insert(
      missingMeetings.map((meeting_date) => ({
        meeting_date,
        title: 'Troop Meeting',
        status: 'draft',
        updated_by: 'Import'
      }))
    );
    if (error) throw new Error(`meetings insert: ${error.message}`);
  }
  for (let i = 0; i < ledgerInserts.length; i += 500) {
    const { error } = await supabase.from('ledger_entries').insert(ledgerInserts.slice(i, i + 500));
    if (error) throw new Error(`ledger insert (batch ${i / 500 + 1}): ${error.message}`);
  }
  for (let i = 0; i < leaderInserts.length; i += 500) {
    const { error } = await supabase
      .from('meeting_attendance_leaders')
      .insert(leaderInserts.slice(i, i + 500));
    if (error) throw new Error(`leader insert (batch ${i / 500 + 1}): ${error.message}`);
  }
  console.log('\nApplied. ✔');
}

/** Paginates past PostgREST's silent 1000-row cap (see lib/supabase/paginate.ts). */
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
