/**
 * Merit badge night (Phase 3b of Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 10 and "Merit badge meeting
 * mode"): stations, the rotation draft and the leader's arrangement. PURE and client-safe (no directive, no server
 * imports), so This Sunday, the rotations editor, the meeting editor's tray, /member/meeting and the tests read one
 * definition. Same input (in any order) = same output.
 *
 *   - Stations: the leader sets 2-6 (usually 3-4), each one or more of the badge's TOP-LEVEL requirements plus an
 *     optional place ("back room"). There are as many rotations as stations; group i is at station (i + r) mod n in
 *     rotation r, so every group visits every station once.
 *   - Who rotates: every scout who said Coming, and every "Not sure yet" scout (placed too, and marked: Decision 4's "put
 *     me where it makes sense"), who doesn't have the badge. On a merit badge night a carried rank pick is HELD, so it
 *     doesn't make a scout Coming (boardIntent). A scout who didn't answer isn't placed; the leader can add them.
 *   - Has the badge (mb_progress.awarded, checked first): never in a group; listed for a leader to place as a helper
 *     at a station or on other work.
 *   - Finished a station (every one of its requirements satisfied on the ledger, the engine's mbNodeSatisfied): the
 *     scout still travels with their group, and that rotation is "Free: help out".
 *   - Groups: at most 8 (the engine's cap). As many groups as stations, more when it takes that to stay at 8 (two groups
 *     then share a station). The draft keeps patrols together where it can and balances sizes (unpinned groups differ
 *     by at most one), deterministically.
 *   - The leader's arrangement is a SAVED ARRANGEMENT ON TOP OF THE LIVE DRAFT: saving pins everyone shown where they
 *     are. Later, a scout who signs up late is drafted into the arrangement (their patrol's group if it has room, else
 *     the smallest) and flagged "new since you saved"; a scout who drops out just disappears; a pinned scout never
 *     moves. A pure snapshot would leave late sign-ups out; pinning only the moves would reshuffle groups the leader had
 *     already accepted.
 */
import type { CatalogMeritBadgeRequirement } from '@/lib/advancement-catalog';
import { buildReqTree, type ReqNode } from '@/lib/mb-helpers';
import { mbNodeSatisfied } from '@/lib/rank-calculus';
import { effectiveIntent, type BoardMode, type BoardPick, type Intent } from '@/lib/meeting-board-shared';

/** Scouts per rotation group: the engine's group cap. */
export const ROTATION_GROUP_CAP = 8;
export const MIN_STATIONS = 2;
export const MAX_STATIONS = 6;
/** A station's name and place, as stored (the RPC trims and refuses longer). */
export const STATION_TITLE_MAX = 80;
export const STATION_PLACE_MAX = 60;

type MbReq = Pick<CatalogMeritBadgeRequirement, 'id' | 'mb_id' | 'parent_id' | 'code' | 'label' | 'complete_rule' | 'complete_n' | 'sort_order' | 'venue'>;

/** A station as the leader set it. `index` is 0-based, in the leader's order. */
export interface Station {
  index: number;
  /** The station's meeting_topics row (null in an unsaved draft). Teachers commit to it; helpers are placed by it. */
  topicId: number | null;
  /** '<mbId>-<lead code>', the topic_key teachers commit through. */
  key: string;
  title: string;
  location: string | null;
  /** Top-level requirement codes, catalog order. */
  codes: string[];
}

/** A station the leader is editing (no ids yet): what meeting_set_stations takes. */
export interface StationDraft {
  /** The saved station this edits, so its teachers stay with it; null for a new one. */
  topicId: number | null;
  title: string;
  location: string;
  codes: string[];
}

/**
 * Who counts as coming. A pick for this meeting implies Coming (Phase 1's rule, rank and closed boards alike); on a
 * merit badge night picks are held for the next regular meeting, so only an explicit answer counts.
 */
export function boardIntent(mode: BoardMode, explicit: Intent | null, picks: readonly Pick<BoardPick, 'later'>[]): Intent | null {
  return mode === 'merit_badge' ? explicit : effectiveIntent(explicit, picks);
}

