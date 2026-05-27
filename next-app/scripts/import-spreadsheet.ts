/**
 * One-shot importer: converts the troop's master ledger spreadsheet into
 * Supabase rows.
 *
 * Run:
 *   npm run import-spreadsheet -- --xlsx="d:/path/to/file.xlsx"           (dry run)
 *   npm run import-spreadsheet -- --xlsx="d:/path/to/file.xlsx" --apply   (mutates)
 *
 * Behavior:
 *   1. Replaces the seeded sample scouts with the real roster (SID is the
 *      scout.id, e.g. 'A01'). Fixes "Damian Nickolaus" → C07.
 *   2. Upserts merit_badges so the catalog covers every badge in the
 *      spreadsheet. Existing rows are preserved; only scoutbook_id is filled
 *      in when missing.
 *   3. Truncates ledger_entries and re-inserts from the spreadsheet, using
 *      the canonical type mapping (see TYPE_MAP below).
 *   4. Infers each scout's current_rank from their highest rank_award row.
 *   5. Writes three CSV reports next to the input file:
 *        - import-reports/unmatched-scouts.csv
 *        - import-reports/unmatched-mbs.csv
 *        - import-reports/skipped-rows.csv
 *
 * NOT idempotent in the "merge" sense — every --apply run replaces the
 * ledger and scouts wholesale.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

// ── Args ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true;
const XLSX_PATH = args.xlsx as string | undefined;
if (!XLSX_PATH) {
  console.error('Usage: import-spreadsheet --xlsx="<path-to-xlsx>" [--apply]');
  process.exit(1);
}
const REPORTS_DIR =
  (args['reports-dir'] as string | undefined) ??
  join(dirname(XLSX_PATH), 'import-reports');

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY && APPLY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY required with --apply. Put it in .env.local.'
  );
  process.exit(1);
}
const supabase = SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// ── Mappings ──────────────────────────────────────────────────────────────

interface RawRow {
  DateCompleted: Date | string | null;
  LeaderApprovedBy: string | null;
  ScoutName: string | null;
  RID: string | null;
  SID: string | null;
  FirstName: string | null;
  LastName: string | null;
  MemberID: number | string | null;
  Concat: string | null;
  Sort: string | null;
  AdvancementType: string | null;
  AdvancementID: number | string | null;
  Advancement: number | string | null;
  Approved: number | null;
  CounselorApprovedBy: string | null;
  CounselorApprovedDate: Date | null;
  LeaderApprovedDate: Date | null;
  MarkedCompletedBy: string | null;
  DateApproved: string | null;
  RankMb: string | null;
  Requirement: string | null;
  Created: Date | null;
  By: string | null;
}

/** AdvancementType + Rank/MB → our ledger_kind enum. */
const RANK_REQ_TYPES: Record<string, string> = {
  'Eagle Requirement': 'eagle',
  'Life Requirement': 'life',
  'Star Requirement': 'star',
  'First Class Rank Requirement': 'first-class',
  'Second Class Rank Requirement': 'second-class',
  'Tenderfoot Rank Requirement': 'tenderfoot',
  'Scout Rank Requirement': 'scout'
};

/** Spreadsheet display name → catalog id alias. */
const MB_SLUG_ALIAS: Record<string, string> = {
  'citizenship-in-community': 'citizenship-community',
  'citizenship-in-the-community': 'citizenship-community',
  'citizenship-in-nation': 'citizenship-nation',
  'citizenship-in-the-nation': 'citizenship-nation',
  'citizenship-in-society': 'citizenship-society',
  'citizenship-in-world': 'citizenship-world',
  'citizenship-in-the-world': 'citizenship-world',
  'signs-signals': 'signs-signals-codes'
};

const RANK_SORT: Record<string, number> = {
  scout: 1,
  tenderfoot: 2,
  'second-class': 3,
  'first-class': 4,
  star: 5,
  life: 6,
  eagle: 7
};

const RANK_NAME_TO_ID: Record<string, string> = {
  Scout: 'scout',
  Tenderfoot: 'tenderfoot',
  'Second Class': 'second-class',
  'First Class': 'first-class',
  Star: 'star',
  Life: 'life',
  Eagle: 'eagle'
};

/** Spreadsheet name typos → canonical SID. Confirmed by the user 2026-05-26. */
const NAME_TYPO_FIX: { firstName: string; lastName: string; sid: string }[] = [
  { firstName: 'Xavier',  lastName: 'Juhemich',         sid: 'D01' },
  { firstName: 'Damian',  lastName: 'Nickolaus',        sid: 'C07' },
  { firstName: 'Damian',  lastName: 'Nicolaus',         sid: 'C07' },
  { firstName: 'Anjali',  lastName: 'Sankpal-Tetera',   sid: 'A02' }
];

