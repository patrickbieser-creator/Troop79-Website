/**
 * Weekly Advancement Report — consolidation/grouping logic and the query
 * that loads real ledger rows into the shape it consumes
 * (Plans/Weekly-Advancement-Report.md).
 *
 * PORTED FROM THE PROTOTYPE, NOT RE-DERIVED. `consolidateGroup()`,
 * `groupAward()`, `datesOutOfRange()`, `entriesForScoutSlot()`, `buildReport()`,
 * `buildScoutView()`, and `toMarkdown()` are adapted from
 * `prototypes/advancement-report/assets/advancement-data.js`, which was
 * built and tested against real heavy-week volume (681 merit-badge-requirement
 * rows, 113 rank-requirement rows) before this file existed — tech-lead
 * review, 2026-08-17: treat that file as the reference implementation, not
 * this plan's prose.
 *
 * ONE REAL DEVIATION FROM THE PROTOTYPE, DELIBERATE: the prototype's
 * "identity" for a scout throughout consolidation is the scout's NAME
 * (fine for synthetic fictional data with no collisions). This app has a
 * real internal scout id (`scouts.id`) and real names CAN collide — every
 * scoutId/scoutName pair here keys on id, name is carried only for display.
 * Grep `scoutId` if porting a prototype function and it looks different
 * from advancement-data.js — that's why.
 *
 * SECTION 5 GROUPING is a query-shaping choice, not part of the ported
 * consolidation algorithm — the prototype's synthetic data generator always
 * picks one qty per synthetic event and bakes it into the group name
 * ("6 nights — Summer Camp"), which real data doesn't respect (confirmed
 * against production: the same camping event has scouts logged at both 6
 * and 4 nights). Here, section 5 groups by the cleaned label alone and
 * carries each scout's own qty/unit as a per-entry `detail` string
 * ("6 nights") rendered next to their name — same visual result for the
 * common case, correct for the mixed-qty case the prototype's data never
 * exercised.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';

export const RANK_ORDER = [
  'scout',
  'tenderfoot',
  'second-class',
  'first-class',
  'star',
  'life',
  'eagle'
] as const;

/** kind values that make up Section 5 — Leadership & Other (Decision 3,
 *  2026-08-17: logistics kinds ARE in scope, not "advancement only"). */
const SECTION5_KINDS = [
  'leadership',
  'award',
  'service_hours',
  'camping_nights',
  'hiking_miles'
] as const;

export interface AdvancementEntry {
  scoutId: string;
  scoutName: string;
  /** Bare requirement code ("9a") for req lines; rank/badge id for award
   *  lines; the ledger row's own code for section 5. */
  code: string;
  label: string;
  /** Rank display name / badge name / role or award label — already
   *  resolved to its canonical form, never the raw ledger label for
   *  ranks/badges (that field carries messy historical import text —
   *  confirmed against production: "Citizenship in World*.",
   *  "Star. Complete a Board of Review..."). */
  group: string;
  eagle: boolean;
  /** yyyy-mm-dd the leader recorded this — the ONLY field every query
   *  filters on. Never displayed directly; see datesOutOfRange(). */
  enteredAt: string;
  /** yyyy-mm-dd the scout actually did this. */
  date: string;
  /** Section-5 only: "6 nights", "4 hours" — qty+unit carried per-entry
   *  rather than baked into the group, since real scouts can log different
   *  quantities for the same named event. */
  detail: string | null;
}

export interface ReqLine {
  codes: string[];
  labels: string[];
  scoutIds: string[];
  scoutNames: string[];
  /** 1:1 with scoutIds for a shared or single-solo line; for a consolidated
   *  line (one scout, several joined codes) this holds one entry per code —
   *  see entriesForScoutSlot(). */
  entries: AdvancementEntry[];
}

export interface AwardGroup {
  name: string;
  eagle: boolean;
  scoutIds: string[];
  scoutNames: string[];
  /** 1:1 with scoutIds. */
  entries: AdvancementEntry[];
}

export interface RankReqGroup {
  rank: string;
  rankLabel: string;
  lines: ReqLine[];
}

export interface BadgeReqGroup {
  badge: string;
  badgeLabel: string;
  eagle: boolean;
  lines: ReqLine[];
}

