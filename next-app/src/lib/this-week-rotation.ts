/**
 * Station rotations on This week (Plans/Planner-Station-Rotations.md): the rotation's part of the view model. When
 * Stations is on and every station comes from one merit badge, the station focus sets leave the ordinary groups and
 * every scout without the badge goes into a rotation group (lib/station-rotation); holders, unassigned and teaching
 * scouts stay on today's placement. Pure and serializable.
 */
import type { AdvancementCatalog, CatalogMeritBadgeRequirement } from '@/lib/advancement-catalog';
import type { FocusProgress, ScoutRole } from '@/lib/focus-plan';
import { buildStationRotation } from '@/lib/station-rotation';
import type { MeetingRotation } from '@/lib/station-rotation-db';
import type { TeacherPerson } from '@/lib/meeting-board-teach';

type Catalog = Pick<AdvancementCatalog, 'ranks' | 'meritBadges' | 'meritBadgeRequirements'>;

export interface TwRotationPerson {
  personId: number;
  name: string;
  rank: string | null;
  rankName: string;
}

export interface TwRotationStation {
  key: string;
  title: string;
  goalMinutes: number | null;
  /** The checklist cells: the station's leaf requirements, in catalog order. */
  cells: { key: string; code: string; label: string }[];
  teachers: { personId: number; name: string }[];
}

export interface TwRotationMember extends TwRotationPerson {
  /** Cells signed off. */
  done: string[];
  /** Station keys the scout has finished: they stay with the group and can help there (a hint only). */
  helperAt: string[];
  /** A planner moved them into this group. */
  hand?: boolean;
  /** Station rotations step 4: what else they're in tonight, by title ("Also in: …"). */
  also?: string[];
}

export interface TwRotationGroup {
  number: number;
  name: string;
  /** The quiet subtitle: the ranks the draft seeded the group from. */
  seededFrom: string;
  members: TwRotationMember[];
}

export interface TwRotation {
  on: boolean;
  /** Why the rotation isn't running although the switch is on: no stations, or stations from more than one badge. */
  problem: 'empty' | 'mixed' | null;
  badgeId: string | null;
  badgeName: string | null;
  stations: TwRotationStation[];
  groups: TwRotationGroup[];
  /** rounds[r][g] = the station index group g visits in round r. */
  rounds: number[][];
  roundMinutes: number | null;
  totalMinutes: number | null;
}

export interface RotationIn {
  catalog: Catalog;
  rotation: MeetingRotation | undefined;
  /** The night's focus sets with their frozen items. */
  focus: readonly { key: string; title: string; members: readonly string[] }[];
  scouts: readonly { personId: number; scoutId: string; name: string; currentRank: string | null; intent: null | string }[];
  progress: ReadonlyMap<string, FocusProgress>;
  roles: ReadonlyMap<number, ScoutRole>;
  /** Planners' moves into rotation Group N, by personId. */
  moves?: ReadonlyMap<number, number>;
  topicTeachers: readonly { key: string; personId: number }[];
  teachers: readonly TeacherPerson[];
  /** The display name for a person row (This week's boardName). */
  nameOf: (name: string) => string;
  /** A teacher's display name (This week's teacherName for the admin audience). */
  teacherNameOf: (p: TeacherPerson) => string;
}

export interface RotationOut {
  view: TwRotation | null;
  /** Focus keys that are stations while the rotation runs: they leave the ordinary groups. */
  stationKeys: ReadonlySet<string>;
  /** Scouts in a rotation group: they leave the ordinary placement. */
  rotating: ReadonlySet<number>;
}

const NEW_SCOUT = 'New scout';

/** The badge a requirement key belongs to: the longest badge id that names one of its requirements. */
function badgeOf(key: string, reqs: readonly CatalogMeritBadgeRequirement[], mbIds: readonly string[]): string | null {
  return mbIds.find((id) => key.startsWith(`${id}-`) && reqs.some((q) => q.mb_id === id && `${id}-${q.code}` === key)) ?? null;
}

