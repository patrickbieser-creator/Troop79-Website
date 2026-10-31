/**
 * Meeting Planner III placement (Plans/Meeting-Planner-III.md): plan a meeting from its focus, then fill the gaps.
 *
 * Every active scout lands in a group: the rank they're working on (Scout through First Class), or, holding First
 * Class or above, the Merit badge group, where each one teaches or takes one of the night's badges. A group exists
 * only when the focus has something for it, so a night can be all merit badges. The checklist's columns are the
 * focus items; an open one (a white cell; done is green) is one the scout hasn't finished. A counted scout with nothing
 * open and no hand choice is a gap.
 *
 * Computed on every read, never stored: a sign-off at Fast Entry shows on the next load. Only the planners' choices
 * (`roles`) are inputs from the database. Pure: no I/O, no framework imports.
 */
import { buildReqTree, type ReqNode } from '@/lib/mb-helpers';
import { mbNodeSatisfied, rankNodeSatisfied } from '@/lib/rank-calculus';
import type { CatalogMeritBadge, CatalogMeritBadgeRequirement, CatalogRank, CatalogRankRequirement } from '@/lib/advancement-catalog';
import type { Intent } from '@/lib/meeting-board-shared';

/** A requirement's minutes until a leader sets its time (meeting-board-picklist's DEFAULT_TEACH_MINUTES; not imported,
 *  since that module imports this one). */
const DEFAULT_TEACH_MINUTES = 15;

/** The ranks with a group of their own. A scout holding First Class or above is in the Merit badge group. */
export const GROUP_RANKS: readonly string[] = ['scout', 'tenderfoot', 'second-class', 'first-class'];

const RANK_GROUP_PREFIX = 'fr:';
const BADGE_GROUP_PREFIX = 'fr:mb:';

/** A rank group's key: 'fr:tenderfoot'. */
export const rankGroupKey = (rankId: string) => `${RANK_GROUP_PREFIX}${rankId}`;
/** A merit badge group's key: 'fr:mb:first-aid'. */
export const badgeGroupKey = (mbId: string) => `${BADGE_GROUP_PREFIX}${mbId}`;
export const isBadgeGroupKey = (key: string) => key.startsWith(BADGE_GROUP_PREFIX);
export const isGroupKey = (key: string) => key.startsWith(RANK_GROUP_PREFIX);

/** The most groups one rank (or badge) can be split into (Plans/Meeting-Planner-III-Split-Groups.md). */
export const MAX_SECTIONS = 3;
const SECTION_SEP = '~';

/** A split group's key: Group 1 is the base key itself ('fr:tenderfoot'), Group 2 'fr:tenderfoot~2'. */
export const sectionGroupKey = (base: string, n: number) => (n === 1 ? base : `${base}${SECTION_SEP}${n}`);

export interface ParsedGroupKey {
  base: string;
  section: number;
  kind: 'rank' | 'badge';
  refId: string;
}

/** The one parser for group keys: everything after 'fr:' / 'fr:mb:' is an id plus an optional '~2' / '~3'. Null for a
 *  key that isn't a group, or names a section that can't exist ('~1', '~4'). */
export function parseGroupKey(key: string): ParsedGroupKey | null {
  if (!isGroupKey(key)) return null;
  const at = key.lastIndexOf(SECTION_SEP);
  const base = at < 0 ? key : key.slice(0, at);
  const section = at < 0 ? 1 : Number(key.slice(at + 1));
  if (!Number.isInteger(section) || section < 1 || section > MAX_SECTIONS || (at >= 0 && section === 1)) return null;
  const badge = isBadgeGroupKey(base);
  const refId = base.slice(badge ? BADGE_GROUP_PREFIX.length : RANK_GROUP_PREFIX.length);
  return refId ? { base, section, kind: badge ? 'badge' : 'rank', refId } : null;
}

/** A merged rank reads its Group 2 and 3 keys as the one group (the soft merge): every group-key read goes through
 *  this, so a hand move, pick, helper or teacher on '~2' counts for the merged group and comes back on Split. */