export interface AdvancementReport {
  ranksEarned: AwardGroup[];
  badgesEarned: AwardGroup[];
  rankReqs: RankReqGroup[];
  badgeReqs: BadgeReqGroup[];
  leadership: AwardGroup[];
  otherAwards: AwardGroup[];
  counts: {
    mbReq: number;
    rankReq: number;
    mbAward: number;
    rankAward: number;
    leadership: number;
    other: number;
    total: number;
  };
  isEmpty: boolean;
}

export interface ReportRange {
  startDate: string;
  endDate: string;
}

/** Every scout appearing anywhere in a report, alphabetical, everything
 *  they earned grouped under their name instead of by category — Decision
 *  8 (2026-08-17). Reorganizes the SAME AdvancementReport, no second query. */
export interface ScoutViewRecord {
  scoutId: string;
  scoutName: string;
  ranksEarned: { name: string; entry: AdvancementEntry }[];
  badgesEarned: { name: string; eagle: boolean; entry: AdvancementEntry }[];
  rankReqsByRank: { rank: string; rankLabel: string; items: { line: ReqLine; scoutIdx: number }[] }[];
  badgeReqsByBadge: {
    badge: string;
    badgeLabel: string;
    eagle: boolean;
    items: { line: ReqLine; scoutIdx: number }[];
  }[];
  leadership: { name: string; entry: AdvancementEntry }[];
  otherAwards: { name: string; entry: AdvancementEntry }[];
  itemCount: number;
}

// ── sort helpers matching the skill's numeric+letter req-code order ───────

function sortKey(code: string): [number, string] {
  const m = /^(\d+)([a-z]?)$/i.exec(code);
  return m ? [parseInt(m[1], 10), m[2] || ''] : [999, ''];
}

export function cmpCode(a: string, b: string): number {
  const [an, al] = sortKey(a);
  const [bn, bl] = sortKey(b);
  return an !== bn ? an - bn : al.localeCompare(bl);
}

// ── consolidation — "per rank OR per badge", generalized from the skill ───

/**
 * groupRows: entries that share one rank or one badge (already filtered to
 * one kind). Splits into shared lines (2+ scouts on one code — always
 * separate), single-solo lines (one scout, one solo code), and consolidated
 * lines (one scout, 2+ solo codes joined onto one line). A requirement held
 * by 2+ scouts is NEVER folded into anyone's consolidated line, even if one
 * of those scouts also has solo codes elsewhere in the same rank/badge.
 */
export function consolidateGroup(groupRows: AdvancementEntry[]): ReqLine[] {
  const byCode = new Map<string, { label: string; scouts: Map<string, AdvancementEntry> }>();
  for (const r of groupRows) {
    if (!byCode.has(r.code)) byCode.set(r.code, { label: r.label, scouts: new Map() });
    const g = byCode.get(r.code)!;
    if (!g.scouts.has(r.scoutId)) g.scouts.set(r.scoutId, r); // de-dupe same scout+req
  }
  const codes = Array.from(byCode.keys()).sort(cmpCode);

  const sharedLines: ReqLine[] = [];
  const soloByScout = new Map<string, { code: string; label: string; entry: AdvancementEntry }[]>();

  for (const code of codes) {
    const g = byCode.get(code)!;
    const scoutIds = Array.from(g.scouts.keys()).sort((a, b) =>
      g.scouts.get(a)!.scoutName.localeCompare(g.scouts.get(b)!.scoutName)
    );
    if (scoutIds.length > 1) {
      sharedLines.push({
        codes: [code],
        labels: [g.label],
        scoutIds,
        scoutNames: scoutIds.map((id) => g.scouts.get(id)!.scoutName),
        entries: scoutIds.map((id) => g.scouts.get(id)!)
      });
    } else {
      const id = scoutIds[0];
      if (!soloByScout.has(id)) soloByScout.set(id, []);
      soloByScout.get(id)!.push({ code, label: g.label, entry: g.scouts.get(id)! });
    }
  }

  const singleSoloLines: ReqLine[] = [];
  const consolidatedLines: ReqLine[] = [];
  const soloScoutIds = Array.from(soloByScout.keys()).sort((a, b) =>
    soloByScout.get(a)![0].entry.scoutName.localeCompare(soloByScout.get(b)![0].entry.scoutName)
  );
  for (const scoutId of soloScoutIds) {
    const items = soloByScout.get(scoutId)!.slice().sort((a, b) => cmpCode(a.code, b.code));
    const scoutName = items[0].entry.scoutName;
    if (items.length === 1) {
      singleSoloLines.push({
        codes: [items[0].code],
        labels: [items[0].label],
        scoutIds: [scoutId],
        scoutNames: [scoutName],
        entries: [items[0].entry]
      });
    } else {
      consolidatedLines.push({
        codes: items.map((i) => i.code),
        labels: items.map((i) => i.label),
        scoutIds: [scoutId],
        scoutNames: [scoutName],
        entries: items.map((i) => i.entry)
      });
    }
  }

  return sharedLines.concat(singleSoloLines, consolidatedLines);
}

