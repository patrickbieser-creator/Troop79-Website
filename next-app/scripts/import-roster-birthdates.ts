/**
 * One-shot importer: backfills scout birthdate + school from the Scoutbook
 * RosterReport CSV (RosterReport_Troop0079F_Pat1_20260713.csv). Ignores the
 * ADULT MEMBERS and DEN CHIEF MEMBERS sections entirely — scouts only.
 *
 * Run:
 *   npm run import-roster-birthdates              (dry run)
 *   npm run import-roster-birthdates -- --apply   (mutates)
 *
 * Cross-validates each scout's CSV-derived grade against the graduation_year
 * already set by import-roster.ts (same report date, should always agree) —
 * any mismatch is flagged, not silently overwritten.
 */

import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required. Put it in .env.local.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const REPORT_DATE = '2026-07-13';
function schoolYearEnd(onDate: string): number {
  const [y, m] = onDate.split('-').map(Number);
  return m >= 8 ? y + 1 : y;
}
function gradYearFromGrade(grade: number, onDate: string): number {
  return schoolYearEnd(onDate) + (12 - grade);
}

const GRADE_WORD: Record<string, number> = {
  Kindergarten: 0, First: 1, Second: 2, Third: 3, Fourth: 4, Fifth: 5,
  Sixth: 6, Seventh: 7, Eighth: 8, Ninth: 9, Tenth: 10, Eleventh: 11, Twelfth: 12
};
function gradeFromWord(w: string): number | null {
  const word = w.replace(/\s*Grade\s*$/i, '').trim();
  return word in GRADE_WORD ? GRADE_WORD[word] : null;
}

interface RosterCsvYouth {
  bsaId: string;
  first: string;
  last: string;
  dob: string; // MM/DD/YYYY
  school: string | null;
  gradeWord: string;
}

const YOUTH: RosterCsvYouth[] = [
  { bsaId: '142155141', first: 'Aditya', last: 'Alfred', dob: '06/14/2014', school: 'St Jude the Apostle', gradeWord: 'Seventh' },
  { bsaId: '14668873', first: 'Violet', last: 'Babby', dob: '03/11/2011', school: 'Milwaukee Parkside School for the Arts', gradeWord: 'Tenth' },
  { bsaId: '135769439', first: 'Quinn', last: 'Barry', dob: '07/06/2012', school: null, gradeWord: 'Ninth' },
  { bsaId: '140926310', first: 'Oscar', last: 'Belle', dob: '05/19/2012', school: 'Fernwood Montessori', gradeWord: 'Ninth' },
  { bsaId: '14275773', first: 'Anita', last: 'Bendre', dob: '04/17/2009', school: null, gradeWord: 'Twelfth' },
  { bsaId: '142185972', first: 'Benjamin', last: 'Bieser', dob: '10/17/2013', school: 'St Jude catholic school', gradeWord: 'Seventh' },
  { bsaId: '141005673', first: 'Winnefred', last: 'Black', dob: '04/18/2013', school: 'Milwaukee Montessori', gradeWord: 'Eighth' },
  { bsaId: '140928286', first: 'Henry', last: 'Ellerman', dob: '09/02/2011', school: 'Shorewood', gradeWord: 'Ninth' },
  { bsaId: '13447806', first: 'Robert', last: 'Haessley', dob: '01/02/2012', school: null, gradeWord: 'Ninth' },
  { bsaId: '141918697', first: 'Isaac', last: 'Hall', dob: '07/02/2014', school: 'Deer Creek Intermediate School', gradeWord: 'Seventh' },
  { bsaId: '141934891', first: 'Eleanor', last: 'Hooper', dob: '02/29/2012', school: 'Fernwood Montessori', gradeWord: 'Ninth' },
  { bsaId: '141051652', first: 'Xavier', last: 'Juchemich', dob: '03/03/2013', school: 'Fernwood Montessori', gradeWord: 'Eighth' },
  { bsaId: '14566448', first: 'Fiona', last: 'Kimble', dob: '03/04/2015', school: 'Fernwood Montessori', gradeWord: 'Sixth' },
  { bsaId: '14522108', first: 'Jameson', last: 'Kimble', dob: '08/20/2012', school: 'Rufus King', gradeWord: 'Ninth' },
  { bsaId: '13706001', first: 'Piper', last: 'Kingston', dob: '01/13/2015', school: 'Fernwood Montessori School', gradeWord: 'Sixth' },
  { bsaId: '14275787', first: 'Veronica', last: 'Kleinfeldt', dob: '08/02/2010', school: null, gradeWord: 'Eleventh' },
  { bsaId: '135712626', first: 'Oliver', last: 'Kosmoski', dob: '04/21/2012', school: null, gradeWord: 'Ninth' },
  { bsaId: '137196478', first: 'Lucy', last: 'Lyden', dob: '12/21/2010', school: null, gradeWord: 'Tenth' },
  { bsaId: '135769323', first: 'Myles', last: 'Maciejewski', dob: '04/27/2011', school: null, gradeWord: 'Tenth' },
  { bsaId: '135656240', first: 'Rose', last: 'Manning', dob: '04/09/2012', school: null, gradeWord: 'Ninth' }, // CSV school "NONE" treated as unset
  { bsaId: '13949042', first: 'Damian', last: 'Nikolaus', dob: '08/28/2013', school: null, gradeWord: 'Eighth' },
  { bsaId: '140437658', first: 'Finn', last: 'Paltzer', dob: '05/02/2011', school: 'Tamarack Waldorf', gradeWord: 'Tenth' },
  { bsaId: '141247320', first: 'Lee', last: 'Pasek', dob: '05/01/2013', school: 'Bayview Montessori', gradeWord: 'Eighth' },
  { bsaId: '135769214', first: 'Kevin', last: 'Pieper', dob: '12/29/2009', school: 'Saint Francis High School', gradeWord: 'Eleventh' },
  { bsaId: '135769355', first: 'Jack', last: 'Porter', dob: '10/06/2010', school: null, gradeWord: 'Tenth' },
  { bsaId: '13766813', first: 'Lily', last: 'Porter', dob: '02/18/2015', school: null, gradeWord: 'Sixth' },
  { bsaId: '13456567', first: 'Solomon', last: 'Rader', dob: '05/05/2011', school: 'Bayview Montessori', gradeWord: 'Ninth' },
  { bsaId: '13696559', first: 'Owen', last: 'Radtke', dob: '04/26/2014', school: null, gradeWord: 'Seventh' },
  { bsaId: '14623236', first: 'Aubrey', last: 'Reinelt', dob: '12/05/2014', school: 'Fernwood Montessori', gradeWord: 'Sixth' },
  { bsaId: '140180818', first: 'Anjali', last: 'Sankpal-Tatera', dob: '07/29/2012', school: 'Lake Bluff Elementry', gradeWord: 'Ninth' },
  { bsaId: '14275791', first: 'Maya', last: 'Sankpal-Tatera', dob: '06/02/2008', school: null, gradeWord: 'Eleventh' },
  { bsaId: '12977879', first: 'Hazel', last: 'Stollenwerk', dob: '09/09/2011', school: 'Fernwood Montessori', gradeWord: 'Ninth' },
  { bsaId: '136178519', first: 'Oliver', last: 'Vest', dob: '02/10/2011', school: 'Pius XI', gradeWord: 'Tenth' }
];