/**
 * Sign-off code (LeaderApprovedBy column) re-mapping. Some legacy values
 * were typos or freeform text; this normalizes them to leaders-table codes.
 * Values not in the map pass through unchanged. NULL signals "drop the
 * sign-off, leave the row with no `by`."
 *
 * Confirmed by the user 2026-05-26.
 */
const BY_REMAP: Record<string, string | null> = {
  HpOrse: 'Clinic',
  JM: 'KM',
  'Lisa Pieper': 'LMP',
  '??': 'BV',
  '?': null,
  Family: null,
  KTB: null,
  RP: null,
  Service: null
};

function normalizeBy(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s in BY_REMAP) return BY_REMAP[s];
  return s;
}

function findTypoFix(first: string, last: string): string | null {
  for (const f of NAME_TYPO_FIX) {
    if (f.firstName === first && f.lastName === last) return f.sid;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}

function slugify(s: string): string {
  return s
    .replace(/\*/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normCode(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === '#N/A') return null;
  const s = String(v).trim();
  // Strip trailing ".0" from spreadsheet numerics like 1.0, 2.0
  return s.replace(/\.0+$/, '') || null;
}

function dateToISO(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  // Try parsing as date string
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    if (yy.length === 4 && +yy > 2100) return null; // bogus year like 0254
    return `${yy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return null;
}

function cleanMemberID(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === '#N/A') return null;
  const s = String(v);
  return s.replace(/\.0+$/, '');
}

function readWorkbook(path: string): RawRow[] {
  const wb = XLSX.readFile(path, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: null
  });
  return rows.map((r) => ({
    DateCompleted: (r['DateCompleted'] as Date | string | null) ?? null,
    LeaderApprovedBy: (r['LeaderApprovedBy'] as string | null) ?? null,
    ScoutName: (r['Scout Name'] as string | null) ?? null,
    RID: (r['RID'] as string | null) ?? null,
    SID: (r['SID'] as string | null) ?? null,
    FirstName: (r['FirstName'] as string | null) ?? null,
    LastName: (r['LastName'] as string | null) ?? null,
    MemberID: (r['MemberID'] as number | string | null) ?? null,
    Concat: (r['Concat'] as string | null) ?? null,
    Sort: (r['Sort'] as string | null) ?? null,
    AdvancementType: (r['AdvancementType'] as string | null) ?? null,
    AdvancementID: (r['AdvancementID'] as number | string | null) ?? null,
    Advancement: (r['Advancement'] as number | string | null) ?? null,
    Approved: (r['Approved'] as number | null) ?? null,
    CounselorApprovedBy: (r['CounselorApprovedBy'] as string | null) ?? null,
    CounselorApprovedDate: (r['CounselorApprovedDate'] as Date | null) ?? null,
    LeaderApprovedDate: (r['LeaderApprovedDate'] as Date | null) ?? null,
    MarkedCompletedBy: (r['MarkedCompletedBy'] as string | null) ?? null,
    DateApproved: (r['DateApproved'] as string | null) ?? null,
    RankMb: (r['Rank / MB'] as string | null) ?? null,
    Requirement: (r['Requirement'] as string | null) ?? null,
    Created: (r['Created'] as Date | null) ?? null,
    By: (r['By'] as string | null) ?? null
  }));
}

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

// ── Phase A: Scouts ───────────────────────────────────────────────────────

interface ScoutAccum {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  bsa_member_id: string | null;
}

function isOrphanSid(sid: string): boolean {
  return !sid || sid === '#N/A';
}

function extractScouts(rows: RawRow[]): {
  scouts: ScoutAccum[];
  reassigned: Map<string, number>; // "FirstName LastName → SID" → count
} {
  const seen = new Map<string, ScoutAccum>();
  const reassigned = new Map<string, number>();
  for (const r of rows) {
    const rawSid = (r.SID ?? '').trim();
    const first = (r.FirstName ?? '').trim();
    const last = (r.LastName ?? '').trim();
    if (isOrphanSid(rawSid)) {
      const fix = findTypoFix(first, last);
      if (fix) {
        const key = `${first} ${last} → ${fix}`;
        reassigned.set(key, (reassigned.get(key) ?? 0) + 1);
      }
      // Always: don't add orphan rows as new scouts.
      continue;
    }
    if (seen.has(rawSid)) continue;
    if (!first && !last) continue;
    seen.set(rawSid, {
      id: rawSid,
      first_name: first,
      last_name: last,
      display_name: `${first} ${last}`.trim(),
      bsa_member_id: cleanMemberID(r.MemberID)
    });
  }
  return {
    scouts: Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id)),
    reassigned
  };
}

// ── Phase B: Merit Badges ─────────────────────────────────────────────────

interface MbCatalogEntry {
  id: string;
  name: string;
  eagle: boolean;
  scoutbook_id: string | null;
}

function extractMbs(rows: RawRow[]): {
  toUpsert: MbCatalogEntry[];
  aliasUsed: { from: string; to: string }[];
} {
  const map = new Map<string, MbCatalogEntry>();
  const aliasUsed: { from: string; to: string }[] = [];
  for (const r of rows) {
    if (r.AdvancementType !== 'meritbadge') continue;
    const rawName = (r.Advancement as string | null)?.toString().trim();
    if (!rawName) continue;
    const eagle = rawName.endsWith('*');
    const cleanName = rawName.replace(/\*$/, '').trim();
    const baseSlug = slugify(rawName);
    const finalSlug = MB_SLUG_ALIAS[baseSlug] ?? baseSlug;
    if (finalSlug !== baseSlug) {
      aliasUsed.push({ from: baseSlug, to: finalSlug });
    }
    if (!map.has(finalSlug)) {
      const advId = normCode(r.AdvancementID);
      map.set(finalSlug, {
        id: finalSlug,
        name: cleanName,
        eagle,
        scoutbook_id: advId
      });
    }
  }
  return {
    toUpsert: Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id)),
    aliasUsed
  };
}

function resolveMbId(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  const baseSlug = slugify(String(rawName));
  return MB_SLUG_ALIAS[baseSlug] ?? baseSlug;
}

// ── Phase C: Ledger ───────────────────────────────────────────────────────

interface LedgerInsert {
  scout_id: string;
  date: string | null;
  kind: string;
  code: string;
  label: string | null;
  by: string | null;
  qty: number;
  unit: string;
  entered_by: string | null;
  entered_at: string | null;
}

function buildLedgerRows(
  rows: RawRow[],
  scoutIds: Set<string>
): {
  inserts: LedgerInsert[];
  skipped: { row: number; reason: string; sid: string | null; concat: string | null }[];
  rankAwardsByScout: Map<string, string>; // scout_id → highest rank id earned
} {
  const inserts: LedgerInsert[] = [];
  const skipped: {
    row: number;
    reason: string;
    sid: string | null;
    concat: string | null;
  }[] = [];
  const rankAwards = new Map<string, string>();

  rows.forEach((r, idx) => {
    const rowNum = idx + 2; // header is row 1
    let sid = (r.SID ?? '').trim();
    const first = (r.FirstName ?? '').trim();
    const last = (r.LastName ?? '').trim();
    if (isOrphanSid(sid)) {
      const fix = findTypoFix(first, last);
      if (fix) {
        sid = fix;
      } else {
        skipped.push({
          row: rowNum,
          reason: `Orphan SID with no typo fix for '${first} ${last}'`,
          sid: r.SID,
          concat: r.Concat
        });
        return;
      }
    }
    if (!sid || !scoutIds.has(sid)) {
      skipped.push({
        row: rowNum,
        reason: `Unknown scout SID '${sid}'`,
        sid: r.SID,
        concat: r.Concat
      });
      return;
    }
    const date = dateToISO(r.DateCompleted);
    if (!date) {
      skipped.push({
        row: rowNum,
        reason: `Bad/missing DateCompleted: ${r.DateCompleted}`,
        sid,
        concat: r.Concat
      });
      return;
    }

    const advType = (r.AdvancementType ?? '').trim();
    const adv = r.Advancement;
    const req = r.Requirement;

    let kind: string | null = null;
    let code: string | null = null;
    let unit = 'complete';

    if (advType in RANK_REQ_TYPES) {
      const rank = RANK_REQ_TYPES[advType];
      const reqCode = normCode(adv) ?? '';
      kind = 'rank_requirement';
      code = `${rank}-${reqCode}`;
      unit = 'complete';
    } else if (advType === 'rank') {
      const rankDisplay = (adv as string | null)?.toString().trim();
      const rankId = rankDisplay ? RANK_NAME_TO_ID[rankDisplay] : null;
      if (!rankId) {
        skipped.push({
          row: rowNum,
          reason: `Unknown rank name '${rankDisplay}'`,
          sid,
          concat: r.Concat
        });
        return;
      }
      kind = 'rank_award';
      code = rankId;
      unit = 'award';
      // Track highest rank earned per scout
      const prev = rankAwards.get(sid);
      const prevSort = prev ? RANK_SORT[prev] ?? 0 : 0;
      if ((RANK_SORT[rankId] ?? 0) > prevSort) rankAwards.set(sid, rankId);
    } else if (advType === 'meritbadge') {
      const mbId = resolveMbId(adv as string | null);
      kind = 'merit_badge_award';
      code = mbId ? `MB:${mbId}` : `MB:${slugify(String(adv ?? ''))}`;
      unit = 'award';
    } else if (advType === 'award') {
      const awardSlug = slugify(String(adv ?? r.RID ?? ''));
      kind = 'award';
      code = `AW:${awardSlug}`;
      unit = 'award';
    } else if (advType === 'Activity') {
      // Spreadsheet "Activity" rows are all troop campouts (per troop convention,
      // confirmed 2026-05-26). Each scout's attendance is credited as 2 nights
      // of camping. RIDs always begin with "Act"; we keep the EV: prefix on
      // the code so the original event ID is preserved.
      kind = 'camping_nights';
      code = `EV:${r.RID ?? slugify(String(req ?? ''))}`;
      unit = 'nights';
    } else if (advType === 'Service Project') {
      // Spreadsheet "Service Project" rows are credited at 2 hours each (per
      // troop convention, confirmed 2026-05-26). The spreadsheet itself does
      // not track per-project hours.
      kind = 'service_hours';
      code = `SP:${r.RID ?? slugify(String(req ?? ''))}`;
      unit = 'hours';
    } else if (advType === 'Leadership') {
      kind = 'leadership';
      const posSlug = slugify(String(req ?? r.RID ?? ''));
      code = posSlug || (r.RID ?? 'leadership');
      unit = 'term';
    } else {
      skipped.push({
        row: rowNum,
        reason: `Unmapped AdvancementType '${advType}'`,
        sid,
        concat: r.Concat
      });
      return;
    }

    inserts.push({
      scout_id: sid,
      date,
      kind,
      code,
      label: req ? String(req).trim() : null,
      by: normalizeBy(r.LeaderApprovedBy as string | null),
      qty: kind === 'camping_nights' || kind === 'service_hours' ? 2 : 1,
      unit,
      entered_by: r.By ? String(r.By).trim() : null,
      entered_at: r.Created ? new Date(r.Created).toISOString() : null
    });
  });

  return { inserts, skipped, rankAwardsByScout: rankAwards };
}

// ── DB writes ─────────────────────────────────────────────────────────────

async function writeScouts(scouts: ScoutAccum[], inferredRanks: Map<string, string>) {
  if (!supabase) return;
  // Wipe existing scouts (cascades to ledger_entries via FK). We're about to
  // insert a fresh ledger too, so this is intentional.
  const { error: delErr } = await supabase.from('scouts').delete().not('id', 'is', null);
  if (delErr) throw new Error(`truncate scouts: ${delErr.message}`);

  const rows = scouts.map((s) => ({
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    display_name: s.display_name,
    patrol: null,
    current_rank: inferredRanks.get(s.id) ?? null,
    bsa_member_id: s.bsa_member_id,
    active: true,
    joined_date: null,
    last_activity: null
  }));
  const { error } = await supabase.from('scouts').insert(rows);
  if (error) throw new Error(`insert scouts: ${error.message}`);
}

async function writeMbs(mbs: MbCatalogEntry[]) {
  if (!supabase) return;
  for (const m of mbs) {
    const { data: existing } = await supabase
      .from('merit_badges')
      .select('id, scoutbook_id, eagle, name')
      .eq('id', m.id)
      .maybeSingle();
    if (existing) {
      // Update scoutbook_id if not already set; don't overwrite name/eagle
      // since existing rows may have been hand-edited.
      const patch: Record<string, unknown> = {};
      if (!existing.scoutbook_id && m.scoutbook_id) patch.scoutbook_id = m.scoutbook_id;
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('merit_badges').update(patch).eq('id', m.id);
        if (error) throw new Error(`update mb ${m.id}: ${error.message}`);
      }
    } else {
      const { error } = await supabase.from('merit_badges').insert({
        id: m.id,
        name: m.name,
        eagle: m.eagle,
        scoutbook_id: m.scoutbook_id,
        bsa_page_url: null,
        workbook_url: null
      });
      if (error) throw new Error(`insert mb ${m.id}: ${error.message}`);
    }
  }
}

async function writeLedger(inserts: LedgerInsert[]) {
  if (!supabase) return;
  // Caller is responsible for wiping ledger_entries before this is called
  // (we need to wipe it before scouts to respect FK constraint).
  const BATCH = 500;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const slice = inserts.slice(i, i + BATCH);
    const { error } = await supabase.from('ledger_entries').insert(slice);
    if (error) {
      throw new Error(`insert ledger batch ${i}-${i + slice.length}: ${error.message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const xlsxPath = resolve(XLSX_PATH!);
  console.log(`Reading ${xlsxPath} …`);
  const raw = readWorkbook(xlsxPath);
  console.log(`  ${raw.length} rows loaded`);

  console.log('\nPhase A: Extracting scouts …');
  const { scouts, reassigned } = extractScouts(raw);
  console.log(`  ${scouts.length} unique scouts`);
  for (const [key, count] of reassigned.entries())
    console.log(`  · Typo fix (${count}×): ${key}`);

  console.log('\nPhase B: Extracting merit badges …');
  const { toUpsert: mbs, aliasUsed } = extractMbs(raw);
  console.log(`  ${mbs.length} unique badges from spreadsheet`);
  const aliasCount = new Map<string, number>();
  for (const a of aliasUsed) aliasCount.set(a.from + ' → ' + a.to, (aliasCount.get(a.from + ' → ' + a.to) ?? 0) + 1);
  for (const [k, n] of aliasCount.entries()) console.log(`  · alias applied (${n}×): ${k}`);

  console.log('\nPhase C: Building ledger rows …');
  const scoutIds = new Set(scouts.map((s) => s.id));
  const { inserts, skipped, rankAwardsByScout } = buildLedgerRows(raw, scoutIds);
  console.log(`  ${inserts.length} ledger rows ready, ${skipped.length} skipped`);

  console.log('\nPhase D: Inferring current_rank from rank_award rows …');
  console.log(`  ${rankAwardsByScout.size} scouts have at least one rank award`);

  // Kind distribution preview
  const byKind = new Map<string, number>();
  for (const r of inserts) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  console.log('\nKind distribution:');
  for (const [k, n] of Array.from(byKind.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(6)}  ${k}`);
  }

  // Write reports
  console.log(`\nWriting reports to ${REPORTS_DIR} …`);
  writeCSV(
    join(REPORTS_DIR, 'skipped-rows.csv'),
    ['row', 'reason', 'sid', 'concat'],
    skipped.map((s) => [s.row, s.reason, s.sid, s.concat])
  );
  writeCSV(
    join(REPORTS_DIR, 'scouts.csv'),
    ['id', 'first_name', 'last_name', 'bsa_member_id', 'inferred_rank'],
    scouts.map((s) => [
      s.id,
      s.first_name,
      s.last_name,
      s.bsa_member_id,
      rankAwardsByScout.get(s.id) ?? ''
    ])
  );
  writeCSV(
    join(REPORTS_DIR, 'merit-badges.csv'),
    ['id', 'name', 'eagle', 'scoutbook_id'],
    mbs.map((m) => [m.id, m.name, m.eagle, m.scoutbook_id])
  );
  console.log(`  · skipped-rows.csv (${skipped.length} rows)`);
  console.log(`  · scouts.csv (${scouts.length} rows)`);
  console.log(`  · merit-badges.csv (${mbs.length} rows)`);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to mutate the DB.');
    return;
  }
  if (!supabase) throw new Error('Supabase client not configured.');

  console.log('\nApplying changes to Supabase …');
  console.log(`  Target: ${SUPABASE_URL}`);
  // Wipe ledger first to release FK to scouts.
  console.log('  · Wiping ledger_entries …');
  const { error: delLedgerErr } = await supabase
    .from('ledger_entries')
    .delete()
    .not('id', 'is', null);
  if (delLedgerErr) throw new Error(`truncate ledger_entries: ${delLedgerErr.message}`);
  console.log('  · Wiping + inserting scouts …');
  await writeScouts(scouts, rankAwardsByScout);
  console.log('  · Upserting merit_badges …');
  await writeMbs(mbs);
  console.log('  · Inserting ledger rows …');
  await writeLedger(inserts);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nImport failed:');
  console.error(err);
  process.exit(1);
});