function groupAward(
  rows: AdvancementEntry[],
  order: readonly string[] | null,
  tagEagle: boolean
): AwardGroup[] {
  const map = new Map<string, { name: string; eagle: boolean; scouts: Map<string, AdvancementEntry> }>();
  for (const r of rows) {
    const k = r.group;
    if (!map.has(k)) map.set(k, { name: k, eagle: tagEagle ? r.eagle : false, scouts: new Map() });
    map.get(k)!.scouts.set(r.scoutId, r);
  }
  let names = Array.from(map.keys());
  names = order ? (order.filter((n) => map.has(n)) as string[]) : names.sort();
  return names.map((n) => {
    const g = map.get(n)!;
    const scoutIds = Array.from(g.scouts.keys()).sort((a, b) =>
      g.scouts.get(a)!.scoutName.localeCompare(g.scouts.get(b)!.scoutName)
    );
    return {
      name: n,
      eagle: g.eagle,
      scoutIds,
      scoutNames: scoutIds.map((id) => g.scouts.get(id)!.scoutName),
      entries: scoutIds.map((id) => g.scouts.get(id)!)
    };
  });
}

/** A "line" has scoutIds/scoutNames and entries that are only 1:1-aligned
 *  for shared/single-solo lines. A consolidated line (one scout, several
 *  joined codes) has one scout but one entry per code — this resolves the
 *  right entry subset for a given scout slot either way. */
export function entriesForScoutSlot(line: ReqLine, scoutIdx: number): AdvancementEntry[] {
  if (line.scoutIds.length === line.entries.length) return [line.entries[scoutIdx]];
  return line.entries; // consolidated: all entries belong to the sole scout
}

/**
 * Per-entry date display rule (Decision 4, 2026-08-17) — NOT a toggle, and
 * not "does date differ from enteredAt." Show the earned date on a line
 * ONLY when it falls outside the report's own start/end range: a backfilled
 * correction or credit for something completed long before this report
 * period. Everything earned inside the period (the vast majority of lines)
 * stays date-free.
 */
export function datesOutOfRange(entries: AdvancementEntry[], range: ReportRange): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e && e.date && (e.date < range.startDate || e.date > range.endDate)) {
      if (!out.includes(e.date)) out.push(e.date);
    }
  }
  return out.sort();
}

/** Build the full report content model from filtered, shaped rows. */
export function buildReport(rows: AdvancementEntry[]): AdvancementReport {
  const ranksEarned = groupAward(rows.filter((r) => rowIsRankAward(r)), RANK_ORDER, false);
  const badgesEarned = groupAward(rows.filter((r) => rowIsBadgeAward(r)), null, true);

  const rankReqRows = rows.filter((r) => rowIsRankReq(r));
  const rankReqs: RankReqGroup[] = (RANK_ORDER as readonly string[])
    .map((rank) => {
      const rankRows = rankReqRows.filter((r) => r.group === rank);
      return {
        rank,
        rankLabel: rankRows[0]?.group ?? rank,
        lines: consolidateGroup(rankRows)
      };
    })
    .filter((g) => g.lines.length > 0);

  const badgeReqRows = rows.filter((r) => rowIsBadgeReq(r));
  const badgesWithReqs = Array.from(new Set(badgeReqRows.map((r) => r.group))).sort();
  const badgeReqs: BadgeReqGroup[] = badgesWithReqs.map((badge) => {
    const badgeRows = badgeReqRows.filter((r) => r.group === badge);
    return {
      badge,
      badgeLabel: badge,
      eagle: badgeRows[0]?.eagle ?? false,
      lines: consolidateGroup(badgeRows)
    };
  });

  const leadership = groupAward(rows.filter((r) => rowIsKind(r, 'leadership')), null, false);
  const logisticsRows = rows.filter(
    (r) => rowIsKind(r, 'service_hours') || rowIsKind(r, 'camping_nights') || rowIsKind(r, 'hiking_miles')
  );
  const otherAwards = groupAward(rows.filter((r) => rowIsKind(r, 'award')), null, false)
    .concat(groupAward(logisticsRows, null, false))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = {
    mbReq: badgeReqRows.length,
    rankReq: rankReqRows.length,
    mbAward: rows.filter((r) => rowIsBadgeAward(r)).length,
    rankAward: rows.filter((r) => rowIsRankAward(r)).length,
    leadership: rows.filter((r) => rowIsKind(r, 'leadership')).length,
    other: rows.filter((r) => rowIsKind(r, 'award')).length + logisticsRows.length,
    total: rows.length
  };

  return {
    ranksEarned,
    badgesEarned,
    rankReqs,
    badgeReqs,
    leadership,
    otherAwards,
    counts,
    isEmpty: rows.length === 0
  };
}

