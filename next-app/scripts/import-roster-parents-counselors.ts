/**
 * One-shot importer: backfills scout_parents and merit_badge_counselors from
 * RosterReport_Troop0079F_Pat1_20260713.csv (ADULT MEMBERS' "Merit Badges"
 * column, and each YOUTH MEMBER row's trailing Parent/Guardian columns).
 *
 * Run:
 *   npm run import-roster-parents-counselors              (dry run)
 *   npm run import-roster-parents-counselors -- --apply   (mutates)
 *
 * scout_parents: reconciles the 3 pre-existing hand-entered rows (fixes the
 * "MIchelle Porter" typo, updates Piper Kingston/Fiona Kimble's rows to the
 * CSV's canonical values) rather than duplicating them; inserts the rest.
 * Skips Anjali Sankpal-Tatera entirely — her CSV row lists Patrick Bieser as
 * "Father of - Guardian", which is almost certainly a Scoutbook export
 * artifact (he's not her father; her sister Maya's row correctly lists
 * JamieLynn Tatera as mother). Flagged, not imported.
 *
 * merit_badge_counselors: only ADDS pairs not already in the table (per
 * user instruction — existing 10 rows, including the ones that look
 * mismatched against this CSV, are left untouched). 5 badges referenced by
 * counselors (Cycling, Hiking, Public Speaking, Programming, Engineering)
 * don't exist in the merit_badges catalog yet and are upserted first, with
 * `eagle` set to match the existing convention (Cycling/Hiking are
 * Eagle-alternative badges like Swimming/Camping → eagle=true; the other
 * three are not Eagle-required → eagle=false).
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

// ── scout_parents data ──────────────────────────────────────────────────

interface ParentRow {
  scoutBsaId: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  addr: string;
  city: string;
  state: string;
  zip: string;
  sameAsScout: boolean; // true when addr matches the scout's own address (set by import-roster.ts)
}

const PARENTS: ParentRow[] = [
  { scoutBsaId: '142155141', name: 'Michelle Alfred', relationship: 'Mom', phone: '(414) 418-6129', email: 'Michelle.farrell2@uwalumni.com', addr: '622 Crescent Ct', city: 'Wauwatosa', state: 'WI', zip: '53213', sameAsScout: true },
  { scoutBsaId: '14668873', name: 'Michael Babby', relationship: 'Dad', phone: '(414) 541-4573', email: 'mikeb@btecs.net', addr: '5225 S 13th St Unit E', city: 'Milwaukee', state: 'WI', zip: '53221', sameAsScout: true },
  { scoutBsaId: '135769439', name: 'Kevin Barry', relationship: 'Dad', phone: '(414) 839-9987', email: 'ktb331522@gmail.com', addr: '1702 E Iron St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '140926310', name: 'Kara Pitt DAndrea', relationship: 'Mom', phone: '(414) 403-9932', email: 'Karapittd@hotmail.com', addr: '3260 S Lenox St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '14275773', name: 'Nina Bendre', relationship: 'Mom', phone: '(414) 803-9974', email: 'nina.bendre@gmail.com', addr: '4534 N Morris Blvd', city: 'Shorewood', state: 'WI', zip: '53211', sameAsScout: true },
  { scoutBsaId: '14275773', name: 'Ashish Bendre', relationship: 'Parent', phone: '(414) 803-9974', email: 'ashishrbendre@yahoo.com', addr: '4534 N Morris Blvd', city: 'Milwaukee', state: 'WI', zip: '53211', sameAsScout: true },
  { scoutBsaId: '142185972', name: 'Daniel Bieser', relationship: 'Dad', phone: '(414) 828-0336', email: 'danbieser@hotmail.com', addr: '7110 Grand Pkwy', city: 'Wauwatosa', state: 'WI', zip: '53213', sameAsScout: true },
  { scoutBsaId: '141005673', name: 'Michael Black', relationship: 'Dad', phone: '(312) 288-9818', email: 'mike13589@gmail.com', addr: '7170 S Countryside Dr', city: 'Franklin', state: 'WI', zip: '53132', sameAsScout: false },
  { scoutBsaId: '140928286', name: 'Eric Ellerman', relationship: 'Dad', phone: '(414) 208-9749', email: 'eric_ellerman@yahoo.com', addr: '4035 N Newhall St', city: 'Shorewood', state: 'WI', zip: '53211', sameAsScout: true },
  { scoutBsaId: '13447806', name: 'Angela Behnke', relationship: 'Mom', phone: '(414) 795-7485', email: 'angie.behnke16@gmail.com', addr: '5214 S Nicholson Ave', city: 'Cudahy', state: 'WI', zip: '53110', sameAsScout: true },
  { scoutBsaId: '141918697', name: 'Marcia Hall', relationship: 'Mom', phone: '(414) 241-7322', email: 'mommananny@gmail.com', addr: '4474 S New York Ave', city: 'St Francis', state: 'WI', zip: '53235', sameAsScout: true },
  { scoutBsaId: '141934891', name: 'Jeremy Hooper', relationship: 'Dad', phone: '(262) 497-8819', email: 'jeremywhooper@gmail.com', addr: '1818 E Rusk Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '141051652', name: 'Sarah Juchemich', relationship: 'Mom', phone: '(414) 861-5419', email: 'sarahjuchemich@gmail.com', addr: '2552 S Clement Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '14566448', name: 'Summer Kimble', relationship: 'Mom', phone: '(414) 378-9901', email: 'summer.curtis@yahoo.com', addr: '3144 S Logan Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '14522108', name: 'Summer Kimble', relationship: 'Mom', phone: '(414) 378-9901', email: 'summer.curtis@yahoo.com', addr: '3144 S Logan Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '13706001', name: 'Kevin Barry', relationship: 'Dad', phone: '(414) 839-9987', email: 'ktb331522@gmail.com', addr: '1702 E Iron St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '14275787', name: 'Jodi Kleinfeldt', relationship: 'Mom', phone: '(414) 699-7898', email: 'jlyn60@yahoo.com', addr: '3090 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '135712626', name: 'Jack Kosmoski', relationship: 'Dad', phone: '(612) 616-1469', email: 'jack.kosmoski@gmail.com', addr: '2622 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '137196478', name: 'Rachel Lyden', relationship: 'Mom', phone: '(414) 232-3805', email: 'lydenrachel@gmail.com', addr: '336 E Plainfield Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '137196478', name: 'John Lyden', relationship: 'Dad', phone: '(414) 232-3801', email: 'batfuzz@yahoo.com', addr: '172 E Pine Hollow Ln Apt 1', city: 'Oak Creek', state: 'WI', zip: '53154', sameAsScout: false },
  { scoutBsaId: '135769323', name: 'Jennifer Brumm-Maciejewski', relationship: 'Mom', phone: '(414) 688-2786', email: 'brummjo@yahoo.com', addr: '3355 S Pennsylvania Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '135656240', name: 'Ellen Manning', relationship: 'Mom', phone: '(414) 763-2347', email: 'edmanning82@hotmail.com', addr: '535 N 52nd St', city: 'Milwaukee', state: 'WI', zip: '53208', sameAsScout: true },
  { scoutBsaId: '13949042', name: 'Adam Nikolaus', relationship: 'Dad', phone: '(414) 467-5369', email: 'ANikolaus23@gmail.com', addr: '123 W Waterford Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '140437658', name: 'Kristin Paltzer', relationship: 'Mom', phone: '(262) 388-1909', email: 'kpaltzer@gmail.com', addr: '3472 S 12th St', city: 'Milwaukee', state: 'WI', zip: '53215', sameAsScout: true },
  { scoutBsaId: '141247320', name: 'Margaret Schires', relationship: 'Mom', phone: '(414) 379-3506', email: 'mschires4@yahoo.com', addr: '3373 N 46th St', city: 'Milwaukee', state: 'WI', zip: '53216', sameAsScout: true },
  { scoutBsaId: '135769214', name: 'Lisa Pieper', relationship: 'Mom', phone: '(414) 581-3737', email: 'lmpieper@yahoo.com', addr: '324 N Pinecrest St', city: 'Milwaukee', state: 'WI', zip: '53208', sameAsScout: true },
  { scoutBsaId: '135769355', name: 'Michelle Porter', relationship: 'Mom', phone: '(414) 731-0206', email: 'mkuchinsky@gmail.com', addr: '3117 S Delaware Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '13766813', name: 'Michelle Porter', relationship: 'Mom', phone: '(414) 731-0206', email: 'mkuchinsky@gmail.com', addr: '3117 S Delaware Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '13456567', name: 'Melissa Rader', relationship: 'Mom', phone: '(414) 704-4334', email: 'penrod1975@gmail.com', addr: '3229 S Adams Ave', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '13696559', name: 'Tim Radtke', relationship: 'Dad', phone: '(847) 254-6884', email: 'timradtke.wi@gmail.com', addr: '4163 W Hilltop Ln', city: 'Franklin', state: 'WI', zip: '53132', sameAsScout: true },
  { scoutBsaId: '14623236', name: 'Sarah Reinelt', relationship: 'Mom', phone: '(414) 333-9082', email: 'sederus@uwalumni.com', addr: '2615 S Shore Dr', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '14275791', name: 'JamieLynn Tatera', relationship: 'Mom', phone: '(414) 554-0067', email: 'jamielynntat@gmail.com', addr: '4463 N Bartlett Ave', city: 'Shorewood', state: 'WI', zip: '53211', sameAsScout: true },
  { scoutBsaId: '12977879', name: 'Mindy Stollenwerk', relationship: 'Mom', phone: '(414) 704-0427', email: 'mindystollenwerk@gmail.com', addr: '3037 S Superior St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true },
  { scoutBsaId: '136178519', name: 'Nathaniel Vest', relationship: 'Dad', phone: '(414) 803-9131', email: 'ncvest@gmail.com', addr: '2915 S Herman St', city: 'Milwaukee', state: 'WI', zip: '53207', sameAsScout: true }
];

// Scouts whose existing scout_parents row should be UPDATEd, not duplicated
// (matched by scout bsa_member_id).
const RECONCILE_BSA_IDS = new Set(['14566448', '13706001', '13766813']); // Fiona Kimble, Piper Kingston, Lily Porter

const SKIPPED_ANOMALY = {
  bsaId: '140180818',
  note: 'Anjali Sankpal-Tatera — CSV lists Patrick Bieser as "Father of - Guardian", which is not accurate (he is not her father; likely a Scoutbook export artifact). Skipped — needs correct guardian entered manually.'
};

// ── merit_badge_counselors data ─────────────────────────────────────────

interface NewMb {
  id: string;
  name: string;
  eagle: boolean;
}
const NEW_MBS: NewMb[] = [
  { id: 'cycling', name: 'Cycling', eagle: true },
  { id: 'hiking', name: 'Hiking', eagle: true },
  { id: 'public-speaking', name: 'Public Speaking', eagle: false },
  { id: 'programming', name: 'Programming', eagle: false },
  { id: 'engineering', name: 'Engineering', eagle: false }
];

const COUNSELOR_PAIRS: { leaderCode: string; mbId: string }[] = [
  ...['astronomy', 'electricity', 'aviation', 'climbing', 'photography', 'game-design', 'citizenship-nation', 'first-aid', 'insect-study', 'pottery'].map((mbId) => ({ leaderCode: 'PB', mbId })),
  ...['citizenship-community', 'communication', 'cycling', 'family-life', 'public-speaking', 'personal-fitness', 'personal-management', 'small-boat-sailing', 'citizenship-world', 'electricity', 'hiking', 'citizenship-nation', 'fishing', 'camping', 'cooking'].map((mbId) => ({ leaderCode: 'JK', mbId })),
  ...['family-life', 'programming', 'hiking', 'canoeing', 'personal-management', 'kayaking', 'engineering', 'robotics'].map((mbId) => ({ leaderCode: 'LMP', mbId })),
  ...['wood-carving', 'woodwork', 'leatherwork', 'basketry'].map((mbId) => ({ leaderCode: 'NV', mbId })),
  ...['personal-fitness', 'communication', 'citizenship-community'].map((mbId) => ({ leaderCode: 'BV', mbId }))
];

async function main() {
  console.log(`Target: ${SUPABASE_URL}${APPLY ? '  (APPLY)' : '  (dry run)'}\n`);

  const { data: scouts, error: scoutErr } = await supabase.from('scouts').select('id, bsa_member_id');
  if (scoutErr) throw new Error(`fetch scouts: ${scoutErr.message}`);
  const scoutIdByBsa = new Map(scouts!.filter((s) => s.bsa_member_id).map((s) => [s.bsa_member_id, s.id]));

  const { data: existingParents, error: parentErr } = await supabase.from('scout_parents').select('id, scout_id');
  if (parentErr) throw new Error(`fetch scout_parents: ${parentErr.message}`);
  const existingParentByScoutId = new Map(existingParents!.map((p) => [p.scout_id, p.id]));

  const parentUpdates: { id: number; patch: Record<string, unknown> }[] = [];
  const parentInserts: Record<string, unknown>[] = [];

  for (const p of PARENTS) {
    const scoutId = scoutIdByBsa.get(p.scoutBsaId);
    if (!scoutId) {
      console.log(`  [unmatched] parent ${p.name} — no scout with BSA ID ${p.scoutBsaId}`);
      continue;
    }
    const row = {
      scout_id: scoutId,
      name: p.name,
      relationship: p.relationship,
      phone: p.phone,
      email: p.email,
      same_address_as_scout: p.sameAsScout,
      address_line1: p.sameAsScout ? null : p.addr,
      city: p.sameAsScout ? null : p.city,
      state: p.sameAsScout ? null : p.state,
      zip: p.sameAsScout ? null : p.zip
    };
    const existingId = RECONCILE_BSA_IDS.has(p.scoutBsaId) ? existingParentByScoutId.get(scoutId) : undefined;
    if (existingId) {
      parentUpdates.push({ id: existingId, patch: row });
    } else {
      parentInserts.push(row);
    }
  }

  console.log(`scout_parents: ${parentUpdates.length} updates (reconciling existing rows), ${parentInserts.length} inserts`);
  console.log(`  [skipped] ${SKIPPED_ANOMALY.note}\n`);

  const { data: existingMbs, error: mbErr } = await supabase.from('merit_badges').select('id');
  if (mbErr) throw new Error(`fetch merit_badges: ${mbErr.message}`);
  const existingMbIds = new Set(existingMbs!.map((m) => m.id));
  const mbsToInsert = NEW_MBS.filter((m) => !existingMbIds.has(m.id));

  const { data: existingCounselors, error: mcErr } = await supabase.from('merit_badge_counselors').select('mb_id, leader_code');
  if (mcErr) throw new Error(`fetch merit_badge_counselors: ${mcErr.message}`);
  const existingPairs = new Set(existingCounselors!.map((c) => `${c.leader_code}::${c.mb_id}`));
  const pairsToInsert = COUNSELOR_PAIRS.filter((p) => !existingPairs.has(`${p.leaderCode}::${p.mbId}`));
  const pairsSkippedAsDup = COUNSELOR_PAIRS.filter((p) => existingPairs.has(`${p.leaderCode}::${p.mbId}`));

  console.log(`merit_badges: ${mbsToInsert.length} new catalog entries needed (${mbsToInsert.map((m) => m.id).join(', ') || 'none'})`);
  console.log(`merit_badge_counselors: ${pairsToInsert.length} new pairs, ${pairsSkippedAsDup.length} already exist (skipped, left as-is)`);
  for (const p of pairsSkippedAsDup) console.log(`  [already exists] ${p.leaderCode} — ${p.mbId}`);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to mutate the DB.');
    return;
  }

  console.log('\nApplying …');
  for (const u of parentUpdates) {
    const { error } = await supabase.from('scout_parents').update(u.patch).eq('id', u.id);
    if (error) throw new Error(`update scout_parents ${u.id}: ${error.message}`);
  }
  if (parentInserts.length) {
    const { error } = await supabase.from('scout_parents').insert(parentInserts);
    if (error) throw new Error(`insert scout_parents: ${error.message}`);
  }
  if (mbsToInsert.length) {
    const { error } = await supabase.from('merit_badges').insert(
      mbsToInsert.map((m) => ({ id: m.id, name: m.name, eagle: m.eagle, scoutbook_id: null, bsa_page_url: null, workbook_url: null }))
    );
    if (error) throw new Error(`insert merit_badges: ${error.message}`);
  }
  if (pairsToInsert.length) {
    const { error } = await supabase.from('merit_badge_counselors').insert(
      pairsToInsert.map((p) => ({ mb_id: p.mbId, leader_code: p.leaderCode, sort_order: 0 }))
    );
    if (error) throw new Error(`insert merit_badge_counselors: ${error.message}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nImport failed:');
  console.error(err);
  process.exit(1);
});
