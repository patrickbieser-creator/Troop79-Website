/**
 * The scout's pick list for a meeting board (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 16:
 * "order guides but does not restrict"). Pure and client-safe.
 *
 *   1. The next rank's unfinished top-level requirements, open.
 *   2. Later ranks, collapsed, each with its count.
 *   3. Merit badges the scout is working on.
 *   4. Every other badge, behind a search.
 *   5. (Phase 2) "Also offered this week": freeform topics a teacher put on this board.
 *
 * A row a teacher has signed up for (or that a matching skill offer covers) carries one quiet "Teacher: Mr. Vest" tag
 * (Phase 2); the caller works out who from lib/meeting-board-teach.
 *
 * Meeting Planner P3: what a planner seeded on this meeting. A focus group ('fg:7', one pick, one class) and a single merit
 * badge requirement ('first-aid-9') come first, under "Focus"; a seeded rank requirement stays in its rank group
 * with a `focus` mark. Neither a focus group nor a merit badge requirement is ever finished (a retake is allowed).
 *
 * Finished requirements are absent. The engine's rules decide what can be worked on at a meeting at all (its
 * L-only class tag and the 95% Scoutmaster-conference gate, via lib/rank-calculus); one a meeting doesn't hold (its
 * class tags, lib/requirement-class) is listed but disabled with "Needs an outing". The pick unit is the top-level requirement (Decision 15).
 */
import { buildReqTree, type ReqNode } from '@/lib/mb-helpers';
import { BOR_CODE, borKey, isBorKey, rankBorPickable, rankNodeSatisfied, rankTopPlannable } from '@/lib/rank-calculus';
import { planningState, topClasses } from '@/lib/requirement-class';
import type { CatalogMeritBadge, CatalogMeritBadgeRequirement, CatalogRank, CatalogRankRequirement } from '@/lib/advancement-catalog';
import { boardName, orderPicks, othersLabel, type BoardPick, type Intent } from '@/lib/meeting-board-shared';

export interface PickRow {
  key: string;
  kind: 'rank' | 'mb' | 'ff' | 'focus';
  /** The requirement code ('4a') under its rank heading; null for a badge. */
  code: string | null;
  label: string;
  /** 'Tenderfoot 4a' or 'Merit badge'; the tray's second line. */
  codeLabel: string;
  outing: boolean;
  /** Who else picked it for this meeting: "Finn P, Anjali S +4" (empty when nobody). */
  others: string;
  /** The teacher coming for it, as scouts see them ("Mr. Vest", "Maya S"); null when nobody yet. */
  teacher: string | null;
  /** Its sub-requirements as the Clipboard lists them, the scout's done ones marked (T-4); rank and focus rows. */
  parts?: TopicPart[];
  /** Seeded on this meeting (P3): a rank row in its group carries the mark; Focus rows are all seeded. */
  focus?: boolean;
}

export interface PickGroup {
  rankId: string;
  title: string;
  /** The next rank is open; later ranks start collapsed (unless the scout already picked from one). */
  next: boolean;
  rows: PickRow[];
}

export interface PickListView {
  /** The rank the scout is working toward; null for an Eagle Scout. */
  nextRankId: string | null;
  groups: PickGroup[];
  /** Badges the scout has started and not finished. */
  working: PickRow[];
  /** Every other badge the scout doesn't have, for the search. */
  badges: PickRow[];
  /** Freeform topics a teacher offered on this board ("Knife sharpening"). */
  offered: PickRow[];
  /** Seeded focus groups and merit badge requirements (P3), listed first under "Focus". */
  focus?: PickRow[];
}

export interface PickListInput {
  currentRank: string | null;
  ranks: readonly CatalogRank[];
  rankReqs: readonly CatalogRankRequirement[];
  mbs: readonly CatalogMeritBadge[];
  /** This scout's mb_progress rows. */
  mbProgress: readonly { mb_id: string; awarded: boolean; has_any_req: boolean }[];
  /** This scout's rank-requirement ledger codes ('tenderfoot-4a.1'). */
  rankCodes: ReadonlySet<string>;
  /** Board names of the OTHER scouts who picked each key for this meeting. */
  othersByKey?: ReadonlyMap<string, readonly string[]>;
  /** The scout-facing name of a teacher coming for each key (Phase 2). */
  teacherByKey?: ReadonlyMap<string, string>;
  /** Freeform topics on this board (Phase 2). */
  freeform?: readonly { key: string; title: string }[];
  /** What a planner seeded on this board (P3), with its words. */
  focus?: readonly FocusPickIn[];
}