// Row-kind tags are threaded through `code`'s namespace via the loader (see
// loadAdvancementEntries) rather than a separate `kind` field on
// AdvancementEntry — kept private to this module so the public type stays
// small. The loader tags each row with its section via these predicates'
// backing `__kind` property.
interface TaggedEntry extends AdvancementEntry {
  __kind?: string;
}
function rowIsKind(r: AdvancementEntry, kind: string): boolean {
  return (r as TaggedEntry).__kind === kind;
}
function rowIsRankAward(r: AdvancementEntry): boolean {
  return rowIsKind(r, 'rank_award');
}
function rowIsBadgeAward(r: AdvancementEntry): boolean {
  return rowIsKind(r, 'merit_badge_award');
}
function rowIsRankReq(r: AdvancementEntry): boolean {
  return rowIsKind(r, 'rank_requirement');
}
function rowIsBadgeReq(r: AdvancementEntry): boolean {
  return rowIsKind(r, 'merit_badge_requirement');
}

/** Attach a section tag to a shaped row — the loader calls this once per
 *  row; tests can call it directly to build fixtures without a DB. */
export function tagKind<T extends AdvancementEntry>(row: T, kind: string): T {
  (row as TaggedEntry).__kind = kind;
  return row;
}

// ── scout-centric view (Decision 8, 2026-08-17) ────────────────────────────

export function buildScoutView(report: AdvancementReport): ScoutViewRecord[] {
  const byScout = new Map<string, ScoutViewRecord>();
  function ensure(id: string, name: string): ScoutViewRecord {
    if (!byScout.has(id)) {
      byScout.set(id, {
        scoutId: id,
        scoutName: name,
        ranksEarned: [],
        badgesEarned: [],
        rankReqsByRank: [],
        badgeReqsByBadge: [],
        leadership: [],
        otherAwards: [],
        itemCount: 0
      });
    }
    return byScout.get(id)!;
  }

  report.ranksEarned.forEach((g) =>
    g.scoutIds.forEach((id, i) => ensure(id, g.scoutNames[i]).ranksEarned.push({ name: g.name, entry: g.entries[i] }))
  );
  report.badgesEarned.forEach((g) =>
    g.scoutIds.forEach((id, i) =>
      ensure(id, g.scoutNames[i]).badgesEarned.push({ name: g.name, eagle: g.eagle, entry: g.entries[i] })
    )
  );
  report.rankReqs.forEach((g) => {
    g.lines.forEach((line) => {
      line.scoutIds.forEach((id, idx) => {
        const rec = ensure(id, line.scoutNames[idx]);
        let bucket = rec.rankReqsByRank.find((b) => b.rank === g.rank);
        if (!bucket) {
          bucket = { rank: g.rank, rankLabel: g.rankLabel, items: [] };
          rec.rankReqsByRank.push(bucket);
        }
        bucket.items.push({ line, scoutIdx: idx });
      });
    });
  });
  report.badgeReqs.forEach((g) => {
    g.lines.forEach((line) => {
      line.scoutIds.forEach((id, idx) => {
        const rec = ensure(id, line.scoutNames[idx]);
        let bucket = rec.badgeReqsByBadge.find((b) => b.badge === g.badge);
        if (!bucket) {
          bucket = { badge: g.badge, badgeLabel: g.badgeLabel, eagle: g.eagle, items: [] };
          rec.badgeReqsByBadge.push(bucket);
        }
        bucket.items.push({ line, scoutIdx: idx });
      });
    });
  });
  report.leadership.forEach((g) =>
    g.scoutIds.forEach((id, i) => ensure(id, g.scoutNames[i]).leadership.push({ name: g.name, entry: g.entries[i] }))
  );
  report.otherAwards.forEach((g) =>
    g.scoutIds.forEach((id, i) => ensure(id, g.scoutNames[i]).otherAwards.push({ name: g.name, entry: g.entries[i] }))
  );

  const records = Array.from(byScout.values());
  for (const rec of records) {
    rec.rankReqsByRank.sort(
      (a, b) => (RANK_ORDER as readonly string[]).indexOf(a.rank) - (RANK_ORDER as readonly string[]).indexOf(b.rank)
    );
    rec.badgeReqsByBadge.sort((a, b) => a.badge.localeCompare(b.badge));
    for (const bucket of rec.rankReqsByRank) bucket.items.sort((a, b) => cmpCode(a.line.codes[0], b.line.codes[0]));
    for (const bucket of rec.badgeReqsByBadge) bucket.items.sort((a, b) => cmpCode(a.line.codes[0], b.line.codes[0]));
    rec.itemCount =
      rec.ranksEarned.length +
      rec.badgesEarned.length +
      rec.leadership.length +
      rec.otherAwards.length +
      rec.rankReqsByRank.reduce((n, b) => n + b.items.length, 0) +
      rec.badgeReqsByBadge.reduce((n, b) => n + b.items.length, 0);
  }
  return records.sort((a, b) => a.scoutName.localeCompare(b.scoutName));
}

