/**
 * One-shot importer: backfills demographics from the Scoutbook Unit Roster
 * PDF (UnitRosterReport_20260713.pdf) into existing scouts/leaders rows.
 *
 * Run:
 *   npm run import-roster              (dry run)
 *   npm run import-roster -- --apply   (mutates)
 *
 * Behavior:
 *   - Scouts matched by bsa_member_id (already populated from the prior
 *     spreadsheet import); falls back to first+last name for the one scout
 *     (Aubrey Reinelt) missing a BSA ID locally. UPDATEs gender,
 *     graduation_year (inverted from roster grade via the app's own Aug-1
 *     rollover math), address, phone, and bsa_member_id if missing.
 *     current_rank is never touched (trigger-derived from the ledger).
 *   - Maya Sankpal-Tatera (A01) is skipped for grade/graduation_year: she's
 *     already promoted to adult in production and the roster's grade value
 *     for her is stale.
 *   - Leaders matched via an explicit code map (see ADULT_CODE_MAP) rather
 *     than fuzzy name matching, since only 13 adults are in scope. Existing
 *     leaders get bsa_member_id, ypt_completed (inverted from the roster's
 *     YPT Expiration, which is always completion + 2y same month/day),
 *     address, and phone filled in. `role` is only filled when currently
 *     NULL — never overwritten, since existing role text may carry
 *     site-specific meaning (e.g. "Merit Badge Counselor") beyond the
 *     Scoutbook unit position.
 *   - 5 adults on the roster have no existing leader row (Tyler Brauhn,
 *     Kristin Paltzer, Michelle Porter, Melissa Rader, Tim Radtke) — these
 *     are INSERTed with newly assigned codes.
 *   - Writes reports/roster-import-notes.csv flagging: active-flag
 *     mismatches (scout on roster but marked inactive locally), and
 *     existing leader roles that conflict with the roster's stated
 *     position (never auto-corrected — surfaced for manual review).
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Args ──────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply');
const REPORTS_DIR = join(__dirname, '..', 'import-reports');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required. Put it in .env.local.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ── Derived-demographics math (mirrors src/lib/demographics.ts) ────────────

const REPORT_DATE = '2026-07-13'; // UnitRosterReport_20260713.pdf generation date

function schoolYearEnd(onDate: string): number {
  const [y, m] = onDate.split('-').map(Number);
  return m >= 8 ? y + 1 : y;
}

/** Inverse of gradeFromGradYear(): the graduation year for a scout currently in `grade`. */
function gradYearFromGrade(grade: number, onDate: string): number {
  return schoolYearEnd(onDate) + (12 - grade);
}

