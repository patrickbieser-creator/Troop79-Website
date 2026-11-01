/**
 * The auto planner's split (Plans/Meeting-Planner-III-Split-Groups.md, S3): how to divide one group of the night into 2
 * or 3, for the Split or merge… dialog and the "Split into 2 groups?" offer. Pure; nothing is written until a planner
 * applies it.
 *
 *   1. Bands. The group's scouts, by how many of the rank's (or badge's) requirements they have done, cut at the biggest
 *      jumps (at least 2 scouts a band): fewer done → Group 1. Each band's fewest done is its group's level.
 *   2. Columns. Each of tonight's columns goes to the one band that most needs it (ties to the lower group). Sharing a
 *      column (D3) is a planner's choice, not the proposal's.
 *   3. Extras. Group 2 and 3 (and Group 1 only when it got nothing) take the requirements their band needs most that
 *      tonight's focus and the other groups don't cover: meeting-class only, two or more scouts needing it (one, in a
 *      group of two), until
 *      about 60 minutes. A different focus for the scouts further along, even when tonight's is one requirement
 *      everyone still needs. A scout in Group 2 or 3 left with nothing open there brings the focus requirements they
 *      still need into it (shared with Group 1).
 *   4. Preview. The real placement (buildFocusPlan) with the proposed split and levels: who it shows is who placement
 *      will put there, not the bands.
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
  /** Each group's level (requirements done to start there), Group 1 = 0, rising. */
  levels: number[];
  /** Requirements to put on the night first (planner-added), because a group was given them. */
  adds: string[];
  groups: ProposedGroup[];
  /** Scouts placed in the group tonight, before any split. */
  placed: number;
}

type Row = CatalogRankRequirement | CatalogMeritBadgeRequirement;
type Node = ReqNode<Row>;

const nodeMinutes = (n: Node): number => (n.children.length ? n.children.reduce((t, c) => t + nodeMinutes(c), 0) : (n.teach_minutes ?? DEFAULT_TEACH_MINUTES));

/** The fewest scouts a proposed group gets. */
const MIN_BAND = 2;

/**
 * Where to cut `n` sorted counts into `k` bands: at the biggest jumps in requirements done (Patrick, 2026-10-31: the two
 * scouts nearly done with Scout are their own group, however few), each band keeping at least MIN_BAND scouts; on a tie
 * the cut nearer an equal split. With no jump left to cut at, an equal split.
 */