/** A seeded topic as the pick list takes it. */
export interface FocusPickIn {
  key: string;
  label: string;
  /** 'Focus' for a focus group, 'First Aid 9', 'Tenderfoot 4a'. */
  codeLabel: string;
  parts?: TopicPart[];
}

type RankNode = ReqNode<CatalogRankRequirement>;

export function rankTrees(rankReqs: readonly CatalogRankRequirement[]): Map<string, RankNode[]> {
  const byRank = new Map<string, CatalogRankRequirement[]>();
  for (const r of rankReqs) {
    if (r.code.toLowerCase() === 'bor') continue;
    byRank.set(r.rank_id, [...(byRank.get(r.rank_id) ?? []), r]);
  }
  return new Map([...byRank].map(([rankId, rows]) => [rankId, buildReqTree(rows)]));
}

export function nextRankOf(currentRank: string | null, ranks: readonly CatalogRank[]): string | null {
  const sorted = [...ranks].sort((a, b) => a.sort_order - b.sort_order);
  if (!currentRank) return sorted[0]?.id ?? null;
  const i = sorted.findIndex((r) => r.id === currentRank);
  return i >= 0 && i + 1 < sorted.length ? sorted[i + 1].id : null;
}

/** The tray's second line for a freeform topic. */
export const OFFERED_LABEL = 'Offered this week';
/** A board of review's words: 'Board of review' / 'Tenderfoot board of review'. */
export const BOR_LABEL = 'Board of review';
export const borCodeLabel = (rankName: string) => `${rankName} board of review`;

/** The tray's second line for a focus group, and the pick list's heading for what was seeded (P3). */
export const FOCUS_LABEL = 'Focus';

/** The rank a key belongs to ('tenderfoot-4a' -> tenderfoot); undefined for a badge, freeform, focus group or a merit
 *  badge requirement. Rank ids carry dashes, so the longest match wins. */
export function rankOfKey<R extends Pick<CatalogRank, 'id'>>(key: string, ranks: readonly R[]): R | undefined {
  if (key.startsWith('mb:') || key.startsWith('ff:') || key.startsWith('fg:')) return undefined;
  return [...ranks].sort((a, b) => b.id.length - a.id.length).find((r) => key.startsWith(`${r.id}-`));
}