// ── markdown rendering (the single derived-cache format) ──────────────────

function formatMonthDayYear(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`)
  );
}

function scoutLineMd(name: string, entries: AdvancementEntry[], range: ReportRange, detail: string | null): string {
  const out = datesOutOfRange(entries, range);
  const detailBit = detail ? ` — ${detail}` : '';
  return out.length
    ? `  - ${name}${detailBit} *(earned ${out.map(formatMonthDayYear).join(', ')})*`
    : `  - ${name}${detailBit}`;
}

export function toMarkdown(report: AdvancementReport, range: ReportRange, note: string | null): string {
  const lines: string[] = [];
  const rangeLabel = `${formatMonthDayYear(range.startDate)} – ${formatMonthDayYear(range.endDate)}`;
  lines.push('# Weekly Advancement Report');
  lines.push(`*${rangeLabel}*`);
  if (note) {
    lines.push('');
    lines.push(`> ${note}`);
  }

  if (report.isEmpty) {
    lines.push('');
    lines.push('No advancement was logged in this date range.');
    return lines.join('\n') + '\n';
  }

  function awardSection(title: string, groups: AwardGroup[]) {
    if (!groups.length) return;
    lines.push('');
    lines.push(`## ${title}`);
    for (const g of groups) {
      lines.push(`- **${g.name}**${g.eagle ? ' *(Eagle-required)*' : ''}`);
      g.scoutNames.forEach((name, i) => lines.push(scoutLineMd(name, [g.entries[i]], range, g.entries[i].detail)));
    }
  }
  function reqLineMd(line: ReqLine) {
    const head =
      line.codes.length > 1
        ? `${line.codes.join(', ')}** — ${line.labels.join(', ')}`
        : `${line.codes[0]}** — ${line.labels[0]}`;
    lines.push(`- **${head}`);
    line.scoutNames.forEach((name, i) =>
      lines.push(scoutLineMd(name, entriesForScoutSlot(line, i), range, null))
    );
  }

  awardSection('Ranks Earned', report.ranksEarned);
  awardSection('Merit Badges Earned', report.badgesEarned);

  if (report.rankReqs.length) {
    lines.push('');
    lines.push('## Rank Requirements Completed');
    for (const g of report.rankReqs) {
      lines.push(`_${g.rankLabel}_`);
      g.lines.forEach(reqLineMd);
    }
  }
  if (report.badgeReqs.length) {
    lines.push('');
    lines.push('## Merit Badge Requirements Completed');
    for (const g of report.badgeReqs) {
      lines.push(`_${g.badgeLabel}${g.eagle ? ' (Eagle-required)' : ''}_`);
      g.lines.forEach(reqLineMd);
    }
  }
  if (report.leadership.length || report.otherAwards.length) {
    lines.push('');
    lines.push('## Leadership & Other');
    if (report.leadership.length) {
      lines.push('**Leadership**');
      for (const g of report.leadership) {
        lines.push(`- **${g.name}**`);
        g.scoutNames.forEach((name, i) => lines.push(scoutLineMd(name, [g.entries[i]], range, g.entries[i].detail)));
      }
    }
    if (report.otherAwards.length) {
      lines.push('**Other**');
      for (const g of report.otherAwards) {
        lines.push(`- **${g.name}**`);
        g.scoutNames.forEach((name, i) => lines.push(scoutLineMd(name, [g.entries[i]], range, g.entries[i].detail)));
      }
    }
  }
  return lines.join('\n') + '\n';
}