export function canonicalGroupKey(key: string, mergedBases: ReadonlySet<string> | undefined): string {
  const p = mergedBases?.size ? parseGroupKey(key) : null;
  return p && p.section > 1 && mergedBases!.has(p.base) ? p.base : key;
}

export interface FocusScout {
  personId: number;
  scoutId: string;
  name: string;
  currentRank: string | null;
  intent: Intent | null;
}

export interface FocusProgress {
  /** Rank requirement leaves on the ledger: 'tenderfoot-4a.1'. */
  rankCodes: ReadonlySet<string>;
  /** Merit badge requirement leaves on the ledger: 'first-aid-1a'. */
  mbCodes: ReadonlySet<string>;
  /** Badges earned (mb_progress.awarded). An earned badge is done whatever its requirements show: many were earned
   *  before (or outside) the troop's requirement-level ledger. */
  awardedMbs?: ReadonlySet<string>;
}

/** A planner's hand choice for one scout at one meeting. No choice = placement decides. */
export type ScoutRole =
  /** Teaches or helps teach. */
  | { role: 'teach' }
  /** Moved by hand into a rank or badge group (a gap fill, or an older scout's badge). */
  | { role: 'group'; key: string }
  /** Placed in a class from requests and offers; `key` is that topic. */
  | { role: 'request'; key: string }
  /** Unassigned (Patrick, 2026-10-30): in no group tonight, and placement doesn't put them back. */
  | { role: 'none' };

export interface FocusInput {
  ranks: readonly CatalogRank[];
  rankReqs: readonly CatalogRankRequirement[];
  meritBadges: readonly CatalogMeritBadge[];
  mbReqs: readonly CatalogMeritBadgeRequirement[];
  scouts: readonly FocusScout[];
  /** Keyed by scoutId. A scout missing here has finished nothing. */
  progress: ReadonlyMap<string, FocusProgress>;
  /** The union of the meeting's focus set items: rank and merit badge requirement keys, any level. */
  focusKeys: readonly string[];
  /** Badges added to the night directly, with or without focus items of their own. */
  badgeIds?: readonly string[];
  /** Keyed by personId. */
  roles?: ReadonlyMap<number, ScoutRole>;
  /** Each scout's current picks for this meeting, keyed by personId. A family that ticked a group put the scout there:
   *  picks outrank placement, and a planner's hand choice outranks picks. */
  picks?: ReadonlyMap<number, readonly string[]>;
  /** A family's unticks (Emails N2), column keys by personId: those columns leave the scout's plan at once. A key not
   *  in the scout's group is ignored. Unticking every open column leaves the scout with nothing assigned. */
  exclusions?: ReadonlyMap<number, ReadonlySet<string>>;
  /** A Merit badge group scout's "help teach" answer (Emails N4), the group key by personId: they sit in that group as
   *  a helper, the way a planner's move does. A planner's hand choice outranks it. */
  helpers?: ReadonlyMap<number, string>;
  /** Split groups, keyed by the base group key: each section's listed requirement keys, index 0 = Group 1. A section
   *  owns a focus key it lists, or one under a key it lists; a focus key no section lists goes to Group 1. A key may
   *  sit in several sections. Fewer than 2 sections, or a merged base, is no split. */
  splits?: ReadonlyMap<string, readonly (readonly string[])[]>;
  /** Base keys whose split is merged: their '~2'/'~3' keys read as the base (canonicalGroupKey). */
  mergedBases?: ReadonlySet<string>;
}

export interface FocusColumn {
  /** The catalog key: 'first-class-7a', 'first-aid-2'. */
  key: string;
  /** The requirement's own code: '7a'. */
  code: string;
  label: string;
  /** A rank column's sub-requirements (its leaves, '7a.1'…), each a checklist cell of its own: rank requirements are
   *  taught and signed off a sub-requirement at a time. Empty for a leaf, and always for a badge, whose checklist stays
   *  one cell per requirement (a part-done one is half green). */
  subs: { key: string; code: string; label: string }[];
}

/** A checklist cell that isn't done: still to do, or (a badge requirement) partly done. Done cells are absent. */
export type CellMark = 'open' | 'part';

