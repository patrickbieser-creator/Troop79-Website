/**
 * Station rotations (Plans/Planner-Station-Rotations.md): a merit badge night's focus sets become stations that stay
 * put with their teachers, and traveling groups visit every station, one round each.
 *
 * Who rotates: every scout who hasn't earned the badge, any rank. A scout seeds the group of the rank they work on
 * (none held → Scout, Scout held → Tenderfoot, …); First Class and above fold into the First Class group. There are
 * never more groups than stations: while there are, the two highest-rank groups combine (Patrick, 2026-11-08: keep
 * Scout and Tenderfoot whole, combine Second + First). Group g is at station (g + r) mod N in round r, so with fewer
 * groups than stations a station sits empty some rounds and every group still visits every station.
 *
 * A planner's hand move names a seed rank, not a group, so a move follows whichever merged group holds that rank.
 * Computed on every read, never stored. Pure: no I/O, no framework imports.
 */
import type { CatalogMeritBadgeRequirement, CatalogRank } from '@/lib/advancement-catalog';
import type { FocusProgress, FocusScout, ScoutRole } from '@/lib/focus-plan';

/** The ranks that seed a traveling group, in order. Holders of First Class and above fold into the last one. */
export const ROTATION_RANKS: readonly string[] = ['scout', 'tenderfoot', 'second-class', 'first-class'];

export interface Station {
  /** The meeting topic: 'fg:27'. */
  topicKey: string;
  name: string;
  /** The focus set's teaching time goal; null = not set. */
  goalMinutes: number | null;
  /** The focus set's items: merit badge requirement keys, any level. */
  itemKeys: readonly string[];
}

export interface StationInput {
  ranks: readonly CatalogRank[];
  /** The badge's requirements (others are ignored). */
  mbReqs: readonly CatalogMeritBadgeRequirement[];
  badgeId: string;
  /** In station order. */
  stations: readonly Station[];
  scouts: readonly FocusScout[];
  /** Keyed by scoutId. */
  progress: ReadonlyMap<string, FocusProgress>;
  /** Hand choices: 'none' = unassigned, 'teach' = teaching tonight; others are ignored here. */
  roles?: ReadonlyMap<number, ScoutRole>;
  /** Hand moves: the seed rank a planner put the scout in, by personId. */
  moves?: ReadonlyMap<number, string>;
}

export interface RotationGroup {
  /** The group's first seed rank: 'second-class'. */
  key: string;
  /** Seed ranks in the group, in order. */
  ranks: string[];
  name: string;
  members: number[];
}

export interface RotationStation extends Station {
  /** The checklist cells: the leaf requirement keys under the station's items, in catalog order. */
  cells: string[];
}

export interface RotationRound {
  /** stationOf[g] = the station index group g visits this round. */
  stationOf: number[];
}

export interface RotationRow {
  personId: number;
  groupKey: string;
  /** Cells signed off (or every cell, when the badge is earned). */
  done: string[];
  /** Stations whose every cell is done: the scout stays with the group and can help there. */
  helperAt: string[];
}

export interface StationRotation {
  stations: RotationStation[];
  groups: RotationGroup[];
  rounds: RotationRound[];
  rows: RotationRow[];
  /** Scouts who have earned the badge: they keep today's placement. */
  holders: number[];
  unassigned: number[];
  teaching: number[];
  /** The longest station goal; null when no station has one. */
  roundMinutes: number | null;
  totalMinutes: number | null;
}

/** The rank a scout works on, clamped to the rotation ranks. */
function seedRank(currentRank: string | null, rankOrder: readonly string[]): string {
  if (!currentRank) return ROTATION_RANKS[0];
  const at = rankOrder.indexOf(currentRank);
  const next = at < 0 ? ROTATION_RANKS[0] : rankOrder[at + 1];
  return next && ROTATION_RANKS.includes(next) ? next : ROTATION_RANKS[ROTATION_RANKS.length - 1];
}