/** 'A', 'B', … 'Z', then 'AA'. */
export function groupLabel(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${groupLabel(Math.floor(i / 26) - 1)}${groupLabel(i % 26)}`;
}

/** The badge's top-level requirements, in catalog order (the units a station is built from). */
export function badgeTops(mbId: string, mbReqs: readonly MbReq[]): ReqNode<MbReq>[] {
  return buildReqTree(mbReqs.filter((r) => r.mb_id === mbId).map((r) => ({ ...r })));
}

/** Codes in catalog order, unknown codes last (alphabetically). */
export function sortCodes(codes: readonly string[], tops: readonly Pick<MbReq, 'code' | 'sort_order'>[]): string[] {
  const at = new Map(tops.map((t) => [t.code, t.sort_order]));
  return [...new Set(codes)].sort((a, b) => (at.get(a) ?? 1e9) - (at.get(b) ?? 1e9) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The topic_key a station's teachers commit through: the badge and its first requirement. */
export function stationKey(mbId: string, codes: readonly string[]): string {
  return `${mbId}-${codes[0] ?? ''}`;
}

const shorten = (s: string, max: number) => {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[,;:.]$/, '')}…`;
};

/**
 * A starting set of stations from the badge's top-level requirements, for the leader to edit: the meeting-doable ones
 * (venue isn't outing; all of them if every one is an outing), in catalog order, split into at most 4 runs of near-equal
 * size. One requirement is its own station, named by its words; a run is "Requirements 3-5". No place set.
 */
export function defaultStations(mbId: string, mbReqs: readonly MbReq[]): StationDraft[] {
  const tops = badgeTops(mbId, mbReqs);
  const doable = tops.filter((t) => t.venue !== 'outing');
  const use = doable.length ? doable : tops;
  if (!use.length) return [];
  const n = Math.min(4, use.length);
  const out: StationDraft[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.floor(use.length / n) + (i < use.length % n ? 1 : 0);
    const run = use.slice(at, at + size);
    at += size;
    const title = run.length === 1 ? shorten(`${run[0].code}. ${run[0].label}`, 48) : `Requirements ${run[0].code}–${run[run.length - 1].code}`;
    out.push({ topicId: null, title, location: '', codes: run.map((r) => r.code) });
  }
  return out;
}

export type StationProblem = 'title' | 'codes' | 'shared';

/**
 * What stops a set of stations from saving, per station (the RPC refuses the same): a name, at least one requirement,
 * no requirement in two stations; and 2-6 stations in all.
 */
export function stationProblems(stations: readonly Pick<StationDraft, 'title' | 'codes'>[]): { count: 'few' | 'many' | null; each: StationProblem[][] } {
  const seen = new Map<string, number>();
  for (const s of stations) for (const c of new Set(s.codes)) seen.set(c, (seen.get(c) ?? 0) + 1);
  return {
    count: stations.length < MIN_STATIONS ? 'few' : stations.length > MAX_STATIONS ? 'many' : null,
    each: stations.map((s) => {
      const p: StationProblem[] = [];
      if (!s.title.trim()) p.push('title');
      if (!s.codes.length) p.push('codes');
      if (s.codes.some((c) => (seen.get(c) ?? 0) > 1)) p.push('shared');
      return p;
    })
  };
}

/** Has this scout finished this station: every one of its requirements satisfied on the ledger? */
export function stationFinished(station: Pick<Station, 'codes'>, mbId: string, tops: readonly ReqNode<MbReq>[], codes: ReadonlySet<string>): boolean {
  if (!station.codes.length) return false;
  return station.codes.every((c) => {
    const top = tops.find((t) => t.code === c);
    return top ? mbNodeSatisfied(top, mbId, codes) : false;
  });
}

/** Where the leader put someone: a group (0-based), a helper at a station (by its topic), or other work. */
export type Placement = { kind: 'group'; group: number } | { kind: 'helper'; topicId: number } | { kind: 'other' };

export interface RotationScout {
  personId: number;
  patrol: string | null;
  /** The answer that counts on this night (boardIntent): only coming and undecided are passed in. */
  intent: 'coming' | 'undecided';
  /** mb_progress.awarded for this badge. */
  awarded: boolean;
  /** Merit badge requirement ledger codes ('first-aid-1a') for this badge. */
  mbCodes: ReadonlySet<string>;
}