export function rotationOf(input: RotationIn): RotationOut {
  const none: RotationOut = { view: null, stationKeys: new Set(), rotating: new Set() };
  const r = input.rotation;
  if (!r) return none;
  const { catalog } = input;
  const focusBy = new Map(input.focus.map((f) => [f.key, f]));
  const stationsIn = r.stations.filter((s) => focusBy.has(s.key));
  const mbIds = catalog.meritBadges.map((m) => m.id).sort((a, b) => b.length - a.length);
  const badges = new Set(stationsIn.flatMap((s) => focusBy.get(s.key)!.members.map((k) => badgeOf(k, catalog.meritBadgeRequirements, mbIds))));
  const badgeId = badges.size === 1 && !badges.has(null) ? [...badges][0]! : null;
  const problem: TwRotation['problem'] = !r.on ? null : !stationsIn.length ? 'empty' : badgeId === null ? 'mixed' : null;

  const rankName = new Map(catalog.ranks.map((x) => [x.id, x.display_name]));
  const teacherBy = new Map(input.teachers.map((t) => [t.personId, t]));
  const reqByKey = new Map(catalog.meritBadgeRequirements.map((q) => [`${q.mb_id}-${q.code}`, q]));

  const engine = buildStationRotation({
    ranks: catalog.ranks,
    mbReqs: badgeId ? catalog.meritBadgeRequirements.filter((q) => q.mb_id === badgeId) : [],
    badgeId: badgeId ?? '',
    stations: stationsIn.map((s) => ({ topicKey: s.key, name: s.title, goalMinutes: s.goalMinutes, itemKeys: focusBy.get(s.key)!.members })),
    scouts: input.scouts.map((s) => ({ personId: s.personId, scoutId: s.scoutId, name: s.name, currentRank: s.currentRank, intent: null })),
    progress: input.progress,
    roles: input.roles,
    moves: input.moves
  });
  const running = r.on && problem === null;
  const scoutBy = new Map(input.scouts.map((s) => [s.personId, s]));
  const person = (id: number): TwRotationPerson => {
    const s = scoutBy.get(id)!;
    return { personId: id, name: input.nameOf(s.name), rank: s.currentRank, rankName: s.currentRank ? (rankName.get(s.currentRank) ?? s.currentRank) : NEW_SCOUT };
  };
  const rowBy = new Map(engine.rows.map((x) => [x.personId, x]));

  const view: TwRotation = {
    on: r.on,
    problem,
    badgeId,
    badgeName: badgeId ? (catalog.meritBadges.find((m) => m.id === badgeId)?.name ?? badgeId) : null,
    stations: (running ? engine.stations : stationsIn.map((s) => ({ topicKey: s.key, name: s.title, goalMinutes: s.goalMinutes, cells: [] as string[] }))).map((s) => ({
      key: s.topicKey,
      title: s.name,
      goalMinutes: s.goalMinutes,
      cells: s.cells.map((k) => ({ key: k, code: reqByKey.get(k)?.code ?? k, label: reqByKey.get(k)?.label ?? '' })),
      teachers: input.topicTeachers
        .filter((t) => t.key === s.topicKey && teacherBy.has(t.personId))
        .map((t) => ({ personId: t.personId, name: input.teacherNameOf(teacherBy.get(t.personId)!) }))
    })),
    groups: running
      ? engine.groups.map((g) => ({
          number: g.number,
          name: g.name,
          seededFrom: g.seededFrom,
          members: g.members.map((id) => ({ ...person(id), done: rowBy.get(id)?.done ?? [], helperAt: rowBy.get(id)?.helperAt ?? [], hand: rowBy.get(id)?.hand ?? false, also: [] as string[] }))
        }))
      : [],
    rounds: running ? engine.rounds.map((x) => x.stationOf) : [],
    roundMinutes: running ? engine.roundMinutes : null,
    totalMinutes: running ? engine.totalMinutes : null
  };
  return {
    view,
    stationKeys: running ? new Set(stationsIn.map((s) => s.key)) : new Set(),
    rotating: running ? new Set(engine.groups.flatMap((g) => g.members)) : new Set()
  };
}
