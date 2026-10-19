/**
 * The scout's pick list for a meeting board (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 16:
 * "order guides but does not restrict"). Pure and client-safe.
 *
 *   1. The next rank's unfinished top-level requirements, open.
 *   2. Later ranks, collapsed, each with its count.
 *   3. Merit badges the scout is working on.
 *   4. Every other badge, behind a search.
 *
 * Finished requirements are absent. The engine's rules decide what can be worked on at a meeting at all (its
 * NOT_PLANNABLE set and the 95% Scoutmaster-conference gate, via lib/rank-calculus); an outing-only requirement is
 * listed but disabled with "Needs an outing". The pick unit is the top-level requirement (Decision 15).
 */
import { buildReqTree, type ReqNode } from '@/lib/mb-helpers';
import { rankNodeSatisfied, rankTopPlannable } from '@/lib/rank-calculus';
import type { CatalogMeritBadge, CatalogRank, CatalogRankRequirement } from '@/lib/advancement-catalog';
import { boardName, orderPicks, othersLabel, type BoardPick, type Intent } from '@/lib/meeting-board-shared';

export interface PickRow {
  key: string;
  kind: 'rank' | 'mb';
  /** The requirement code ('4a') under its rank heading; null for a badge. */
  code: string | null;
  label: string;
  /** 'Tenderfoot 4a' or 'Merit badge'; the tray's second line. */
  codeLabel: string;
  outing: boolean;
  /** Who else picked it for this meeting: "Finn P, Anjali S +4" (empty when nobody). */
  others: string;
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

export function buildPickList(input: PickListInput): PickListView {
  const sorted = [...input.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const nextRankId = nextRankOf(input.currentRank, sorted);
  const trees = rankTrees(input.rankReqs);
  const codes = input.rankCodes as Set<string>;
  const others = (key: string) => othersLabel(input.othersByKey?.get(key) ?? []);

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
        outing: top.venue === 'outing',
        others: others(key)
      });
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
    others: others(`mb:${mb.id}`)
  });
  const byName = [...input.mbs].sort((a, b) => a.name.localeCompare(b.name));
  return {
    nextRankId,
    groups,
    working: byName.filter((m) => started.has(m.id)).map(badgeRow),
    badges: byName.filter((m) => !started.has(m.id) && !awarded.has(m.id)).map(badgeRow)
  };
}

/** Every row in the view, in list order (the catalog order unranked picks sort by). */
export function allRows(view: PickListView): PickRow[] {
  return [...view.groups.flatMap((g) => g.rows), ...view.working, ...view.badges];
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
  if (key.startsWith('ff:')) return false;
  const rank = [...ctx.ranks].sort((a, b) => b.id.length - a.id.length).find((r) => key.startsWith(`${r.id}-`));
  if (!rank) return false;
  const sortOf = new Map(ctx.ranks.map((r) => [r.id, r.sort_order]));
  const mine = ctx.currentRank ? sortOf.get(ctx.currentRank) : undefined;
  if (mine != null && mine >= rank.sort_order) return true;
  const code = key.slice(rank.id.length + 1);
  const top = (ctx.trees.get(rank.id) ?? []).find((n) => n.code === code);
  return top ? rankNodeSatisfied(top, rank.id, ctx.rankCodes as Set<string>) : false;
}

/** The tray's words for a key: 'First aid' / 'Tenderfoot 4a'. Null for a key the catalog no longer has. */
export function topicWords(
  key: string,
  ranks: readonly CatalogRank[],
  rankReqs: readonly CatalogRankRequirement[],
  mbs: readonly CatalogMeritBadge[]
): { label: string; codeLabel: string; kind: 'rank' | 'mb' } | null {
  if (key.startsWith('mb:')) {
    const mb = mbs.find((m) => m.id === key.slice(3));
    return mb ? { label: mb.name, codeLabel: 'Merit badge', kind: 'mb' } : null;
  }
  const rank = [...ranks].sort((a, b) => b.id.length - a.id.length).find((r) => key.startsWith(`${r.id}-`));
  if (!rank) return null;
  const code = key.slice(rank.id.length + 1);
  const row = rankReqs.find((r) => r.rank_id === rank.id && r.code === code && r.parent_id == null);
  return row ? { label: row.label, codeLabel: `${rank.display_name} ${code}`, kind: 'rank' } : null;
}

export interface TrayPick extends BoardPick {
  label: string;
  codeLabel: string;
  kind: 'rank' | 'mb';
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
  }
): TrayPick[] {
  const order = new Map(allRows(ctx.view).map((r, i) => [r.key, i]));
  return orderPicks(picks, (k) => order.get(k) ?? Number.MAX_SAFE_INTEGER).map((p) => {
    const words = topicWords(p.key, ctx.ranks, ctx.rankReqs, ctx.mbs) ?? { label: p.key, codeLabel: '', kind: 'rank' as const };
    const by = p.enteredByPersonId;
    const addedBy = by != null && by !== ctx.scoutPersonId && by !== ctx.viewerPersonId ? boardName(ctx.names.get(by) ?? '') || null : null;
    return { ...p, ...words, addedBy };
  });
}