export function buildStationRotation(input: StationInput): StationRotation {
  const rankOrder = [...input.ranks].sort((a, b) => a.sort_order - b.sort_order).map((r) => r.id);
  const rankName = new Map(input.ranks.map((r) => [r.id, r.display_name]));
  const badge = input.badgeId;
  const prefix = `${badge}-`;

  // Station cells: the leaves under each item, in catalog order.
  const reqs = input.mbReqs.filter((q) => q.mb_id === badge).sort((a, b) => a.sort_order - b.sort_order);
  const byId = new Map(reqs.map((q) => [q.id, q]));
  const hasChild = new Set(reqs.map((q) => q.parent_id).filter((id): id is number => id !== null));
  const lineage = (q: CatalogMeritBadgeRequirement): string[] => {
    const out: string[] = [];
    for (let at: CatalogMeritBadgeRequirement | undefined = q; at; at = at.parent_id === null ? undefined : byId.get(at.parent_id)) out.push(`${prefix}${at.code}`);
    return out;
  };
  const stations: RotationStation[] = input.stations.map((s) => {
    const items = new Set(s.itemKeys);
    const cells = reqs.filter((q) => !hasChild.has(q.id) && lineage(q).some((k) => items.has(k))).map((q) => `${prefix}${q.code}`);
    return { ...s, cells };
  });
  const N = stations.length;

  // Who rotates, and the seed rank each one starts in.
  const holders: number[] = [];
  const unassigned: number[] = [];
  const teaching: number[] = [];
  const seeds = new Map<string, number[]>(ROTATION_RANKS.map((r) => [r, []]));
  const scoutById = new Map<number, FocusScout>();
  for (const s of input.scouts) {
    scoutById.set(s.personId, s);
    if (input.progress.get(s.scoutId)?.awardedMbs?.has(badge)) {
      holders.push(s.personId);
      continue;
    }
    const role = input.roles?.get(s.personId);
    if (role?.role === 'none') {
      unassigned.push(s.personId);
      continue;
    }
    if (role?.role === 'teach') {
      teaching.push(s.personId);
      continue;
    }
    const moved = input.moves?.get(s.personId);
    const rank = moved && ROTATION_RANKS.includes(moved) ? moved : seedRank(s.currentRank, rankOrder);
    seeds.get(rank)!.push(s.personId);
  }

  // Seed groups, empty ones dropped, then merge from the top until they fit the stations.
  const groups: RotationGroup[] = N === 0 ? [] : ROTATION_RANKS.filter((r) => seeds.get(r)!.length).map((r) => ({ key: r, ranks: [r], name: '', members: [...seeds.get(r)!] }));
  while (groups.length > N) {
    const b = groups.pop()!;
    const a = groups.pop()!;
    groups.push({ key: a.key, ranks: [...a.ranks, ...b.ranks], name: '', members: [...a.members, ...b.members] });
  }
  // A merged group names its ranks: 'Second Class + First Class'.
  for (const g of groups) g.name = g.ranks.map((r) => rankName.get(r) ?? r).join(' + ');

  const rounds: RotationRound[] = Array.from({ length: N }, (_, r) => ({ stationOf: groups.map((_, g) => (g + r) % N) }));

  const rows: RotationRow[] = [];
  for (const g of groups) {
    for (const personId of g.members) {
      const p = input.progress.get(scoutById.get(personId)!.scoutId);
      const isDone = (cell: string) => !!p?.mbCodes.has(cell);
      const done = stations.flatMap((s) => s.cells.filter(isDone));
      const helperAt = stations.filter((s) => s.cells.length && s.cells.every(isDone)).map((s) => s.topicKey);
      rows.push({ personId, groupKey: g.key, done, helperAt });
    }
  }

  const goals = stations.map((s) => s.goalMinutes).filter((m): m is number => m !== null);
  const roundMinutes = goals.length ? Math.max(...goals) : null;
  return { stations, groups, rounds, rows, holders, unassigned, teaching, roundMinutes, totalMinutes: roundMinutes === null ? null : roundMinutes * N };
}