export function buildPickList(input: PickListInput): PickListView {
  const sorted = [...input.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const nextRankId = nextRankOf(input.currentRank, sorted);
  const trees = rankTrees(input.rankReqs);
  const codes = input.rankCodes as Set<string>;
  const others = (key: string) => othersLabel(input.othersByKey?.get(key) ?? []);
  const teacher = (key: string) => input.teacherByKey?.get(key) ?? null;
  const seeded = new Set((input.focus ?? []).map((f) => f.key));

  const groups: PickGroup[] = [];
  const startAt = nextRankId ? sorted.findIndex((r) => r.id === nextRankId) : sorted.length;
  for (const rank of sorted.slice(startAt)) {
    const tree = trees.get(rank.id) ?? [];
    const rows: PickRow[] = [];
    for (const top of tree) {
      if (rankNodeSatisfied(top, rank.id, codes)) continue;
      if (!rankTopPlannable(tree, rank.id, top, codes)) continue;
      const key = `${rank.id}-${top.code}`;
      rows.push({
        key,
        kind: 'rank',
        code: top.code,
        label: top.label,
        codeLabel: `${rank.display_name} ${top.code}`,
        // Listed either way (a leader may add anything by hand); flagged when a meeting doesn't hold it.
        outing: planningState(topClasses(top), 'meeting') !== 'fits',
        others: others(key),
        teacher: teacher(key),
        parts: topicParts(top, input.rankReqs, codes),
        ...(seeded.has(key) ? { focus: true } : {})
      });
    }
    // The board of review, last, once everything else in the rank is done.
    if (rankBorPickable(tree, rank.id, codes)) {
      const key = borKey(rank.id);
      rows.push({ key, kind: 'rank', code: BOR_CODE, label: BOR_LABEL, codeLabel: borCodeLabel(rank.display_name), outing: false, others: others(key), teacher: teacher(key), ...(seeded.has(key) ? { focus: true } : {}) });
    }
    if (rows.length || rank.id === nextRankId) groups.push({ rankId: rank.id, title: rank.display_name, next: rank.id === nextRankId, rows });
  }

  const awarded = new Set(input.mbProgress.filter((p) => p.awarded).map((p) => p.mb_id));
  const started = new Set(input.mbProgress.filter((p) => !p.awarded && p.has_any_req).map((p) => p.mb_id));
  const badgeRow = (mb: CatalogMeritBadge): PickRow => ({
    key: `mb:${mb.id}`,
    kind: 'mb',
    code: null,
    label: mb.name,
    codeLabel: 'Merit badge',
    outing: false,
    others: others(`mb:${mb.id}`),
    teacher: teacher(`mb:${mb.id}`)
  });
  const byName = [...input.mbs].sort((a, b) => a.name.localeCompare(b.name));
  return {
    nextRankId,
    groups,
    working: byName.filter((m) => started.has(m.id)).map(badgeRow),
    badges: byName.filter((m) => !started.has(m.id) && !awarded.has(m.id)).map(badgeRow),
    offered: [...(input.freeform ?? [])]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((f) => ({ key: f.key, kind: 'ff' as const, code: null, label: f.title, codeLabel: OFFERED_LABEL, outing: false, others: others(f.key), teacher: teacher(f.key) })),
    // A seeded rank requirement is marked in its group (above); everything else seeded is listed here.
    focus: (input.focus ?? [])
      .filter((f) => !rankOfKey(f.key, sorted))
      .map((f) => ({ key: f.key, kind: 'focus' as const, code: f.codeLabel === FOCUS_LABEL ? null : f.codeLabel, label: f.label, codeLabel: f.codeLabel, outing: false, others: others(f.key), teacher: teacher(f.key), parts: f.parts, focus: true }))
  };
}

/** Every row in the view, in list order (the catalog order unranked picks sort by), each key once. */
export function allRows(view: PickListView): PickRow[] {
  const seen = new Set<string>();
  return [...(view.focus ?? []), ...view.offered, ...view.groups.flatMap((g) => g.rows), ...view.working, ...view.badges].filter((r) => !seen.has(r.key) && seen.add(r.key));
}

/** What a scout may add on this board: every listed row except the outing-only ones. The server action checks it. */
export function pickableKeys(view: PickListView): Set<string> {
  return new Set(allRows(view).filter((r) => !r.outing).map((r) => r.key));
}

/**
 * Has the ledger finished this pick? A rank requirement: the scout is at or past that rank (checked first, because
 * historical ranks often lack requirement rows), or the requirement is satisfied on the ledger. A badge: awarded.
 */
export function isPickFinished(
  key: string,
  ctx: {
    currentRank: string | null;
    ranks: readonly CatalogRank[];
    trees: ReadonlyMap<string, RankNode[]>;
    rankCodes: ReadonlySet<string>;
    awardedMbs: ReadonlySet<string>;
  }
): boolean {
  if (key.startsWith('mb:')) return ctx.awardedMbs.has(key.slice(3));
  // A freeform topic, a focus group and a merit badge requirement are never finished (P3: a retake is allowed).
  const rank = rankOfKey(key, ctx.ranks);
  if (!rank) return false;
  const sortOf = new Map(ctx.ranks.map((r) => [r.id, r.sort_order]));
  const mine = ctx.currentRank ? sortOf.get(ctx.currentRank) : undefined;
  if (mine != null && mine >= rank.sort_order) return true;
  if (isBorKey(key)) return ctx.rankCodes.has(borKey(rank.id));
  const code = key.slice(rank.id.length + 1);
  const top = (ctx.trees.get(rank.id) ?? []).find((n) => n.code === code);
  return top ? rankNodeSatisfied(top, rank.id, ctx.rankCodes as Set<string>) : false;
}

/** A pick the scout can't take up: finished, or a rank requirement the rank rules hold back (a Scoutmaster conference
 *  before 95% of the rank). The planner's likely fits use it so they match the pick list and the nudge list. */
export function isPickOutOfReach(key: string, ctx: Parameters<typeof isPickFinished>[1]): boolean {
  if (isPickFinished(key, ctx)) return true;
  const rank = rankOfKey(key, ctx.ranks);
  if (!rank) return false;
  const tree = ctx.trees.get(rank.id) ?? [];
  if (isBorKey(key)) return !rankBorPickable(tree, rank.id, ctx.rankCodes);
  const top = tree.find((n) => n.code === key.slice(rank.id.length + 1));
  return top ? !rankTopPlannable(tree, rank.id, top, ctx.rankCodes as Set<string>) : false;
}

/** What topicWords needs for seeded topics (P3): merit badge requirements, and each focus group's members. */
export interface TopicWordsMore {
  mbReqs?: readonly CatalogMeritBadgeRequirement[];
  /** A focus group's item keys, by its key ('fg:7'). */
  members?: ReadonlyMap<string, readonly string[]>;
}

/** The tray's words for a key: 'First aid' / 'Tenderfoot 4a'. Null for a key the catalog no longer has (or a freeform
 *  topic or focus group whose title wasn't passed; a merit badge requirement without `more.mbReqs`). `freeformTitles`
 *  holds the freeform and focus-group titles. */
export function topicWords(
  key: string,
  ranks: readonly CatalogRank[],
  rankReqs: readonly CatalogRankRequirement[],
  mbs: readonly CatalogMeritBadge[],
  freeformTitles?: ReadonlyMap<string, string>,
  more?: TopicWordsMore
): TopicWords | null {
  if (key.startsWith('ff:')) {
    const title = freeformTitles?.get(key);
    return title ? { label: title, codeLabel: OFFERED_LABEL, kind: 'ff', parts: [], minutes: null } : null;
  }
  if (key.startsWith('fg:')) {
    const title = freeformTitles?.get(key);
    if (!title) return null;
    const parts = (more?.members?.get(key) ?? []).map((k) => itemPart(k, ranks, rankReqs, mbs, more?.mbReqs ?? [])).filter((p): p is TopicPart => p != null);
    return { label: title, codeLabel: FOCUS_LABEL, kind: 'focus', parts, minutes: parts.length ? parts.reduce((n, p) => n + p.minutes, 0) : null };
  }
  if (key.startsWith('mb:')) {
    const mb = mbs.find((m) => m.id === key.slice(3));
    return mb ? { label: mb.name, codeLabel: 'Merit badge', kind: 'mb', parts: [], minutes: null } : null;
  }
  const rank = rankOfKey(key, ranks);
  if (!rank) {
    // A top-level merit badge requirement ('first-aid-9'), seeded on a meeting (P3).
    const row = (more?.mbReqs ?? []).find((r) => r.parent_id == null && `${r.mb_id}-${r.code}` === key);
    const mb = row ? mbs.find((m) => m.id === row.mb_id) : undefined;
    if (!row || !mb) return null;
    const parts = topicParts(row, more?.mbReqs ?? []);
    return { label: row.label, codeLabel: `${mb.name} ${row.code}`, kind: 'mb', parts, minutes: teachMinutes(row, parts) };
  }
  if (isBorKey(key)) return rank.id === 'scout' ? null : { label: BOR_LABEL, codeLabel: borCodeLabel(rank.display_name), kind: 'rank', parts: [], minutes: null };
  const code = key.slice(rank.id.length + 1);
  const row = rankReqs.find((r) => r.rank_id === rank.id && r.code === code && r.parent_id == null);
  if (!row) return null;
  const parts = topicParts(row, rankReqs);
  return { label: row.label, codeLabel: `${rank.display_name} ${code}`, kind: 'rank', parts, minutes: teachMinutes(row, parts) };
}

/** One item of a focus group as its class's part: 'Tenderfoot 4a.1' / 'Cuts', any level. Null when the catalog lost it. */
export function itemPart(
  key: string,
  ranks: readonly CatalogRank[],
  rankReqs: readonly CatalogRankRequirement[],
  mbs: readonly CatalogMeritBadge[],
  mbReqs: readonly CatalogMeritBadgeRequirement[]
): TopicPart | null {
  const rank = rankOfKey(key, ranks);
  const rows: readonly (CatalogRankRequirement | CatalogMeritBadgeRequirement)[] = rank ? rankReqs.filter((r) => r.rank_id === rank.id) : mbReqs;
  const row = rank ? rows.find((r) => r.code === key.slice(rank.id.length + 1)) : mbReqs.find((r) => `${r.mb_id}-${r.code}` === key);
  if (!row) return null;
  const source = rank ? rank.display_name : (mbs.find((m) => m.id === (row as CatalogMeritBadgeRequirement).mb_id)?.name ?? '');
  const kids = rows.filter((r) => r.parent_id === row.id);
  const minutes = kids.length ? kids.reduce((n, r) => n + (r.teach_minutes ?? DEFAULT_TEACH_MINUTES), 0) : (row.teach_minutes ?? DEFAULT_TEACH_MINUTES);
  return { code: `${source} ${row.code}`.trim(), label: row.label, minutes };
}

/** The 15-minute head start every requirement gets until a leader sets its time (T-3). */
export const DEFAULT_TEACH_MINUTES = 15;

/** A sub-requirement of a topic, as the Clipboard lists it (T-4). `done` only on a scout's own pick list. */
export interface TopicPart {
  code: string;
  label: string;
  minutes: number;
  done?: boolean;
}

export interface TopicWords {
  label: string;
  codeLabel: string;
  kind: 'rank' | 'mb' | 'ff' | 'focus';
  /** Sub-requirements (Tenderfoot 4a.1-4a.8); empty when it has none. */
  parts: TopicPart[];
  /** Expected minutes to teach it (T-3); null for a whole badge or a freeform topic. */
  minutes: number | null;
}

/** A top-level requirement's sub-requirements in catalog order; `codes` marks the ones a scout has done (rank only). */
export function topicParts<R extends CatalogRankRequirement | CatalogMeritBadgeRequirement>(row: R, reqs: readonly R[], codes?: ReadonlySet<string>): TopicPart[] {
  return reqs
    .filter((r) => r.parent_id === row.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      code: r.code,
      label: r.label,
      minutes: r.teach_minutes ?? DEFAULT_TEACH_MINUTES,
      ...(codes && 'rank_id' in row ? { done: codes.has(`${row.rank_id}-${r.code}`) } : {})
    }));
}