export interface RotationInput {
  mbId: string;
  stations: readonly Station[];
  /** The badge's top-level requirement trees (badgeTops). */
  tops: readonly ReqNode<MbReq>[];
  scouts: readonly RotationScout[];
  /** The saved arrangement for this meeting, by person. Empty = the matcher's draft. */
  placements: ReadonlyMap<number, Placement>;
}

export interface RotationMember {
  personId: number;
  /** Saved where it is by the leader. */
  pinned: boolean;
  /** Drafted into a saved arrangement after it was saved (a late sign-up). */
  isNew: boolean;
  undecided: boolean;
  /** Stations (by index) they have already finished: that rotation is "Free: help out". */
  skips: number[];
}

export interface RotationGroup {
  index: number;
  label: string;
  members: RotationMember[];
  /** Station index for each rotation. */
  schedule: number[];
}

export interface RotationResult {
  rotations: number;
  groups: RotationGroup[];
  /** Coming (or not sure) and has the badge: help teach or other work. `placement` null = not placed yet. */
  badgeHolders: { personId: number; undecided: boolean; placement: { kind: 'helper'; station: number } | { kind: 'other' } | null }[];
  /** A leader saved an arrangement (some placement exists). */
  arranged: boolean;
  /** Groups over the cap (the leader may still save one; it's their call on the night). */
  overCap: number[];
}

const byNum = (a: number, b: number) => a - b;
const strCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** How many groups: as many as stations, more if that's what keeps every group at 8 or fewer. */
export function groupCount(stations: number, scouts: number): number {
  return Math.max(stations, Math.ceil(scouts / ROTATION_GROUP_CAP), stations ? 1 : 0);
}

