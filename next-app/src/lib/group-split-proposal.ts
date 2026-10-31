/**
 * The auto planner's split (Plans/Meeting-Planner-III-Split-Groups.md, S3): how to divide one group of the night into 2
 * or 3, for the Split or merge… dialog and the "Split into 2 groups?" offer. Pure; nothing is written until a planner
 * applies it.
 *
 *   1. Bands. The group's scouts, by how many of the rank's (or badge's) requirements they have done, cut into near-equal
 *      bands at the biggest jumps near each cut: fewer done → Group 1.
 *   2. Columns. Each of tonight's columns goes to every band at least half of whom still need it (D3: a column may be in
 *      several groups); one no band half-needs goes to the band that needs it most, else Group 1.
 *   3. Extras. Group 2 and 3 (and Group 1 only when it got nothing) take the requirements their band needs most that
 *      tonight's focus doesn't cover: meeting-class only, two or more scouts needing it, until about 60 minutes.
 *   4. Preview. The real placement (buildFocusPlan) with the proposed split: who it shows is who placement will put
 *      there, not the bands.
 */
import { buildReqTree, type ReqNode } from '@/lib/mb-helpers';
import { mbNodeSatisfied, rankNodeSatisfied, rankTopPlannable } from '@/lib/rank-calculus';
import { planningState, topClasses } from '@/lib/requirement-class';
import { buildFocusPlan, MAX_SECTIONS, parseGroupKey, type FocusInput, type FocusProgress, type FocusRow } from '@/lib/focus-plan';
import type { CatalogMeritBadgeRequirement, CatalogRankRequirement } from '@/lib/advancement-catalog';

/** More placed scouts than this, and the group's card offers a split (D2: a prompt, never a limit). */
export const SPLIT_CAP = 8;
/** Minutes a proposed group is filled to with extras (a meeting's teaching time, as the family page's budget). */
export const SPLIT_TARGET_MIN = 60;
const DEFAULT_TEACH_MINUTES = 15;
/** A column goes to every band at least this share of whom still need it. */
const SHARE_NEED = 0.5;

export interface ProposedGroup {
  key: string;
  label: string;
  /** personIds, as placement would put them. */
  members: number[];
  columns: string[];
  /** What the group's columns take to teach, whoever has done them. */
  minutes: number;
}

export interface SplitProposal {
  base: string;
  /** Each group's requirement keys, Group 1 first: what meeting_split_group takes. */
  sections: string[][];
  /** Requirements to put on the night first (planner-added), because a group was given them. */
  adds: string[];
  groups: ProposedGroup[];
  /** Scouts placed in the group tonight, before any split. */
  placed: number;
}

type Row = CatalogRankRequirement | CatalogMeritBadgeRequirement;
type Node = ReqNode<Row>;

const nodeMinutes = (n: Node): number => (n.children.length ? n.children.reduce((t, c) => t + nodeMinutes(c), 0) : (n.teach_minutes ?? DEFAULT_TEACH_MINUTES));

/** Where to cut `n` sorted counts into `k` bands: near each equal-size cut, the biggest jump wins (closest on a tie). */
function cutPoints(counts: readonly number[], k: number): number[] {
  const n = counts.length;
  const w = Math.max(1, Math.floor(n / (4 * k)));
  const cuts: number[] = [];
  for (let i = 1; i < k; i++) {
    const ideal = Math.round((i * n) / k);
    let best = ideal;
    let jump = -1;
    for (let d = 0; d <= w; d++) {
      for (const pos of d ? [ideal - d, ideal + d] : [ideal]) {
        if (pos <= (cuts.at(-1) ?? 0) || pos >= n) continue;
        const j = counts[pos] - counts[pos - 1];
        if (j > jump) [best, jump] = [pos, j];
      }
    }
    cuts.push(best);
  }
  return cuts;
}