function cutPoints(counts: readonly number[], k: number): number[] {
  const n = counts.length;
  const min = Math.min(MIN_BAND, Math.floor(n / k));
  const ideals = Array.from({ length: k - 1 }, (_, i) => Math.round(((i + 1) * n) / k));
  const near = (pos: number) => Math.min(...ideals.map((x) => Math.abs(x - pos)));
  const cuts: number[] = [];
  const fits = (pos: number, set: number[]) => {
    const all = [0, ...[...set, pos].sort((a, b) => a - b), n];
    return all.slice(1).every((x, i) => x - all[i] >= min);
  };
  const ranked = Array.from({ length: n - 1 }, (_, i) => i + 1)
    .filter((pos) => counts[pos] > counts[pos - 1])
    .sort((a, b) => counts[b] - counts[b - 1] - (counts[a] - counts[a - 1]) || near(a) - near(b));
  for (const pos of ranked) {
    if (cuts.length === k - 1) break;
    if (fits(pos, cuts)) cuts.push(pos);
  }
  for (const pos of ideals) {
    if (cuts.length === k - 1) break;
    if (!cuts.includes(pos) && fits(pos, cuts)) cuts.push(pos);
  }
  return cuts.sort((a, b) => a - b);
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
    sections[Math.max(0, share.indexOf(Math.max(...share)))].push(c.key);
  }
  // Levels: each band's fewest done, always rising (a band level with the one before starts one higher).
  const levels: number[] = [];
  bands.forEach((band, i) => levels.push(i ? Math.max(Math.min(...band.map(doneCount)), levels[i - 1] + 1) : 0));

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
      .filter((x) => x.need >= Math.min(2, band.length - 1) && x.need > 0 && !adds.has(x.key))
      .sort((a, b) => b.need - a.need || byKey.get(a.key)!.order - byKey.get(b.key)!.order);
    for (const x of ranked) {
      const m = minutesOf([x.key]);
      if (m > budget) continue;
      sections[i].push(x.key);
      adds.add(x.key);
      budget -= m;
    }
  });
  // Nobody in Group 2 or 3 is left with nothing there: a scout whose band's group has nothing open for them brings the
  // focus requirements they still need with them (shared with Group 1, D3). Two nearly-done scouts finish together.
  bands.forEach((band, i) => {
    if (!i) return;
    for (const r of band) {
      const has = sections[i].some((k) => r.open.includes(k) || (byKey.has(k) && needs(r, byKey.get(k)!.node)));
      if (!has) for (const k of r.open) if (!sections[i].includes(k)) sections[i].push(k);
    }
  });
  const ordered = sections.map((s) => inOrder(s));

  // 4. Preview: placement itself, with the split and the extras on the night.
  const splits = new Map(input.splits ?? []);
  splits.set(base, ordered);
  const unmerged = new Set([...(input.mergedBases ?? [])].filter((k) => k !== base));
  const splitLevels = new Map(input.splitLevels ?? []);
  splitLevels.set(base, levels);
  const real = buildFocusPlan({ ...input, focusKeys: [...input.focusKeys, ...adds], splits, splitLevels, mergedBases: unmerged });
  return {
    base,
    sections: ordered,
    levels,
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

/** What the Split or merge… panel shows for one split (proposed or edited): client-safe, names and words included. */
export interface SplitView {
  base: string;
  /** The rank's (or badge's) name: 'Tenderfoot'. */
  name: string;
  sections: string[][];
  levels: number[];
  /** Requirements the split would put on the night first. */
  adds: string[];
  placed: number;
  /** Every requirement the panel offers a tick for: tonight's columns and anything a group lists, in catalog order. */
  options: { key: string; code: string; label: string; minutes: number }[];
  groups: { label: string; fromDone: number; minutes: number; members: { personId: number; name: string }[] }[];
}

/** The panel's view of a split: what each group teaches and who placement would put there. Null when the group isn't
 *  on tonight. Sections may list requirements tonight doesn't have yet: those are `adds`. */
export function splitView(input: FocusInput, base: string, sections: readonly (readonly string[])[], levels: readonly number[]): SplitView | null {
  const parsed = parseGroupKey(base);
  if (!parsed || parsed.section !== 1 || sections.length < 2 || sections.length > MAX_SECTIONS) return null;
  const now = buildFocusPlan({ ...input, mergedBases: new Set([...(input.mergedBases ?? []), base]) });
  const group = now.groups.find((g) => g.key === base);
  if (!group) return null;
  const rows: Row[] =
    parsed.kind === 'rank' ? input.rankReqs.filter((q) => q.rank_id === parsed.refId && q.code.toLowerCase() !== 'bor') : input.mbReqs.filter((q) => q.mb_id === parsed.refId);
  const byKey = new Map<string, { node: Node; order: number; line: string[] }>();
  let order = 0;
  const walk = (n: Node, line: string[]) => {
    const key = `${parsed.refId}-${n.code}`;
    byKey.set(key, { node: n, order: order++, line });
    for (const c of n.children) walk(c, [...line, key]);
  };
  for (const r of buildReqTree(rows) as Node[]) walk(r, []);
  const minutesOf = (k: string) => (byKey.get(k) ? nodeMinutes(byKey.get(k)!.node) : DEFAULT_TEACH_MINUTES);
  const listed = sections.flat().filter((k) => byKey.has(k));
  const focus = new Set(input.focusKeys);
  // On tonight already: the key, a key above it, or a key under it is in the focus.
  const onTonight = (k: string) => focus.has(k) || byKey.get(k)!.line.some((a) => focus.has(a)) || [...focus].some((f) => byKey.get(f)?.line.includes(k));
  const adds = [...new Set(listed.filter((k) => !onTonight(k)))];
  const clean = sections.map((s) => [...new Set(s.filter((k) => byKey.has(k)))]);
  const real = buildFocusPlan({
    ...input,
    focusKeys: [...input.focusKeys, ...adds],
    splits: new Map([...(input.splits ?? []), [base, clean]]),
    splitLevels: new Map([...(input.splitLevels ?? []), [base, [...levels]]]),
    mergedBases: new Set([...(input.mergedBases ?? [])].filter((k) => k !== base))
  });
  const name = new Map(input.scouts.map((s) => [s.personId, s.name]));
  const keys = [...new Set([...group.columns.map((c) => c.key), ...listed])].sort((a, b) => (byKey.get(a)?.order ?? 0) - (byKey.get(b)?.order ?? 0));
  return {
    base,
    name: group.name,
    sections: clean,
    levels: [...levels],
    adds,
    placed: now.rows.filter((r) => r.groupKey === base).length,
    options: keys.map((k) => ({ key: k, code: byKey.get(k)?.node.code ?? k, label: byKey.get(k)?.node.label ?? k, minutes: minutesOf(k) })),
    groups: real.groups
      .filter((g) => g.base === base)
      .map((g) => ({
        label: g.label,
        fromDone: g.fromDone,
        minutes: g.columns.reduce((t, c) => t + minutesOf(c.key), 0),
        members: g.members.map((id) => ({ personId: id, name: name.get(id) ?? '' }))
      }))
  };
}