export interface FocusGroup {
  key: string;
  kind: 'rank' | 'badge';
  /** The rank worked on, or the badge. */
  refId: string;
  /** The rank's or badge's own name: code labels ("Tenderfoot 4a") are built on it. */
  name: string;
  /** What the group is called on screen: the name, or "Tenderfoot Group 2" when the rank is split. */
  label: string;
  /** Group 1's key: the group's key when it isn't split. */
  base: string;
  /** 1-3; 1 when not split. */
  section: number;
  /** How many groups the rank (or badge) is split into; 1 when not split. */
  sections: number;
  columns: FocusColumn[];
  /** personIds, in roster order. */
  members: number[];
}

/**
 * - `rank-work`: placed in a rank group with at least one open column (counts toward coverage).
 * - `badge`: in a merit badge group.
 * - `teach`, `request`: a planner's choice.
 * - `placed`: moved by hand into a rank group where nothing is open (a gap filled, not rank work).
 * - `nothing`: a counted scout with nothing assigned.
 * - `unassigned`: a planner chose no group for them tonight (not a gap).
 */
export type RowStatus = 'rank-work' | 'badge' | 'teach' | 'request' | 'placed' | 'nothing' | 'unassigned';

export interface FocusRow {
  personId: number;
  scoutId: string;
  name: string;
  /** The rank the scout holds (null = a new scout): it colours their name chip. */
  currentRank: string | null;
  intent: Intent | null;
  /** Scout through First Class groups count toward coverage; the Merit badge group doesn't. */
  counted: boolean;
  /** The group the scout sits in, null when none. */
  groupKey: string | null;
  /** Columns of that group the scout hasn't finished: the checklist's white cells. */
  open: string[];
  status: RowStatus;
  /** `nothing` only: every requirement the night offers them is done. */
  allDone: boolean;
  /** `request` only: the topic they were placed in from requests and offers. */
  requestKey?: string;
  /** Where the checklist lists the scout when they sit in no group: the group of the rank they work on (or the next
   *  one), the first badge group for an older scout; null when tonight has none of those. */
  homeKey: string | null;
  /** Columns of the home group the scout hasn't finished: what the checklist shows when they sit in no group. */
  homeOpen: string[];
  /** The group's checklist cells that aren't done, keyed by cell (a rank column's sub-requirements, else the column). */
  marks: Record<string, CellMark>;
  /** The same for the home group. */
  homeMarks: Record<string, CellMark>;
  /** The options the family email marks "Suggested for <scout>": the group placement chose. */
  suggested: string[];
}

export interface FocusPlan {
  /** Rank groups in rank order, then badge groups in the order they first appear. Only groups the focus covers. */
  groups: FocusGroup[];
  rows: FocusRow[];
  coverage: { counted: number; rankWork: number; nothing: number };
  /** Focus keys that have no group: Star/Life/Eagle rank requirements, or keys the catalog no longer has. */
  unplaced: string[];
}

type RankNode = ReqNode<CatalogRankRequirement>;
type MbNode = ReqNode<CatalogMeritBadgeRequirement>;
type AnyNode = RankNode | MbNode;

/** Index a forest by catalog key, with its parent key and its position in catalog (depth-first) order. */
function indexForest<T extends AnyNode>(roots: T[], keyOf: (n: T) => string) {
  const byKey = new Map<string, { node: T; parent: string | null; order: number }>();
  let order = 0;
  const walk = (n: T, parent: string | null) => {
    const key = keyOf(n);
    byKey.set(key, { node: n, parent, order: order++ });
    for (const c of n.children as T[]) walk(c, key);
  };
  for (const r of roots) walk(r, null);
  return byKey;
}

/** The highest picked nodes: a key whose ancestor is also picked is covered by that ancestor's column. */
function topmostPicked<T extends AnyNode>(picked: ReadonlySet<string>, index: ReturnType<typeof indexForest<T>>): string[] {
  const out: string[] = [];
  for (const key of picked) {
    let p = index.get(key)?.parent ?? null;
    let covered = false;
    while (p) {
      if (picked.has(p)) {
        covered = true;
        break;
      }
      p = index.get(p)?.parent ?? null;
    }
    if (!covered) out.push(key);
  }
  return out.sort((a, b) => index.get(a)!.order - index.get(b)!.order);
}