export function draftRotations(input: RotationInput): RotationResult {
  const n = input.stations.length;
  const stations = [...input.stations].sort((a, b) => a.index - b.index);
  const scouts = [...input.scouts].sort((a, b) => a.personId - b.personId);
  const rot = scouts.filter((s) => !s.awarded);
  const holders = scouts.filter((s) => s.awarded);
  const arranged = input.placements.size > 0;
  if (!n) {
    return { rotations: 0, groups: [], badgeHolders: holders.map((h) => ({ personId: h.personId, undecided: h.intent === 'undecided', placement: null })), arranged, overCap: [] };
  }
  const g = groupCount(n, rot.length);
  const target = Math.max(1, Math.ceil(rot.length / g));

  const groups: number[][] = Array.from({ length: g }, () => []);
  const pinned = new Set<number>();
  for (const s of rot) {
    const p = input.placements.get(s.personId);
    if (p?.kind === 'group' && Number.isInteger(p.group) && p.group >= 0 && p.group < g) {
      groups[p.group].push(s.personId);
      pinned.add(s.personId);
    }
  }
  const patrolOf = new Map(rot.map((s) => [s.personId, s.patrol?.trim() || null]));
  const mates = (gi: number, patrol: string | null) => (patrol ? groups[gi].filter((id) => patrolOf.get(id) === patrol).length : 0);
  const smallest = (ok: (gi: number) => boolean, patrol: string | null) => {
    let best = -1;
    for (let gi = 0; gi < g; gi++) {
      if (!ok(gi)) continue;
      if (best < 0) {
        best = gi;
        continue;
      }
      const d = mates(gi, patrol) - mates(best, patrol) || groups[best].length - groups[gi].length;
      if (d > 0) best = gi;
    }
    return best;
  };

  // Units: a patrol's unplaced scouts together (biggest patrol first), then scouts with no patrol, by id.
  const free = rot.filter((s) => !pinned.has(s.personId));
  const byPatrol = new Map<string, number[]>();
  const loose: number[] = [];
  for (const s of free) {
    const p = patrolOf.get(s.personId);
    if (p) byPatrol.set(p, [...(byPatrol.get(p) ?? []), s.personId]);
    else loose.push(s.personId);
  }
  const units = [...byPatrol].sort(([a, x], [b, y]) => y.length - x.length || strCmp(a, b)).map(([patrol, ids]) => ({ patrol: patrol as string | null, ids }));
  for (const id of loose) units.push({ patrol: null, ids: [id] });

  for (const u of units) {
    // Patrol mates already pinned somewhere with room pull the unit there; otherwise the smallest group the whole
    // unit fits in; otherwise one at a time, each beside the most patrol mates with room.
    const withMates = arranged ? smallest((gi) => mates(gi, u.patrol) > 0 && groups[gi].length + u.ids.length <= target, u.patrol) : -1;
    const whole = withMates >= 0 ? withMates : smallest((gi) => groups[gi].length + u.ids.length <= target, null);
    if (whole >= 0) {
      groups[whole].push(...u.ids);
      continue;
    }
    for (const id of u.ids) {
      let gi = smallest((x) => groups[x].length < target, u.patrol);
      if (gi < 0) gi = smallest((x) => groups[x].length < ROTATION_GROUP_CAP, u.patrol);
      if (gi < 0) gi = smallest(() => true, null);
      groups[gi].push(id);
    }
  }

  // Balance: groups differ by at most one, moving only drafted scouts, the one whose move breaks the fewest patrols.
  for (let guard = 0; guard < rot.length * g; guard++) {
    const sizes = groups.map((x) => x.length);
    const hi = sizes.indexOf(Math.max(...sizes));
    const lo = sizes.indexOf(Math.min(...sizes));
    if (sizes[hi] - sizes[lo] <= 1) break;
    const movable = groups[hi].filter((id) => !pinned.has(id));
    if (!movable.length) break;
    const cost = (id: number) => {
      const p = patrolOf.get(id) ?? null;
      return mates(hi, p) - 1 - mates(lo, p);
    };
    const pickId = [...movable].sort((a, b) => cost(a) - cost(b) || b - a)[0];
    groups[hi] = groups[hi].filter((id) => id !== pickId);
    groups[lo].push(pickId);
  }

  const scoutOf = new Map(rot.map((s) => [s.personId, s]));
  const outGroups: RotationGroup[] = groups.map((ids, gi) => ({
    index: gi,
    label: groupLabel(gi),
    schedule: Array.from({ length: n }, (_, r) => stations[(gi + r) % n].index),
    members: [...ids].sort(byNum).map((id) => {
      const s = scoutOf.get(id)!;
      return {
        personId: id,
        pinned: pinned.has(id),
        isNew: arranged && !pinned.has(id),
        undecided: s.intent === 'undecided',
        skips: stations.filter((st) => stationFinished(st, input.mbId, input.tops, s.mbCodes)).map((st) => st.index)
      };
    })
  }));

  const stationOfTopic = new Map(stations.filter((s) => s.topicId != null).map((s) => [s.topicId!, s.index]));
  return {
    rotations: n,
    groups: outGroups,
    badgeHolders: holders.map((h) => {
      const p = input.placements.get(h.personId);
      const placement =
        p?.kind === 'other' ? ({ kind: 'other' } as const) : p?.kind === 'helper' && stationOfTopic.has(p.topicId) ? ({ kind: 'helper', station: stationOfTopic.get(p.topicId)! } as const) : null;
      return { personId: h.personId, undecided: h.intent === 'undecided', placement };
    }),
    arranged,
    overCap: outGroups.filter((x) => x.members.length > ROTATION_GROUP_CAP).map((x) => x.index)
  };
}

/** One scout's group and their night, rotation by rotation ("Rotation 2: Free: help out"). Null when not in a group. */
export function scoutRotation(r: RotationResult, personId: number): { group: RotationGroup; stops: { rotation: number; station: number; free: boolean }[] } | null {
  const group = r.groups.find((x) => x.members.some((m) => m.personId === personId));
  if (!group) return null;
  const me = group.members.find((m) => m.personId === personId)!;
  return { group, stops: group.schedule.map((station, i) => ({ rotation: i + 1, station, free: me.skips.includes(station) })) };
}

/** Who comes to one station, rotation by rotation: the groups there and how many of them work on it (not skipping). */
export function stationVisitors(r: RotationResult, station: number): { rotation: number; groups: { label: string; working: number; free: number }[] }[] {
  return Array.from({ length: r.rotations }, (_, i) => ({
    rotation: i + 1,
    groups: r.groups
      .filter((x) => x.schedule[i] === station)
      .map((x) => {
        const free = x.members.filter((m) => m.skips.includes(station)).length;
        return { label: x.label, working: x.members.length - free, free };
      })
  }));
}

