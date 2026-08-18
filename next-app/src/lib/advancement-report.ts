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

/** Static, not DB-sourced — BSA rank names are a fixed 7-item taxonomy, same
 *  spirit as RANK_ORDER itself. Requirement rows only ever carry the rank id
 *  (never a display name — see loadAdvancementEntries), so this is the only
 *  way buildReport (pure, no DB access) can show "Second Class" instead of
 *  "second-class" in a section header. */
export const RANK_LABELS: Record<string, string> = {
  scout: 'Scout',
  tenderfoot: 'Tenderfoot',
  'second-class': 'Second Class',
  'first-class': 'First Class',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

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
  /** The underlying ledger_entries.id — threaded through so a downstream
   *  action (e.g. Court of Honor's "mark presented on publish") can target
   *  the exact row, not re-derive it by re-querying scout/kind/code/date at
   *  a later point in time when the ledger may have changed. */
  id: number;
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

/**
 * Standing facts about a scout that outlive any single report period —
 * "have they EVER earned this rank/badge, full stop" — as distinct from
 * "did they earn it in the same window this report happens to cover."
 * Patrick, 2026-08-17: the period-scoped check alone (rows.ts's own award
 * rows) missed the common case of a leader backfilling an old requirement
 * signoff for a rank/badge the scout completed long ago, in an unrelated
 * report period — that's still noise, and standing is what actually
 * answers "has this scout already earned it," not the report's own window.
 */
export interface ScoutStanding {
  /** scoutId -> current rank id (a RANK_ORDER member), trigger-maintained
   *  live off rank_award ledger rows (see recompute_scout_current_rank) —
   *  reliable, never manually set. Absent scoutId = no rank earned yet. */
  currentRank: Map<string, string>;
  /** "scoutId::badgeGroupName" — every merit badge this scout has EVER
   *  been awarded, any date, not scoped to this report's window. */
  everEarnedBadges: Set<string>;
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
/** Single-date convenience over the same rule, for a group award line
 *  (rank/badge earned, leadership, other) where there's exactly one entry
 *  and no join to a ReqLine to route through entriesForScoutSlot(). */
export function isDateOutOfRange(date: string, range: ReportRange): boolean {
  return date < range.startDate || date > range.endDate;
}

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
export function buildReport(rows: AdvancementEntry[], standing?: ScoutStanding): AdvancementReport {
  const rankAwardRows = rows.filter((r) => rowIsRankAward(r));
  const badgeAwardRows = rows.filter((r) => rowIsBadgeAward(r));
  // groupAward keys/orders ranksEarned on RANK_ORDER's id space (loader
  // guarantees rank_award rows' `group` is the rank id, matching
  // rank_requirement) — remap to the pretty label only after grouping, so
  // the RANK_ORDER intersection above still matches.
  const ranksEarned = groupAward(rankAwardRows, RANK_ORDER, false).map((g) => ({
    ...g,
    name: RANK_LABELS[g.name] ?? g.name
  }));
  const badgesEarned = groupAward(badgeAwardRows, null, true);

  // Noise reduction (Patrick, 2026-08-17, corrected same day per Patrick's
  // "still seeing individual requirements" report): an individual
  // requirement sign-off is redundant once the scout has earned the full
  // rank/badge it belongs to — EVER, not just in this same reporting
  // period. The period-scoped check below (this period's own award rows)
  // is kept as a fast-path/fallback, but `standing` (current_rank + an
  // all-time badge-award set, both un-scoped by report window — see
  // ScoutStanding) is the check that actually matches what Patrick asked
  // for: a leader backfilling a Tenderfoot requirement signoff eight
  // months after the scout made Tenderfoot must not resurrect that
  // requirement as if it were still open. Suppress only that scout's rows
  // for that specific rank/badge; a different scout in the same group, or
  // the same scout's requirements for a rank/badge they have NOT earned
  // (the normal in-progress case), are untouched.
  const earnedRankKeys = new Set(rankAwardRows.map((r) => `${r.scoutId}::${r.group}`));
  const earnedBadgeKeys = new Set(badgeAwardRows.map((r) => `${r.scoutId}::${r.group}`));
  const rankOrderIds = RANK_ORDER as readonly string[];

  function rankAlreadyEarned(scoutId: string, rankId: string): boolean {
    if (earnedRankKeys.has(`${scoutId}::${rankId}`)) return true;
    const current = standing?.currentRank.get(scoutId);
    if (!current) return false;
    const currentIdx = rankOrderIds.indexOf(current);
    const reqIdx = rankOrderIds.indexOf(rankId);
    // Sequential progression: holding a later rank proves every earlier
    // one (including this one) is already done.
    return currentIdx >= 0 && reqIdx >= 0 && reqIdx <= currentIdx;
  }
  function badgeAlreadyEarned(scoutId: string, badgeGroup: string): boolean {
    return earnedBadgeKeys.has(`${scoutId}::${badgeGroup}`) || (standing?.everEarnedBadges.has(`${scoutId}::${badgeGroup}`) ?? false);
  }

  const rankReqRows = rows.filter((r) => rowIsRankReq(r) && !rankAlreadyEarned(r.scoutId, r.group));
  const rankReqs: RankReqGroup[] = (RANK_ORDER as readonly string[])
    .map((rank) => {
      const rankRows = rankReqRows.filter((r) => r.group === rank);
      return {
        rank,
        rankLabel: RANK_LABELS[rank] ?? rank,
        lines: consolidateGroup(rankRows)
      };
    })
    .filter((g) => g.lines.length > 0);

  const badgeReqRows = rows.filter((r) => rowIsBadgeReq(r) && !badgeAlreadyEarned(r.scoutId, r.group));
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
    mbAward: badgeAwardRows.length,
    rankAward: rankAwardRows.length,
    leadership: rows.filter((r) => rowIsKind(r, 'leadership')).length,
    other: rows.filter((r) => rowIsKind(r, 'award')).length + logisticsRows.length,
    total: 0
  };
  // Sum-of-parts, not rows.length — suppression means the two can now
  // legitimately differ (a suppressed requirement row is still in `rows`
  // but no longer counted anywhere in the visible report).
  counts.total =
    counts.mbReq + counts.rankReq + counts.mbAward + counts.rankAward + counts.leadership + counts.other;

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

// ── editing: remove a scout from a group/line ──────────────────────────────
// Ported from the prototype's removeScoutFromReport(), keyed on scoutId
// (see module header) instead of scout name. Mutates the report in place —
// the caller (a Server Action) re-derives content_md from the result before
// saving, same "regenerate, never hand-edit markdown" rule as everywhere
// else in this module.

// A group's key (badge/rank display name) is NOT unique across sections —
// e.g. a scout finishing a badge's last requirement in the same report
// period they're awarded that badge shows up in both badgeReqs['Camping']
// and badgesEarned['Camping']. `section` is required (not inferred by
// probing sections in order) so a Remove click can never hit the wrong
// section for a same-named group — found via qa-lead review 2026-08-17
// before this shipped: probing order silently deleted the wrong entry.
export type RemoveScoutSection = 'ranksEarned' | 'badgesEarned' | 'rankReqs' | 'badgeReqs' | 'leadership' | 'otherAwards';

export interface RemoveScoutTarget {
  scoutId: string;
  section: RemoveScoutSection;
  groupKey: string;
  /** Present only for a req-line removal (rank/badge requirements); absent
   *  for an award/leadership/other group, which has no lines to disambiguate. */
  lineKey?: string;
}

export function removeScoutFromReport(report: AdvancementReport, target: RemoveScoutTarget): void {
  function stripFromAwardGroups(groups: AwardGroup[]): boolean {
    for (const g of groups) {
      if (g.name !== target.groupKey) continue;
      const idx = g.scoutIds.indexOf(target.scoutId);
      if (idx > -1) {
        g.scoutIds.splice(idx, 1);
        g.scoutNames.splice(idx, 1);
        g.entries.splice(idx, 1);
        return true;
      }
    }
    return false;
  }
  function stripFromReqGroups(groups: (RankReqGroup | BadgeReqGroup)[]): boolean {
    for (const g of groups) {
      const key = 'rank' in g ? g.rank : g.badge;
      if (key !== target.groupKey) continue;
      for (const line of g.lines) {
        if (target.lineKey && line.codes.join(',') !== target.lineKey) continue;
        const idx = line.scoutIds.indexOf(target.scoutId);
        if (idx > -1) {
          line.scoutIds.splice(idx, 1);
          line.scoutNames.splice(idx, 1);
          line.entries.splice(idx, 1);
          return true;
        }
      }
    }
    return false;
  }

  let removed = false;
  switch (target.section) {
    case 'ranksEarned':
      removed = stripFromAwardGroups(report.ranksEarned);
      if (removed) report.counts.rankAward--;
      break;
    case 'badgesEarned':
      removed = stripFromAwardGroups(report.badgesEarned);
      if (removed) report.counts.mbAward--;
      break;
    case 'rankReqs':
      removed = stripFromReqGroups(report.rankReqs);
      if (removed) report.counts.rankReq--;
      break;
    case 'badgeReqs':
      removed = stripFromReqGroups(report.badgeReqs);
      if (removed) report.counts.mbReq--;
      break;
    case 'leadership':
      removed = stripFromAwardGroups(report.leadership);
      if (removed) report.counts.leadership--;
      break;
    case 'otherAwards':
      removed = stripFromAwardGroups(report.otherAwards);
      if (removed) report.counts.other--;
      break;
  }
  if (removed) report.counts.total--;

  // Prune now-empty lines/groups.
  for (const g of report.rankReqs) g.lines = g.lines.filter((l) => l.scoutIds.length > 0);
  for (const g of report.badgeReqs) g.lines = g.lines.filter((l) => l.scoutIds.length > 0);
  report.rankReqs = report.rankReqs.filter((g) => g.lines.length > 0);
  report.badgeReqs = report.badgeReqs.filter((g) => g.lines.length > 0);
  report.ranksEarned = report.ranksEarned.filter((g) => g.scoutIds.length > 0);
  report.badgesEarned = report.badgesEarned.filter((g) => g.scoutIds.length > 0);
  report.leadership = report.leadership.filter((g) => g.scoutIds.length > 0);
  report.otherAwards = report.otherAwards.filter((g) => g.scoutIds.length > 0);
  report.isEmpty =
    !report.ranksEarned.length &&
    !report.badgesEarned.length &&
    !report.rankReqs.length &&
    !report.badgeReqs.length &&
    !report.leadership.length &&
    !report.otherAwards.length;
}

// ── markdown rendering (the single derived-cache format) ──────────────────

export function formatMonthDayYear(iso: string): string {
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

export interface ToMarkdownOptions {
  /** Default true. The title/date/note preamble belongs in the Bugle
   *  export (a standalone document) but is redundant on-site, where the
   *  page itself already renders its own H1, dateline, and note box —
   *  found live testing the real page before shipping: without this, the
   *  category view showed the date range and note twice. Pass false when
   *  rendering the category view in either React surface. */
  includeHeader?: boolean;
}

export function toMarkdown(
  report: AdvancementReport,
  range: ReportRange,
  note: string | null,
  opts: ToMarkdownOptions = {}
): string {
  const includeHeader = opts.includeHeader ?? true;
  const lines: string[] = [];
  if (includeHeader) {
    const rangeLabel = `${formatMonthDayYear(range.startDate)} – ${formatMonthDayYear(range.endDate)}`;
    lines.push('# Weekly Advancement Report');
    lines.push(`*${rangeLabel}*`);
    if (note) {
      lines.push('');
      lines.push(`> ${note}`);
    }
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
      // Blank line + a real heading (not a bare italic line) — found live,
      // 2026-08-17 (Patrick): with no blank line before it, a line
      // immediately following a list is "lazy continuation" in CommonMark
      // and gets silently absorbed into the previous rank's last requirement
      // line instead of starting a new block, so the report read as one
      // undifferentiated wall going straight from e.g. Archery into
      // Astronomy into Chess with no visible header change. A heading
      // always breaks out of the preceding list regardless of spacing —
      // more robust than just adding the blank line alone.
      lines.push('');
      lines.push(`### ${g.rankLabel}`);
      g.lines.forEach(reqLineMd);
    }
  }
  if (report.badgeReqs.length) {
    lines.push('');
    lines.push('## Merit Badge Requirements Completed');
    for (const g of report.badgeReqs) {
      lines.push('');
      lines.push(`### ${g.badgeLabel}${g.eagle ? ' (Eagle-required)' : ''}`);
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

export interface RawLedgerRow {
  id: number;
  scout_id: string;
  kind: string;
  code: string;
  label: string | null;
  qty: number;
  unit: string;
  date: string;
  entered_at: string;
}

/** Shared by loadAdvancementEntries and the Court of Honor loader — a
 *  rank_award/merit_badge_award row shapes the SAME way regardless of which
 *  report is asking for it, and this is exactly the logic that had a real
 *  bug (2026-08-17: display name vs id in `group`) — one implementation
 *  means that class of bug can only exist in one place, not silently
 *  diverge between two copies. */
export function shapeRankAwardRow(
  r: RawLedgerRow,
  scoutName: string,
  rankLabelById: Map<string, string>
): AdvancementEntry {
  return tagKind(
    {
      id: r.id,
      scoutId: r.scout_id,
      scoutName,
      code: r.code,
      label: rankLabelById.get(r.code) ?? r.code,
      // Rank id — MUST match rank_requirement's group (split.rankId), not
      // the display name (see the loader's own note on this exact bug).
      group: r.code,
      eagle: false,
      enteredAt: r.entered_at.slice(0, 10),
      date: r.date,
      detail: null
    },
    'rank_award'
  );
}

export function shapeBadgeAwardRow(
  r: RawLedgerRow,
  scoutName: string,
  mbById: Map<string, { name: string; eagle: boolean }>
): AdvancementEntry {
  const mbId = r.code.startsWith('MB:') ? r.code.slice(3) : r.code;
  const mb = mbById.get(mbId);
  return tagKind(
    {
      id: r.id,
      scoutId: r.scout_id,
      scoutName,
      code: mbId,
      label: mb?.name ?? mbId,
      group: mb?.name ?? mbId,
      eagle: mb?.eagle ?? false,
      enteredAt: r.entered_at.slice(0, 10),
      date: r.date,
      detail: null
    },
    'merit_badge_award'
  );
}

/** Strip trailing junk punctuation left over from historical spreadsheet
 *  imports ("Totin' Chip.", "Firem'n Chit.") — same light cleanup the skill
 *  already does for non-rank/badge labels, not a full rewrite. */
function cleanLabel(label: string): string {
  return label.replace(/[.*]+$/, '').trim();
}

/**
 * `entered_by` values known to mark a historical migration/backfill batch
 * rather than a real leader recording something in real time (Patrick,
 * 2026-08-17 investigation: ~75% of the active ledger — 7,164 of 9,565 rows
 * — carries one of these, confirmed by every one of them landing on an
 * exact round-hour timestamp, which real usage essentially never does).
 * `entered_at` on these rows reflects when the data was migrated into
 * Supabase, not when it was recorded — exactly the distinction this
 * feature's whole "filter on entered, not earned" design depends on, so a
 * report generated over a range spanning one of these migration dates would
 * otherwise surface the ENTIRE historical batch as if it happened that
 * week. Excluded at the query level — this is a report-scoping concern, not
 * part of the ledger's own correctness, so nothing else about these rows
 * (the fast-entry ledger, scout profiles, MB progress) is touched.
 *
 * A `NOT IN` filter against this list also excludes NULL entered_by rows
 * for free (confirmed empirically, 2026-08-17: SQL's three-valued logic —
 * neither `x IN (...)` nor `NOT (x IN (...))` is ever TRUE for NULL x — no
 * separate `.not.is(null)` clause needed).
 */
const IMPORT_BATCH_ENTERED_BY = ['PB', 'Import', 'pbieser-import'];

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
      .select('id, scout_id, kind, code, label, qty, unit, date, entered_at')
      .in('kind', kinds)
      .gte('entered_at', startInclusive)
      .lte('entered_at', endExclusive)
      .is('archived_at', null)
      .is('deleted_at', null)
      .not('entered_by', 'in', `(${IMPORT_BATCH_ENTERED_BY.join(',')})`)
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
      out.push(shapeRankAwardRow(r, scoutName, rankLabelById));
    } else if (r.kind === 'merit_badge_award') {
      out.push(shapeBadgeAwardRow(r, scoutName, mbById));
    } else if (r.kind === 'rank_requirement') {
      const split = splitRankCode(r.code);
      if (!split) continue;
      out.push(
        tagKind(
          {
            id: r.id,
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
            id: r.id,
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
            id: r.id,
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

/**
 * Standing facts for the noise-reduction rule (see ScoutStanding) —
 * deliberately un-scoped by report window: current_rank (trigger-maintained
 * off rank_award ledger rows, see recompute_scout_current_rank) and every
 * merit badge ever awarded to these scouts, any date. Same
 * archived/deleted-null convention as loadAdvancementEntries and every
 * other query in this module (Convention confirmed against scout_summary
 * view and the MB progress page — no date bound is the established pattern
 * for "has this scout ever earned X," not something invented here).
 */
export async function loadScoutStanding(supabase: SupabaseClient, scoutIds: string[]): Promise<ScoutStanding> {
  if (scoutIds.length === 0) return { currentRank: new Map(), everEarnedBadges: new Set() };

  const [{ data: scoutRows }, mbAwardRows, { data: mbRows }] = await Promise.all([
    supabase.from('scouts').select('id, current_rank').in('id', scoutIds),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_entries')
        .select('scout_id, code')
        .eq('kind', 'merit_badge_award')
        .in('scout_id', scoutIds)
        .is('archived_at', null)
        .is('deleted_at', null)
        .range(from, to)
    ),
    supabase.from('merit_badges').select('id, name')
  ]);

  const currentRank = new Map<string, string>();
  for (const s of (scoutRows ?? []) as { id: string; current_rank: string | null }[]) {
    if (s.current_rank) currentRank.set(s.id, s.current_rank);
  }

  const mbNameById = new Map(((mbRows ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const everEarnedBadges = new Set<string>();
  for (const r of mbAwardRows) {
    const mbId = r.code.startsWith('MB:') ? r.code.slice(3) : r.code;
    const name = mbNameById.get(mbId);
    if (name) everEarnedBadges.add(`${r.scout_id}::${name}`);
  }

  return { currentRank, everEarnedBadges };
}

/** One-shot: load + build, what the admin's "Generate" action calls. */
export async function generateAdvancementReport(
  supabase: SupabaseClient,
  range: ReportRange
): Promise<AdvancementReport> {
  const entries = await loadAdvancementEntries(supabase, range);
  const scoutIds = Array.from(new Set(entries.map((e) => e.scoutId)));
  const standing = await loadScoutStanding(supabase, scoutIds);
  return buildReport(entries, standing);
}