export function buildFocusPlan(input: FocusInput): FocusPlan {
  const ranks = [...input.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const rankSort = new Map(ranks.map((r) => [r.id, r.sort_order]));
  const groupRanks = ranks.filter((r) => GROUP_RANKS.includes(r.id));
  const firstGroupSort = rankSort.get('first-class') ?? 3;
  const mbName = new Map(input.meritBadges.map((m) => [m.id, m.name]));

  // Catalog forests, indexed by key.
  const rankIndex = new Map<string, ReturnType<typeof indexForest<RankNode>>>();
  for (const r of groupRanks) {
    const rows = input.rankReqs.filter((q) => q.rank_id === r.id && q.code.toLowerCase() !== 'bor');
    rankIndex.set(r.id, indexForest(buildReqTree(rows) as RankNode[], (n) => `${r.id}-${n.code}`));
  }
  const mbIndex = new Map<string, ReturnType<typeof indexForest<MbNode>>>();
  const mbForest = (mbId: string) => {
    let idx = mbIndex.get(mbId);
    if (!idx) {
      idx = indexForest(buildReqTree(input.mbReqs.filter((q) => q.mb_id === mbId)) as MbNode[], (n) => `${mbId}-${n.code}`);
      mbIndex.set(mbId, idx);
    }
    return idx;
  };

  // Sort the focus keys into rank groups and badge groups. Rank ids and badge ids both carry dashes: the longest
  // matching prefix wins, and a key names a real catalog row or it's unplaced.
  const rankPicked = new Map<string, Set<string>>();
  const badgePicked = new Map<string, Set<string>>();
  const badgeOrder: string[] = [];
  const unplaced: string[] = [];
  const allRankIds = [...ranks].map((r) => r.id).sort((a, b) => b.length - a.length);
  const mbIds = input.meritBadges.map((m) => m.id).sort((a, b) => b.length - a.length);
  for (const key of new Set(input.focusKeys)) {
    const rankId = allRankIds.find((id) => key.startsWith(`${id}-`));
    if (rankId && rankIndex.get(rankId)?.has(key)) {
      if (!rankPicked.has(rankId)) rankPicked.set(rankId, new Set());
      rankPicked.get(rankId)!.add(key);
      continue;
    }
    const mbId = mbIds.find((id) => key.startsWith(`${id}-`) && mbForest(id).has(key));
    if (!rankId && mbId) {
      if (!badgePicked.has(mbId)) {
        badgePicked.set(mbId, new Set());
        badgeOrder.push(mbId);
      }
      badgePicked.get(mbId)!.add(key);
      continue;
    }
    unplaced.push(key);
  }
  for (const id of input.badgeIds ?? []) {
    if (!mbName.has(id) || badgePicked.has(id)) continue;
    badgePicked.set(id, new Set());
    badgeOrder.push(id);
  }

  // `subKey` (rank columns only) names a sub-requirement's catalog key; a badge column gets no subs.
  const column = (key: string, node: AnyNode, subKey?: (n: AnyNode) => string): FocusColumn => {
    const subs: FocusColumn['subs'] = [];
    const leaves = (n: AnyNode) => (n.children.length ? (n.children as AnyNode[]).forEach(leaves) : subs.push({ key: subKey!(n), code: n.code, label: n.label }));
    if (subKey && node.children.length) leaves(node);
    return { key, code: node.code, label: node.label, subs };
  };
  // A split base's sections, each owning the picked keys it lists or sits under; a key no section lists is Group 1's.
  const merged = input.mergedBases;
  const sectionsFor = <T extends AnyNode>(base: string, picked: ReadonlySet<string>, idx: ReturnType<typeof indexForest<T>>): Set<string>[] => {
    const lists = merged?.has(base) ? undefined : input.splits?.get(base)?.slice(0, MAX_SECTIONS);
    if (!lists || lists.length < 2) return [new Set(picked)];
    const owned = lists.map(() => new Set<string>());
    for (const key of picked) {
      const line: string[] = [];
      for (let k: string | null = key; k; k = idx.get(k)?.parent ?? null) line.push(k);
      const hits = lists.map((l, i) => (line.some((k) => l.includes(k)) ? i : -1)).filter((i) => i >= 0);
      for (const i of hits.length ? hits : [0]) owned[i].add(key);
    }
    return owned;
  };
  const groups: FocusGroup[] = [];
  const pushSections = (
    base: string,
    kind: FocusGroup['kind'],
    refId: string,
    name: string,
    owned: Set<string>[],
    columnsOf: (keys: ReadonlySet<string>) => FocusColumn[]
  ) =>
    owned.forEach((keys, i) =>
      groups.push({
        key: sectionGroupKey(base, i + 1),
        kind,
        refId,
        name,
        label: owned.length > 1 ? `${name} Group ${i + 1}` : name,
        base,
        section: i + 1,
        sections: owned.length,
        columns: columnsOf(keys),
        members: []
      })
    );
  for (const r of groupRanks) {
    const picked = rankPicked.get(r.id);
    if (!picked?.size) continue;
    const idx = rankIndex.get(r.id)!;
    const base = rankGroupKey(r.id);
    pushSections(base, 'rank', r.id, r.display_name, sectionsFor(base, picked, idx), (keys) =>
      topmostPicked(keys, idx).map((k) => column(k, idx.get(k)!.node, (n) => `${r.id}-${n.code}`))
    );
  }
  for (const mbId of badgeOrder) {
    const idx = mbForest(mbId);
    const base = badgeGroupKey(mbId);
    // A badge added with no focus items of its own offers its top-level requirements.
    const given = badgePicked.get(mbId)!;
    const picked = given.size ? given : new Set([...idx].filter(([, v]) => v.parent === null).map(([k]) => k));
    pushSections(base, 'badge', mbId, mbName.get(mbId) ?? mbId, sectionsFor(base, picked, idx), (keys) => topmostPicked(keys, idx).map((k) => column(k, idx.get(k)!.node)));
  }
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const sectionsOf = new Map<string, FocusGroup[]>();
  for (const g of groups) sectionsOf.set(g.base, [...(sectionsOf.get(g.base) ?? []), g]);
  const firstBadge = groups.find((g) => g.kind === 'badge') ?? null;

  const empty: FocusProgress = { rankCodes: new Set(), mbCodes: new Set() };
  const openIn = (g: FocusGroup, p: FocusProgress): string[] =>
    g.kind === 'badge' && p.awardedMbs?.has(g.refId)
      ? []
      : g.columns
      .filter((c) => {
        if (g.kind === 'rank') return !rankNodeSatisfied(rankIndex.get(g.refId)!.get(c.key)!.node, g.refId, p.rankCodes as Set<string>);
        return !mbNodeSatisfied(mbForest(g.refId).get(c.key)!.node, g.refId, p.mbCodes);
      })
      .map((c) => c.key);

  // The checklist's cells that aren't done. A rank column's sub is done when signed off or when the column (or a
  // requirement between them) is satisfied by its rule; a badge column with some leaves signed off is part-done.
  const marksIn = (g: FocusGroup, p: FocusProgress): Record<string, CellMark> => {
    const out: Record<string, CellMark> = {};
    if (g.kind === 'badge' && p.awardedMbs?.has(g.refId)) return out;
    for (const c of g.columns) {
      if (g.kind === 'rank') {
        const codes = p.rankCodes as Set<string>;
        const walk = (n: RankNode) => {
          if (rankNodeSatisfied(n, g.refId, codes)) return;
          if (n.children.length && c.subs.length) n.children.forEach(walk);
          else out[n.children.length ? c.key : `${g.refId}-${n.code}`] = 'open';
        };
        walk(rankIndex.get(g.refId)!.get(c.key)!.node);
        continue;
      }
      const node = mbForest(g.refId).get(c.key)!.node;
      if (mbNodeSatisfied(node, g.refId, p.mbCodes)) continue;
      const anyDone = (n: MbNode): boolean => (n.children.length ? n.children.some(anyDone) : p.mbCodes.has(`${g.refId}-${n.code}`));
      out[c.key] = node.children.length && anyDone(node) ? 'part' : 'open';
    }
    return out;
  };

  // A cell's minutes: its own teach_minutes, or its leaves' (the family page's numbers, without its 60-minute cap).
  const nodeMinutes = (n: AnyNode): number => (n.children.length ? (n.children as AnyNode[]).reduce((t, c) => t + nodeMinutes(c), 0) : (n.teach_minutes ?? DEFAULT_TEACH_MINUTES));
  const openMinutes = (g: FocusGroup, p: FocusProgress): number => {
    const idx = g.kind === 'rank' ? rankIndex.get(g.refId)! : mbForest(g.refId);
    return Object.keys(marksIn(g, p)).reduce((t, k) => t + (idx.get(k) ? nodeMinutes(idx.get(k)!.node) : DEFAULT_TEACH_MINUTES), 0);
  };
  /** The section of a base with the most open minutes for this scout (then the most open columns); ties to the lower. */
  const bestSection = (base: string, p: FocusProgress): FocusGroup | undefined => {
    const secs = sectionsOf.get(base);
    if (!secs || secs.length < 2) return secs?.[0];
    let best = secs[0];
    let score = [openMinutes(best, p), openIn(best, p).length];
    for (const g of secs.slice(1)) {
      const s = [openMinutes(g, p), openIn(g, p).length];
      if (s[0] > score[0] || (s[0] === score[0] && s[1] > score[1])) [best, score] = [g, s];
    }
    return best;
  };
  // A hand move names its section exactly (a section that's gone falls to the best one left); a family's pick or a
  // helper's group of a split base is placed by fit, since Group 1's key is the base key.
  const resolveExact = (key: string, p: FocusProgress) => {
    const k = canonicalGroupKey(key, merged);
    return groupByKey.get(k) ?? (parseGroupKey(k) ? bestSection(parseGroupKey(k)!.base, p) : undefined);
  };
  const resolveByFit = (key: string, p: FocusProgress) => {
    const k = canonicalGroupKey(key, merged);
    const parsed = parseGroupKey(k);
    if (parsed?.section === 1 && (sectionsOf.get(parsed.base)?.length ?? 0) > 1) return bestSection(parsed.base, p);
    return resolveExact(key, p);
  };

  const rows: FocusRow[] = input.scouts.map((s) => {
    const p = input.progress.get(s.scoutId) ?? empty;
    const held = s.currentRank != null ? rankSort.get(s.currentRank) : undefined;
    const counted = held == null || held < firstGroupSort;
    const base = { personId: s.personId, scoutId: s.scoutId, name: s.name, currentRank: s.currentRank, intent: s.intent, counted };
    const withHome = <T extends object>(r: T) => {
      const home = homeKey ? groupByKey.get(homeKey) : undefined;
      const group = 'groupKey' in r && typeof r.groupKey === 'string' ? groupByKey.get(r.groupKey) : undefined;
      return { ...r, homeKey, homeOpen: home ? openIn(home, p) : [], marks: group ? marksIn(group, p) : {}, homeMarks: home ? marksIn(home, p) : {} };
    };

    // Where placement alone would put the scout.
    let auto: { groupKey: string | null; open: string[]; status: RowStatus; allDone: boolean };
    let homeKey: string | null = firstBadge?.key ?? null;
    if (counted) {
      const own = groupRanks[held == null ? 0 : groupRanks.findIndex((r) => r.id === s.currentRank) + 1];
      // A split rank: the section with the most open for this scout, so "anything open" looks across all of them.
      const ownGroup = own ? bestSection(rankGroupKey(own.id), p) : undefined;
      const ownOpen = ownGroup ? openIn(ownGroup, p) : [];
      // Working ahead: done with their own rank's part of the focus, so the next rank group, one step only.
      const next = own ? groupRanks[groupRanks.findIndex((r) => r.id === own.id) + 1] : undefined;
      const nextGroup = next ? bestSection(rankGroupKey(next.id), p) : undefined;
      const nextOpen = !ownOpen.length && nextGroup ? openIn(nextGroup, p) : [];
      homeKey = ownGroup?.key ?? nextGroup?.key ?? null;
      if (ownGroup && ownOpen.length) auto = { groupKey: ownGroup.key, open: ownOpen, status: 'rank-work', allDone: false };
      else if (nextGroup && nextOpen.length) auto = { groupKey: nextGroup.key, open: nextOpen, status: 'rank-work', allDone: false };
      else auto = { groupKey: null, open: [], status: 'nothing', allDone: !!(ownGroup || nextGroup) };
    } else {
      // The first of the night's badges this scout hasn't earned, and their family hasn't taken off the plan (the
      // family page, Patrick 2026-10-30); none left (or none tonight) → they teach.
      const off = input.exclusions?.get(s.personId);
      const first = groups.find((g) => g.kind === 'badge' && g.section === 1 && !p.awardedMbs?.has(g.refId) && !off?.has(g.base));
      const badge = first ? bestSection(first.base, p) : undefined;
      auto = badge ? { groupKey: badge.key, open: openIn(badge, p), status: 'badge', allDone: false } : { groupKey: null, open: [], status: 'teach', allDone: false };
    }
    const suggested = auto.groupKey ? [auto.groupKey] : [];

    const hand = input.roles?.get(s.personId);
    const helping = input.helpers?.get(s.personId);
    const helpGroup = helping ? resolveByFit(helping, p) : undefined;
    const pickedGroup = input.picks?.get(s.personId)?.map((k) => resolveByFit(k, p)).find((g) => g);
    const fitted = helpGroup ?? pickedGroup;
    const role: ScoutRole | undefined =
      hand?.role === 'group' ? { role: 'group', key: resolveExact(hand.key, p)?.key ?? hand.key } : (hand ?? (fitted ? { role: 'group', key: fitted.key } : undefined));
    if (role?.role === 'none') return withHome({ ...base, groupKey: null, open: [], status: 'unassigned', allDone: false, suggested });
    if (role?.role === 'teach') return withHome({ ...base, groupKey: null, open: [], status: 'teach', allDone: false, suggested });
    if (role?.role === 'request') return withHome({ ...base, groupKey: null, open: [], status: 'request', allDone: false, requestKey: role.key, suggested });
    if (role?.role === 'group') {
      const g = groupByKey.get(role.key);
      if (g) {
        const open = openIn(g, p);
        // An older scout moved into a rank group is there to help; a counted scout with nothing open there is placed
        // (a gap filled), not on rank work.
        const status: RowStatus = g.kind === 'badge' ? 'badge' : !counted ? 'teach' : open.length ? 'rank-work' : 'placed';
        return withHome({ ...base, groupKey: g.key, open, status, allDone: false, suggested });
      }
      // The group left the focus: placement decides again.
    }
    return withHome({ ...base, ...auto, suggested });
  });

  // A family's unticks come off the plan last, whatever put the scout in their group.
  for (const [i, r] of rows.entries()) {
    const off = input.exclusions?.get(r.personId);
    const g = r.groupKey ? groupByKey.get(r.groupKey) : undefined;
    if (!off?.size || !g || (r.status !== 'rank-work' && r.status !== 'badge')) continue;
    const gone = g.columns.filter((c) => off.has(c.key));
    if (!gone.length) continue;
    const marks = { ...r.marks };
    for (const c of gone) {
      delete marks[c.key];
      for (const x of c.subs) delete marks[x.key];
    }
    const open = r.open.filter((k) => !off.has(k));
    rows[i] = r.status === 'rank-work' && !open.length ? { ...r, groupKey: null, open: [], marks: {}, status: 'nothing', allDone: false } : { ...r, open, marks };
  }

  for (const r of rows) if (r.groupKey) groupByKey.get(r.groupKey)?.members.push(r.personId);

  const counted = rows.filter((r) => r.counted);
  return {
    groups,
    rows,
    coverage: {
      counted: counted.length,
      rankWork: counted.filter((r) => r.status === 'rank-work').length,
      nothing: counted.filter((r) => r.status === 'nothing').length
    },
    unplaced
  };
}