/** Inverse of yptStatus()'s expiry math: completion = expiration - 2y, same month/day. */
function yptCompletedFromExpiration(mmddyyyy: string): string {
  const [mm, dd, yyyy] = mmddyyyy.split('/');
  return `${Number(yyyy) - 2}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// ── Roster data (transcribed from UnitRosterReport_20260713.pdf) ───────────

interface RosterYouth {
  bsaId: string;
  first: string;
  last: string;
  gender: 'M' | 'F';
  grade: number;
  addr: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
}

const YOUTH: RosterYouth[] = [
  { bsaId: '142155141', first: 'Aditya', last: 'Alfred', gender: 'M', grade: 7, addr: '622 Crescent Ct', city: 'Wauwatosa', state: 'WI', zip: '53213', phone: '(414) 418-6129' },
  { bsaId: '142185972', first: 'Benjamin', last: 'Bieser', gender: 'M', grade: 7, addr: '7110 Grand Pkwy', city: 'Wauwatosa', state: 'WI', zip: '53213', phone: '(414) 825-0336' },
  { bsaId: '141934891', first: 'Eleanor', last: 'Hooper', gender: 'F', grade: 9, addr: '1818 E Rusk Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(262) 497-8819' },
  { bsaId: '14566448', first: 'Fiona', last: 'Kimble', gender: 'F', grade: 6, addr: '3144 S Logan Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 378-9901' },
  { bsaId: '13706001', first: 'Piper', last: 'Kingston', gender: 'F', grade: 6, addr: '1702 E Iron St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 839-9987' },
  { bsaId: '13766813', first: 'Lily', last: 'Porter', gender: 'F', grade: 6, addr: '3117 S Delaware Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 731-0206' },
  { bsaId: '13696559', first: 'Owen', last: 'Radtke', gender: 'M', grade: 7, addr: '4163 W Hilltop Ln', city: 'Franklin', state: 'WI', zip: '53132', phone: '(847) 254-6884' },
  { bsaId: '14623236', first: 'Aubrey', last: 'Reinelt', gender: 'F', grade: 6, addr: '2615 S Shore Dr', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 333-9082' },
  { bsaId: '141005673', first: 'Winnefred', last: 'Black', gender: 'F', grade: 8, addr: '3230 S Dayfield Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(312) 288-9818' },
  { bsaId: '141918697', first: 'Isaac', last: 'Hall', gender: 'M', grade: 7, addr: '4474 S New York Ave', city: 'St Francis', state: 'WI', zip: '53235', phone: '(414) 241-7322' },
  { bsaId: '141051652', first: 'Xavier', last: 'Juchemich', gender: 'M', grade: 8, addr: '2552 S Clement Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 861-5419' },
  { bsaId: '14522108', first: 'Jameson', last: 'Kimble', gender: 'M', grade: 9, addr: '3144 S Logan Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 378-9901' },
  { bsaId: '13456567', first: 'Solomon', last: 'Rader', gender: 'M', grade: 9, addr: '3229 S Adams Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 704-4334' },
  { bsaId: '14668873', first: 'Violet', last: 'Babby', gender: 'F', grade: 10, addr: '5225 S 13th St Unit E', city: 'Milwaukee', state: 'WI', zip: '53221', phone: '(414) 331-9559' },
  { bsaId: '135769439', first: 'Quinn', last: 'Barry', gender: 'M', grade: 9, addr: '1702 E Iron St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 839-9987' },
  { bsaId: '140926310', first: 'Oscar', last: 'Belle', gender: 'M', grade: 9, addr: '3260 S Lenox St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 403-9932' },
  { bsaId: '14275773', first: 'Anita', last: 'Bendre', gender: 'F', grade: 12, addr: '4534 N Morris Blvd', city: 'Milwaukee', state: 'WI', zip: '53211', phone: '(414) 803-9974' },
  { bsaId: '140928286', first: 'Henry', last: 'Ellerman', gender: 'M', grade: 9, addr: '4035 N Newhall St', city: 'Shorewood', state: 'WI', zip: '53211', phone: '(414) 530-7071' },
  { bsaId: '13447806', first: 'Robert', last: 'Haessley', gender: 'M', grade: 9, addr: '5214 S Nicholson Ave', city: 'Cudahy', state: 'WI', zip: '53110', phone: '(414) 795-7485' },
  { bsaId: '137196478', first: 'Lucy', last: 'Lyden', gender: 'F', grade: 10, addr: '336 E Plainfield Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 232-3801' },
  { bsaId: '13949042', first: 'Damian', last: 'Nikolaus', gender: 'M', grade: 8, addr: '123 W Waterford Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 467-5369' },
  { bsaId: '141247320', first: 'Lee', last: 'Pasek', gender: 'M', grade: 8, addr: '3373 N 46th St', city: 'Milwaukee', state: 'WI', zip: '53216', phone: '(414) 379-3506' },
  { bsaId: '140180818', first: 'Anjali', last: 'Sankpal-Tatera', gender: 'F', grade: 9, addr: '4463 N Bartlett Ave', city: 'Shorewood', state: 'WI', zip: '53211', phone: null },
  { bsaId: '135769323', first: 'Myles', last: 'Maciejewski', gender: 'M', grade: 10, addr: '3355 S Pennsylvania Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(001) 414-6882' },
  { bsaId: '135712626', first: 'Oliver', last: 'Kosmoski', gender: 'M', grade: 9, addr: '2622 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(612) 616-1469' },
  { bsaId: '140437658', first: 'Finn', last: 'Paltzer', gender: 'M', grade: 10, addr: '3472 S 12th St', city: 'Milwaukee', state: 'WI', zip: '53215', phone: '(262) 388-1909' },
  { bsaId: '12977879', first: 'Hazel', last: 'Stollenwerk', gender: 'F', grade: 9, addr: '3037 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 704-0427' },
  { bsaId: '14275787', first: 'Veronica', last: 'Kleinfeldt', gender: 'F', grade: 11, addr: '3090 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 699-7898' },
  { bsaId: '135656240', first: 'Rose', last: 'Manning', gender: 'F', grade: 9, addr: '535 N 52nd St', city: 'Milwaukee', state: 'WI', zip: '53208', phone: '(414) 763-2347' },
  { bsaId: '135769355', first: 'Jack', last: 'Porter', gender: 'M', grade: 10, addr: '3117 S Delaware Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 731-0206' },
  { bsaId: '136178519', first: 'Oliver', last: 'Vest', gender: 'M', grade: 10, addr: '2915 S Herman St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 803-9131' },
  { bsaId: '135769214', first: 'Kevin', last: 'Pieper', gender: 'M', grade: 11, addr: '324 N Pinecrest St', city: 'Milwaukee', state: 'WI', zip: '53208', phone: '(414) 581-3737' },
  { bsaId: '14275791', first: 'Maya', last: 'Sankpal-Tatera', gender: 'F', grade: 11, addr: '4463 N Bartlett Ave', city: 'Shorewood', state: 'WI', zip: '53211', phone: '(414) 915-6423' }
];

/** A01 (Maya) already promoted to adult in prod — roster grade is stale, skip grade/gradyear only. */
const SKIP_GRADE_BSA_IDS = new Set(['14275791']);

interface RosterAdult {
  code: string;
  isNew: boolean;
  name: string;
  bsaId: string;
  addr: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  gender: 'M' | 'F';
  role: string;
  yptExpiration: string; // MM/DD/YYYY
}

/** Explicit code map instead of fuzzy name matching — only 13 adults in scope. */
const ADULTS: RosterAdult[] = [
  { code: 'MBa', isNew: false, name: 'Michael L Babby', bsaId: '74028', addr: '5225 S 13th St Unit E', city: 'Milwaukee', state: 'WI', zip: '53221', phone: '(414) 331-9559', gender: 'M', role: 'Assistant Scoutmaster', yptExpiration: '03/21/2027' },
  { code: 'PB', isNew: false, name: 'Patrick A Bieser', bsaId: '72549', addr: '1572 E Capitol Dr', city: 'Milwaukee', state: 'WI', zip: '53211', phone: '(414) 915-6423', gender: 'M', role: 'Assistant Scoutmaster, Key 3 Delegate', yptExpiration: '05/12/2027' },
  { code: 'TB', isNew: true, name: 'Tyler Brauhn', bsaId: '14621313', addr: '2735 S Quincy Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(630) 269-8066', gender: 'M', role: 'Chartered Organization Rep.', yptExpiration: '05/26/2027' },
  { code: 'JK', isNew: false, name: 'Jack S Kosmoski', bsaId: '135712627', addr: '2622 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(612) 616-1469', gender: 'M', role: 'Committee Chair, Registration Inquiry, COR/CUR Delegate', yptExpiration: '05/18/2027' },
  { code: 'KrP', isNew: true, name: 'Kristin Paltzer', bsaId: '140437640', addr: '3472 S 12th St', city: 'Milwaukee', state: 'WI', zip: '53215', phone: '(262) 388-1909', gender: 'F', role: 'Committee Member', yptExpiration: '08/11/2026' },
  { code: 'LMP', isNew: false, name: 'Lisa M Pieper', bsaId: '135769215', addr: '324 N Pinecrest St', city: 'Milwaukee', state: 'WI', zip: '53208', phone: '(414) 581-3737', gender: 'F', role: 'Committee Member', yptExpiration: '05/31/2027' },
  { code: 'JP', isNew: false, name: 'Jason D Porter', bsaId: '13590373', addr: '3117 S Delaware Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 731-0207', gender: 'M', role: 'Assistant Scoutmaster, Key 3 Delegate, Registration Inquiry', yptExpiration: '05/26/2027' },
  { code: 'MP', isNew: true, name: 'Michelle Porter', bsaId: '135769356', addr: '3117 S Delaware Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 731-0206', gender: 'F', role: 'Committee Member', yptExpiration: '01/17/2027' },
  { code: 'MR', isNew: true, name: 'Melissa Rader', bsaId: '13456541', addr: '3229 S Adams Ave', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 704-4334', gender: 'F', role: 'Unit Advancement Chair, Committee Member, Key 3 Delegate', yptExpiration: '05/06/2027' },
  { code: 'TR', isNew: true, name: 'Tim Radtke', bsaId: '13696557', addr: '4163 W Hilltop Ln', city: 'Franklin', state: 'WI', zip: '53132', phone: '(847) 254-6884', gender: 'M', role: 'Committee Member', yptExpiration: '07/03/2026' },
  { code: 'MS', isNew: false, name: 'Mindy Stollenwerk', bsaId: '12977875', addr: '3037 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 704-0427', gender: 'F', role: 'Scoutmaster', yptExpiration: '06/23/2027' },
  { code: 'BV', isNew: false, name: 'Becky L Vest', bsaId: '140226262', addr: '2915 S Herman St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 467-3147', gender: 'F', role: 'Committee Member', yptExpiration: '05/13/2027' },
  { code: 'NV', isNew: false, name: 'Nate C Vest', bsaId: '136178520', addr: '2915 S Herman St', city: 'Milwaukee', state: 'WI', zip: '53207', phone: '(414) 803-9131', gender: 'M', role: 'Committee Member', yptExpiration: '02/04/2027' }
];

// ── CSV helper ────────────────────────────────────────────────────────────

function csvEscape(s: unknown): string {
  const v = s === null || s === undefined ? '' : String(s);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeCSV(path: string, header: string[], rows: unknown[][]) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Target: ${SUPABASE_URL}${APPLY ? '  (APPLY)' : '  (dry run)'}\n`);

  const { data: dbScouts, error: scoutErr } = await supabase
    .from('scouts')
    .select('id, first_name, last_name, active, bsa_member_id, gender, graduation_year');
  if (scoutErr) throw new Error(`fetch scouts: ${scoutErr.message}`);

  const { data: dbLeaders, error: leaderErr } = await supabase
    .from('leaders')
    .select('code, name, role, bsa_member_id, ypt_completed');
  if (leaderErr) throw new Error(`fetch leaders: ${leaderErr.message}`);

  const byBsaId = new Map(dbScouts!.filter((s) => s.bsa_member_id).map((s) => [s.bsa_member_id, s]));
  const byName = new Map(
    dbScouts!.map((s) => [`${s.first_name} ${s.last_name}`.toLowerCase(), s])
  );

  const notes: string[][] = [];
  const scoutUpdates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const y of YOUTH) {
    const match = byBsaId.get(y.bsaId) ?? byName.get(`${y.first} ${y.last}`.toLowerCase());
    if (!match) {
      notes.push(['scout-unmatched', `${y.first} ${y.last}`, y.bsaId, 'no matching scout row locally']);
      continue;
    }
    if (!match.active) {
      notes.push(['active-mismatch', match.id, `${y.first} ${y.last}`, 'on current Scoutbook roster but marked inactive locally']);
    }
    const patch: Record<string, unknown> = {
      gender: y.gender,
      address_line1: y.addr,
      city: y.city,
      state: y.state,
      zip: y.zip,
      phone: y.phone
    };
    if (!match.bsa_member_id) patch.bsa_member_id = y.bsaId;
    if (!SKIP_GRADE_BSA_IDS.has(y.bsaId)) {
      patch.graduation_year = gradYearFromGrade(y.grade, REPORT_DATE);
    } else {
      notes.push(['grade-skipped', match.id, `${y.first} ${y.last}`, 'already promoted to adult in prod; roster grade stale']);
    }
    scoutUpdates.push({ id: match.id, patch });
  }

  const dbLeaderByCode = new Map(dbLeaders!.map((l) => [l.code, l]));
  const leaderUpdates: { code: string; patch: Record<string, unknown> }[] = [];
  const leaderInserts: Record<string, unknown>[] = [];

  for (const a of ADULTS) {
    const ypt_completed = yptCompletedFromExpiration(a.yptExpiration);
    if (a.isNew) {
      leaderInserts.push({
        code: a.code,
        name: a.name,
        role: a.role,
        address_line1: a.addr,
        city: a.city,
        state: a.state,
        zip: a.zip,
        phone: a.phone,
        is_person: true,
        bsa_member_id: a.bsaId,
        ypt_completed
      });
      continue;
    }
    const existing = dbLeaderByCode.get(a.code);
    if (!existing) {
      notes.push(['leader-code-not-found', a.code, a.name, 'expected existing leader row not found']);
      continue;
    }
    const patch: Record<string, unknown> = {
      address_line1: a.addr,
      city: a.city,
      state: a.state,
      zip: a.zip,
      phone: a.phone,
      bsa_member_id: a.bsaId,
      ypt_completed
    };
    if (!existing.role) {
      patch.role = a.role;
    } else if (existing.role !== a.role) {
      notes.push(['role-conflict', a.code, existing.role, `roster says: "${a.role}" — not auto-changed`]);
    }
    leaderUpdates.push({ code: a.code, patch });
  }

  // Leaders in DB not present on the current roster at all (informational only).
  const rosterCodes = new Set(ADULTS.map((a) => a.code));
  for (const l of dbLeaders!) {
    const isStructural = ['Camp', 'Clinic', 'Event', 'Lead', 'Outing', 'Prior', 'Project', 'T105', 'T118', 'T61', 'Turner'].includes(l.code);
    if (isStructural) continue;
    if (!rosterCodes.has(l.code)) {
      notes.push(['not-on-current-roster', l.code, l.name, 'has a leader row but is absent from this Scoutbook roster export']);
    }
  }

  // ── Report ──
  console.log(`Scouts: ${scoutUpdates.length} updates prepared (${YOUTH.length} on roster)`);
  console.log(`Leaders: ${leaderUpdates.length} updates, ${leaderInserts.length} new inserts prepared`);
  console.log(`Notes: ${notes.length} flagged items\n`);
  for (const [kind, a, b, c] of notes) console.log(`  [${kind}] ${a} — ${b} — ${c}`);

  writeCSV(join(REPORTS_DIR, 'roster-import-notes.csv'), ['kind', 'a', 'b', 'c'], notes);
  console.log(`\nWrote ${join(REPORTS_DIR, 'roster-import-notes.csv')}`);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to mutate the DB.');
    return;
  }

  console.log('\nApplying changes …');
  for (const u of scoutUpdates) {
    const { error } = await supabase.from('scouts').update(u.patch).eq('id', u.id);
    if (error) throw new Error(`update scout ${u.id}: ${error.message}`);
  }
  for (const u of leaderUpdates) {
    const { error } = await supabase.from('leaders').update(u.patch).eq('code', u.code);
    if (error) throw new Error(`update leader ${u.code}: ${error.message}`);
  }
  if (leaderInserts.length) {
    const { error } = await supabase.from('leaders').insert(leaderInserts);
    if (error) throw new Error(`insert leaders: ${error.message}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nImport failed:');
  console.error(err);
  process.exit(1);
});