export function proposeSplit(input: FocusInput, base: string, count: number): SplitProposal | null {
  const parsed = parseGroupKey(base);
  if (!parsed || parsed.section !== 1 || count < 2 || count > MAX_SECTIONS) return null;
  // Tonight's group as one: any split it has (and any hand move into its Group 2/3) reads as the base.
  const merged = new Set([...(input.mergedBases ?? []), base]);
  const now = buildFocusPlan({ ...input, mergedBases: merged });
  const group = now.groups.find((g) => g.key === base);
  if (!group) return null;
  const members = now.rows.filter((r) => r.groupKey === base);
  if (members.length < count) return null;

  // The rank's (or badge's) requirement tree, indexed by key in catalog order.
  const rows: Row[] =
    parsed.kind === 'rank' ? input.rankReqs.filter((q) => q.rank_id === parsed.refId && q.code.toLowerCase() !== 'bor') : input.mbReqs.filter((q) => q.mb_id === parsed.refId);
  const tree = buildReqTree(rows) as Node[];
  const keyOf = (n: Node) => `${parsed.refId}-${n.code}`;
  const byKey = new Map<string, { node: Node; order: number; under: Set<string> }>();
  let order = 0;
  const walk = (n: Node, line: string[]) => {
    const key = keyOf(n);
    byKey.set(key, { node: n, order: order++, under: new Set([key]) });
    for (const a of line) byKey.get(a)!.under.add(key);
    for (const c of n.children) walk(c, [...line, key]);
  };
  for (const r of tree) walk(r, []);
  const minutesOf = (keys: readonly string[]) => keys.reduce((t, k) => t + (byKey.get(k) ? nodeMinutes(byKey.get(k)!.node) : DEFAULT_TEACH_MINUTES), 0);
  const inOrder = (keys: Iterable<string>) => [...new Set(keys)].sort((a, b) => (byKey.get(a)?.order ?? 0) - (byKey.get(b)?.order ?? 0));

  const empty: FocusProgress = { rankCodes: new Set(), mbCodes: new Set() };
  const progressOf = (r: FocusRow) => input.progress.get(r.scoutId) ?? empty;
  const doneCount = (r: FocusRow) => {
    const p = progressOf(r);
    const codes = parsed.kind === 'rank' ? p.rankCodes : p.mbCodes;
    return [...codes].filter((c) => c.startsWith(`${parsed.refId}-`)).length;
  };
  const needs = (r: FocusRow, top: Node) => {
    const p = progressOf(r);
    if (parsed.kind === 'badge') return !p.awardedMbs?.has(parsed.refId) && !mbNodeSatisfied(top as ReqNode<CatalogMeritBadgeRequirement>, parsed.refId, p.mbCodes);
    const codes = p.rankCodes as Set<string>;
    const t = top as ReqNode<CatalogRankRequirement>;
    return !rankNodeSatisfied(t, parsed.refId, codes) && rankTopPlannable(tree as ReqNode<CatalogRankRequirement>[], parsed.refId, t, codes);
  };

  // 1. Bands.
  const sorted = members.map((r, i) => ({ r, i, n: doneCount(r) })).sort((a, b) => a.n - b.n || a.i - b.i);
  const cuts = [0, ...cutPoints(sorted.map((x) => x.n), count), sorted.length];
  const bands = cuts.slice(1).map((end, b) => sorted.slice(cuts[b], end).map((x) => x.r));

  // 2. Tonight's columns.
  const sections = bands.map(() => [] as string[]);
  for (const c of group.columns) {
    const share = bands.map((b) => b.filter((r) => r.open.includes(c.key)).length / b.length);
    let to = share.flatMap((s, i) => (s >= SHARE_NEED ? [i] : []));
    if (!to.length) to = [Math.max(0, share.indexOf(Math.max(...share)))];
    for (const i of to) sections[i].push(c.key);
  }

  // 3. Extras: top-level requirements no focus key sits in or under, that a meeting can hold.
  const focus = new Set(input.focusKeys);
  const candidates = tree.filter((t) => {
    const under = byKey.get(keyOf(t))!.under;
    return ![...under].some((k) => focus.has(k)) && planningState(topClasses(t), 'meeting') === 'fits';
  });
  const adds = new Set<string>();
  bands.forEach((band, i) => {
    if (i === 0 && sections[0].length) return;
    let budget = SPLIT_TARGET_MIN - minutesOf(sections[i]);
    const ranked = candidates
      .map((t) => ({ key: keyOf(t), need: band.filter((r) => needs(r, t)).length }))
      .filter((x) => x.need >= 2 && !sections[i].includes(x.key))
      .sort((a, b) => b.need - a.need || byKey.get(a.key)!.order - byKey.get(b.key)!.order);
    for (const x of ranked) {
      const m = minutesOf([x.key]);
      if (m > budget) continue;
      sections[i].push(x.key);
      adds.add(x.key);
      budget -= m;
    }
  });
  const ordered = sections.map((s) => inOrder(s));

  // 4. Preview: placement itself, with the split and the extras on the night.
  const splits = new Map(input.splits ?? []);
  splits.set(base, ordered);
  const unmerged = new Set([...(input.mergedBases ?? [])].filter((k) => k !== base));
  const real = buildFocusPlan({ ...input, focusKeys: [...input.focusKeys, ...adds], splits, mergedBases: unmerged });
  return {
    base,
    sections: ordered,
    adds: inOrder(adds),
    groups: real.groups
      .filter((g) => g.base === base)
      .map((g) => ({ key: g.key, label: g.label, members: g.members, columns: g.columns.map((c) => c.key), minutes: minutesOf(g.columns.map((c) => c.key)) })),
    placed: members.length
  };
}

/**
 * The card's offer: a 2-group proposal when more than SPLIT_CAP scouts are placed in the group and the proposal is
 * worth making (the groups teach different things and each has someone in it). Null otherwise.
 */
export function splitOffer(input: FocusInput, base: string): SplitProposal | null {
  const p = proposeSplit(input, base, 2);
  if (!p || p.placed <= SPLIT_CAP) return null;
  const same = p.sections.every((s) => s.length === p.sections[0].length && s.every((k) => p.sections[0].includes(k)));
  return same || p.groups.some((g) => !g.members.length) ? null : p;
}