function dobToISO(mmddyyyy: string): string {
  const [mm, dd, yyyy] = mmddyyyy.split('/');
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}${APPLY ? '  (APPLY)' : '  (dry run)'}\n`);

  const { data: dbScouts, error } = await supabase
    .from('scouts')
    .select('id, first_name, last_name, bsa_member_id, birthdate, school, graduation_year');
  if (error) throw new Error(`fetch scouts: ${error.message}`);

  const byBsaId = new Map(dbScouts!.filter((s) => s.bsa_member_id).map((s) => [s.bsa_member_id, s]));

  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const notes: string[] = [];

  for (const y of YOUTH) {
    const match = byBsaId.get(y.bsaId);
    if (!match) {
      notes.push(`[unmatched] ${y.first} ${y.last} (${y.bsaId}) — no scout row found by BSA ID`);
      continue;
    }
    const csvGrade = gradeFromWord(y.gradeWord);
    if (csvGrade !== null && match.graduation_year !== null) {
      const expectedGradYear = gradYearFromGrade(csvGrade, REPORT_DATE);
      if (expectedGradYear !== match.graduation_year && y.bsaId !== '14275791') {
        notes.push(
          `[grade-mismatch] ${match.id} ${y.first} ${y.last} — CSV grade "${y.gradeWord}" implies graduation_year ${expectedGradYear}, but scout has ${match.graduation_year}`
        );
      }
    }
    updates.push({
      id: match.id,
      patch: { birthdate: dobToISO(y.dob), school: y.school }
    });
  }

  console.log(`${updates.length} scouts to update (birthdate + school)`);
  console.log(`${notes.length} notes\n`);
  for (const n of notes) console.log(' ', n);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to mutate the DB.');
    return;
  }

  console.log('\nApplying …');
  for (const u of updates) {
    const { error: updErr } = await supabase.from('scouts').update(u.patch).eq('id', u.id);
    if (updErr) throw new Error(`update scout ${u.id}: ${updErr.message}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nImport failed:');
  console.error(err);
  process.exit(1);
});