// ── loading real ledger rows ───────────────────────────────────────────────

interface RawLedgerRow {
  scout_id: string;
  kind: string;
  code: string;
  label: string | null;
  qty: number;
  unit: string;
  date: string;
  entered_at: string;
}

/** Strip trailing junk punctuation left over from historical spreadsheet
 *  imports ("Totin' Chip.", "Firem'n Chit.") — same light cleanup the skill
 *  already does for non-rank/badge labels, not a full rewrite. */
function cleanLabel(label: string): string {
  return label.replace(/[.*]+$/, '').trim();
}

/**
 * Loads and shapes every ledger row entered in [startDate, endDate]
 * (inclusive) into AdvancementEntry rows, ready for buildReport().
 * Every query uses fetchAllRows() — none of these are scoped to a single
 * scout, so none of them are safe to leave unpaginated (D-028; the whole
 * point of this feature is wide catch-up ranges that can clear 1000 rows
 * on their own — tech-lead review, 2026-08-17).
 */
export async function loadAdvancementEntries(
  supabase: SupabaseClient,
  range: ReportRange
): Promise<AdvancementEntry[]> {
  const endExclusive = `${range.endDate}T23:59:59.999`;
  const startInclusive = `${range.startDate}T00:00:00`;

  const kinds = [
    'rank_award',
    'merit_badge_award',
    'rank_requirement',
    'merit_badge_requirement',
    ...SECTION5_KINDS
  ];

  const rawRows = await fetchAllRows<RawLedgerRow>((from, to) =>
    supabase
      .from('ledger_entries')
      .select('scout_id, kind, code, label, qty, unit, date, entered_at')
      .in('kind', kinds)
      .gte('entered_at', startInclusive)
      .lte('entered_at', endExclusive)
      .is('archived_at', null)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, to)
  );
  if (rawRows.length === 0) return [];

  const scoutIds = Array.from(new Set(rawRows.map((r) => r.scout_id)));
  // rank_requirement codes are the composite `{rankId}-{reqCode}` —
  // splitting needs the known rank id set (from the `ranks` table below,
  // resolved after this point), not the raw ledger codes.
  const [{ data: scoutRows }, { data: rankRows }, { data: mbRows }] = await Promise.all([
    supabase.from('scouts').select('id, display_name').in('id', scoutIds),
    supabase.from('ranks').select('id, display_name').order('sort_order'),
    supabase.from('merit_badges').select('id, name, eagle')
  ]);

  const scoutNameById = new Map(((scoutRows ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const allRankIds = ((rankRows ?? []) as { id: string; display_name: string }[]).map((r) => r.id);
  const rankLabelById = new Map(((rankRows ?? []) as { id: string; display_name: string }[]).map((r) => [r.id, r.display_name]));
  const mbById = new Map(((mbRows ?? []) as { id: string; name: string; eagle: boolean }[]).map((m) => [m.id, m]));

  function splitRankCode(code: string): { rankId: string; reqCode: string } | null {
    for (const rankId of allRankIds) {
      if (code.startsWith(`${rankId}-`)) return { rankId, reqCode: code.slice(rankId.length + 1) };
    }
    return null;
  }

  const rankReqKeys = new Set<string>();
  const mbReqKeys = new Set<string>();
  for (const r of rawRows) {
    if (r.kind === 'rank_requirement') rankReqKeys.add(r.code);
    if (r.kind === 'merit_badge_requirement') {
      // mbId is everything before the LAST hyphen-delimited requirement
      // code segment isn't safe (mb ids contain hyphens too) — same
      // ambiguity rankReqKey/splitRankReqKey solves for ranks. merit_badges
      // ids are known ahead of time from mbById, resolved below per-row.
      mbReqKeys.add(r.code);
    }
  }

  const rankReqLabels = new Map<string, string>(); // composite code -> label
  if (rankReqKeys.size > 0) {
    const rows = await fetchAllRows<{ rank_id: string; code: string; label: string }>((from, to) =>
      supabase.from('rank_requirements').select('rank_id, code, label').range(from, to)
    );
    for (const row of rows) rankReqLabels.set(`${row.rank_id}-${row.code}`, row.label);
  }
  const mbIds = Array.from(mbById.keys());
  function splitMbCode(code: string): { mbId: string; reqCode: string } | null {
    for (const mbId of mbIds) {
      if (code.startsWith(`${mbId}-`)) return { mbId, reqCode: code.slice(mbId.length + 1) };
    }
    return null;
  }
  const mbReqLabels = new Map<string, string>(); // composite code -> label
  if (mbReqKeys.size > 0) {
    const rows = await fetchAllRows<{ mb_id: string; code: string; label: string }>((from, to) =>
      supabase.from('merit_badge_requirements').select('mb_id, code, label').range(from, to)
    );
    for (const row of rows) mbReqLabels.set(`${row.mb_id}-${row.code}`, row.label);
  }

  const out: AdvancementEntry[] = [];
  for (const r of rawRows) {
    const scoutName = scoutNameById.get(r.scout_id);
    if (!scoutName) continue; // scout record missing/merged — skip rather than crash a report
    const enteredAt = r.entered_at.slice(0, 10);
    const date = r.date;

    if (r.kind === 'rank_award') {
      out.push(
        tagKind(
          {
            scoutId: r.scout_id,
            scoutName,
            code: r.code,
            label: rankLabelById.get(r.code) ?? r.code,
            group: rankLabelById.get(r.code) ?? r.code,
            eagle: false,
            enteredAt,
            date,
            detail: null
          },
          'rank_award'
        )
      );
    } else if (r.kind === 'merit_badge_award') {
      const mbId = r.code.startsWith('MB:') ? r.code.slice(3) : r.code;
      const mb = mbById.get(mbId);
      out.push(
        tagKind(
          {
            scoutId: r.scout_id,
            scoutName,
            code: mbId,
            label: mb?.name ?? mbId,
            group: mb?.name ?? mbId,
            eagle: mb?.eagle ?? false,
            enteredAt,
            date,
            detail: null
          },
          'merit_badge_award'
        )
      );
    } else if (r.kind === 'rank_requirement') {
      const split = splitRankCode(r.code);
      if (!split) continue;
      out.push(
        tagKind(
          {
            scoutId: r.scout_id,
            scoutName,
            code: split.reqCode,
            label: rankReqLabels.get(r.code) ?? split.reqCode,
            group: split.rankId,
            eagle: false,
            enteredAt,
            date,
            detail: null
          },
          'rank_requirement'
        )
      );
    } else if (r.kind === 'merit_badge_requirement') {
      const split = splitMbCode(r.code);
      if (!split) continue;
      const mb = mbById.get(split.mbId);
      out.push(
        tagKind(
          {
            scoutId: r.scout_id,
            scoutName,
            code: split.reqCode,
            label: mbReqLabels.get(r.code) ?? split.reqCode,
            group: mb?.name ?? split.mbId,
            eagle: mb?.eagle ?? false,
            enteredAt,
            date,
            detail: null
          },
          'merit_badge_requirement'
        )
      );
    } else {
      // Section 5: leadership / award / service_hours / camping_nights / hiking_miles.
      // label IS the display text here — no canonical lookup table to join.
      const label = cleanLabel(r.label ?? r.code);
      const isLogistics = r.kind === 'service_hours' || r.kind === 'camping_nights' || r.kind === 'hiking_miles';
      out.push(
        tagKind(
          {
            scoutId: r.scout_id,
            scoutName,
            code: r.code,
            label,
            group: label,
            eagle: false,
            enteredAt,
            date,
            detail: isLogistics ? `${r.qty} ${r.unit}` : null
          },
          r.kind
        )
      );
    }
  }
  return out;
}

/** One-shot: load + build, what the admin's "Generate" action calls. */
export async function generateAdvancementReport(
  supabase: SupabaseClient,
  range: ReportRange
): Promise<AdvancementReport> {
  const entries = await loadAdvancementEntries(supabase, range);
  return buildReport(entries);
}
