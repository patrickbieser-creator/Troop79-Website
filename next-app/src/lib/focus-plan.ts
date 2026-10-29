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
  | { role: 'request'; key: string };

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
  name: string;
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
 */
export type RowStatus = 'rank-work' | 'badge' | 'teach' | 'request' | 'placed' | 'nothing';

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
  const groups: FocusGroup[] = [];
  for (const r of groupRanks) {
    const picked = rankPicked.get(r.id);
    if (!picked?.size) continue;
    const idx = rankIndex.get(r.id)!;
    groups.push({
      key: rankGroupKey(r.id),
      kind: 'rank',
      refId: r.id,
      name: r.display_name,
      columns: topmostPicked(picked, idx).map((k) => column(k, idx.get(k)!.node, (n) => `${r.id}-${n.code}`)),
      members: []
    });
  }
  for (const mbId of badgeOrder) {
    const idx = mbForest(mbId);
    const picked = badgePicked.get(mbId)!;
    // A badge added with no focus items of its own offers its top-level requirements.
    const keys = picked.size ? topmostPicked(picked, idx) : [...idx].filter(([, v]) => v.parent === null).map(([k]) => k);
    groups.push({
      key: badgeGroupKey(mbId),
      kind: 'badge',
      refId: mbId,
      name: mbName.get(mbId) ?? mbId,
      columns: keys.map((k) => column(k, idx.get(k)!.node)),
      members: []
    });
  }
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
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
      const ownGroup = own ? groupByKey.get(rankGroupKey(own.id)) : undefined;
      const ownOpen = ownGroup ? openIn(ownGroup, p) : [];
      // Working ahead: done with their own rank's part of the focus, so the next rank group, one step only.
      const next = own ? groupRanks[groupRanks.findIndex((r) => r.id === own.id) + 1] : undefined;
      const nextGroup = next ? groupByKey.get(rankGroupKey(next.id)) : undefined;
      const nextOpen = !ownOpen.length && nextGroup ? openIn(nextGroup, p) : [];
      homeKey = ownGroup?.key ?? nextGroup?.key ?? null;
      if (ownGroup && ownOpen.length) auto = { groupKey: ownGroup.key, open: ownOpen, status: 'rank-work', allDone: false };
      else if (nextGroup && nextOpen.length) auto = { groupKey: nextGroup.key, open: nextOpen, status: 'rank-work', allDone: false };
      else auto = { groupKey: null, open: [], status: 'nothing', allDone: !!(ownGroup || nextGroup) };
    } else {
      // The first of the night's badges this scout hasn't earned; none left (or none tonight) → they teach.
      const badge = groups.find((g) => g.kind === 'badge' && !p.awardedMbs?.has(g.refId));
      auto = badge ? { groupKey: badge.key, open: openIn(badge, p), status: 'badge', allDone: false } : { groupKey: null, open: [], status: 'teach', allDone: false };
    }
    const suggested = auto.groupKey ? [auto.groupKey] : [];

    const pickedGroup = input.picks?.get(s.personId)?.find((k) => groupByKey.has(k));
    const role: ScoutRole | undefined = input.roles?.get(s.personId) ?? (pickedGroup ? { role: 'group', key: pickedGroup } : undefined);
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