/** A leader's typed teaching time: whole minutes 1-240 (the column's check), else null. */
export function parseTeachMinutes(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 240 ? n : null;
}

/** "about 25 min", "about 1 hr 15 min"; '' when there is no time (a whole badge, a freeform topic). */
export function minutesText(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${[h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')}`;
}

/** One source of truth: a requirement with sub-requirements takes the sum of theirs, otherwise its own. */
export function teachMinutes(row: { teach_minutes?: number | null }, parts: readonly TopicPart[]): number {
  return parts.length ? parts.reduce((n, p) => n + p.minutes, 0) : (row.teach_minutes ?? DEFAULT_TEACH_MINUTES);
}

export interface TrayPick extends BoardPick {
  label: string;
  codeLabel: string;
  kind: 'rank' | 'mb' | 'ff' | 'focus';
  /** Board name of whoever added it, when that was neither the scout nor the person looking. */
  addedBy: string | null;
}

/** What /member/meeting holds for one scout: their answer and their picks, in tray order. */
export interface ScoutBoardView {
  personId: number;
  intent: Intent | null;
  picks: TrayPick[];
}

/** The tray: ranked picks first, then unranked in the list's order; each with its words. */
export function trayPicks(
  picks: readonly BoardPick[],
  ctx: {
    view: PickListView;
    ranks: readonly CatalogRank[];
    rankReqs: readonly CatalogRankRequirement[];
    mbs: readonly CatalogMeritBadge[];
    names: ReadonlyMap<number, string>;
    scoutPersonId: number;
    viewerPersonId: number | null;
    /** P3: focus-group titles for picks of a topic no longer seeded, and the words' extras. */
    titles?: ReadonlyMap<string, string>;
    more?: TopicWordsMore;
  }
): TrayPick[] {
  const order = new Map(allRows(ctx.view).map((r, i) => [r.key, i]));
  return orderPicks(picks, (k) => order.get(k) ?? Number.MAX_SAFE_INTEGER).map((p) => {
    const seeded = (ctx.view.focus ?? []).find((r) => r.key === p.key);
    const words = seeded
      ? { label: seeded.label, codeLabel: seeded.codeLabel, kind: seeded.kind }
      : (topicWords(p.key, ctx.ranks, ctx.rankReqs, ctx.mbs, new Map([...(ctx.titles ?? []), ...ctx.view.offered.map((r) => [r.key, r.label] as const)]), ctx.more) ?? { label: p.key, codeLabel: '', kind: 'rank' as const });
    const by = p.enteredByPersonId;
    const addedBy = by != null && by !== ctx.scoutPersonId && by !== ctx.viewerPersonId ? boardName(ctx.names.get(by) ?? '') || null : null;
    return { ...p, ...words, addedBy };
  });
}