/** The placements a leader's edited arrangement saves: everyone in a group pinned there, badge holders as placed. */
export function arrangementPlacements(
  groups: readonly { members: readonly { personId: number }[] }[],
  holders: readonly { personId: number; placement: { kind: 'helper'; topicId: number } | { kind: 'other' } | null }[]
): { personId: number; placement: Placement }[] {
  const out: { personId: number; placement: Placement }[] = [];
  groups.forEach((g, gi) => g.members.forEach((m) => out.push({ personId: m.personId, placement: { kind: 'group', group: gi } })));
  for (const h of holders) if (h.placement) out.push({ personId: h.personId, placement: h.placement });
  return out.sort((a, b) => a.personId - b.personId);
}

/** What the board knows about one merit badge night, as the member page reads it (RotationBoard's pure half). */
export interface NightSource {
  stations: readonly Station[];
  result: RotationResult;
  /** Station index → the people teaching it. */
  teachersAt: ReadonlyMap<number, readonly number[]>;
  /** Every active scout who has the badge, whatever their answer. */
  badgeHolderIds: readonly number[];
}

/** One scout's merit badge night as their page says it. Serializable (it crosses to the client). */
export interface MbScoutLines {
  hasBadge: boolean;
  /** A badge holder placed as a helper: "Fire safety (back room)". */
  helping: string | null;
  otherWork: boolean;
  /** 'B' once the draft has them in a group. */
  group: string | null;
  stops: { rotation: number; title: string; place: string | null; teacher: string; free: boolean }[];
}

const placeOf = (s: Pick<Station, 'title' | 'location'>) => (s.location ? `${s.title} (${s.location})` : s.title);

export function mbScoutLines(src: NightSource, personId: number, teacherOf: (personId: number) => string): MbScoutLines {
  const st = (i: number) => src.stations.find((s) => s.index === i);
  const holder = src.result.badgeHolders.find((h) => h.personId === personId);
  const mine = scoutRotation(src.result, personId);
  const helperAt = holder?.placement?.kind === 'helper' ? st(holder.placement.station) : undefined;
  return {
    hasBadge: src.badgeHolderIds.includes(personId) || !!holder,
    helping: helperAt ? placeOf(helperAt) : null,
    otherWork: holder?.placement?.kind === 'other',
    group: mine?.group.label ?? null,
    stops: (mine?.stops ?? []).map((x) => {
      const s = st(x.station);
      return {
        rotation: x.rotation,
        title: s?.title ?? '',
        place: s?.location ?? null,
        teacher: (src.teachersAt.get(x.station) ?? []).map(teacherOf).filter(Boolean).join(', '),
        free: x.free
      };
    })
  };
}

/** A station on the teach section of a merit badge night. Serializable. */
export interface StationTeachLine {
  key: string;
  index: number;
  title: string;
  place: string | null;
  /** "Cooking 1, 2". */
  codes: string;
  /** Who else is teaching it (not this person). */
  others: string[];
  mine: boolean;
  /** Who comes to it, rotation by rotation ("Rotation 1: Group A, 6 scouts"), for the person teaching it. */
  visits: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function stationTeachLines(src: Pick<NightSource, 'stations' | 'result' | 'teachersAt'>, personId: number, mbName: string, nameOf: (personId: number) => string): StationTeachLine[] {
  return [...src.stations]
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      const teachers = src.teachersAt.get(s.index) ?? [];
      const mine = teachers.includes(personId);
      return {
        key: s.key,
        index: s.index,
        title: s.title,
        place: s.location,
        codes: `${mbName} ${s.codes.join(', ')}`,
        others: teachers.filter((id) => id !== personId).map(nameOf).filter(Boolean),
        mine,
        visits: mine
          ? stationVisitors(src.result, s.index).map(
              (v) =>
                `Rotation ${v.rotation}: ${
                  v.groups.length
                    ? v.groups.map((g) => `Group ${g.label}, ${plural(g.working, 'scout')}${g.free ? ` (${g.free} already done: helping out)` : ''}`).join('; ')
                    : 'no group'
                }`
            )
          : []
      };
    });
}
