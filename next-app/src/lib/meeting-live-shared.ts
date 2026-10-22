/**
 * Meeting Live's pure side (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8c, 8d; the tech-lead's P4 spec sections 3
 * and 6). Client-safe: no I/O, so the Live screen, the loaders and the tests read one definition.
 *
 *   - liveConflicts: the conflict lines (a port of the mock's warningsFor / overlapCount). A scout in two repeats of a
 *     class, a scout in two classes in one rotation, a teacher teaching twice in one rotation. Shown, never enforced
 *     (8d): nothing stops a leader from placing anyone anywhere.
 *   - snapshotFromMatch: what the first Live write copies from the matcher. Rotation = the matcher's half + 1, so
 *     rotations 1 and 2 always exist; each class takes its lead key's topic (merged sibling picks keep their title as a
 *     snapshot); an offer with a teacher and no takers becomes a Not scheduled card. Skill offers with no takers have
 *     no topic and are left out; co-teachers are not carried (a known gap).
 *   - placementAsMatch: a saved placement as a MatchResult, so every reader of the match (the member page, the agenda
 *     tray, v1's Admin Sunday tab) reads the saved placement once Live has started. Given the board, "coming, nothing
 *     assigned" is coming − placed − teaching and the "Not sure yet" scouts say whether they're placed (qa-lead, P4a:
 *     the other screens must not go quiet); wanted and offered stay empty: the saved placement is the truth.
 *   - buildLiveView: the cards, repeats, retake stars, conflicts and the "Coming, nothing assigned" pool the Live
 *     screen draws, from either the preview or the saved placement.
 */
import type { MatchResult, MatchSession } from '@/lib/meeting-board-match';
import { effectiveIntent, type BoardPick, type Intent } from '@/lib/meeting-board-shared';

export type LiveKind = 'rank' | 'mb' | 'ff' | 'focus';

export interface LiveRotation {
  number: number;
  /** "Back room"; null when nobody set one. */
  location: string | null;
}

/** A class as the view model and the conflict rules see it. `id`: 'c:<class id>' saved, 's:<matcher session>' preview. */
export interface LiveClassIn {
  id: string;
  topicKey: string;
  /** Null = Not scheduled. */
  rotation: number | null;
  title: string;
  codeLabel: string;
  kind: LiveKind;
  teacherId: number | null;
  memberIds: readonly number[];
  position: number;
  /** The card's version (P4b's stale-write check); a preview card is 1, what meeting_live_start gives it. */
  version: number;
}

export interface LiveMember {
  personId: number;
  name: string;
  /** Already completed this class (8c): a small star on the chip; placing them is still allowed. */
  retake: boolean;
  /** Marked here (event_attendance, P4c). */
  present: boolean;
  /** A Meeting Live visitor (a guest person, P4c). */
  visitor: boolean;
}

export interface LiveCard {
  id: string;
  topicKey: string;
  rotation: number | null;
  title: string;
  codeLabel: string;
  kind: LiveKind;
  teacher: { personId: number; name: string; present: boolean } | null;
  members: LiveMember[];
  /** The rotations of this class's other repeats (null = a Not scheduled repeat). Empty when it isn't repeated. */
  repeats: (number | null)[];
  /** Conflict lines for this card, in card order. */
  conflicts: string[];
  /** Sent back with every card write (P4b): a mismatch means someone else changed it first. */
  version: number;
}

export interface LiveView {
  /** Meeting Live has started: the cards are the saved placement. False = the matcher's preview. */
  started: boolean;
  rotations: LiveRotation[];
  /** Rotation order (Not scheduled last), then position. */
  cards: LiveCard[];
  /** Coming (or here), nothing assigned. */
  pool: { personId: number; name: string; present: boolean; visitor: boolean }[];
  /** How many overlapping pairs need fixing (the header's red count). */
  overlaps: number;
}

export const rotationWord = (n: number | null) => (n == null ? 'Not scheduled' : `Rotation ${n}`);

/** 'A', 'A and B', 'A, B and C'. */
export function joinNames(names: readonly string[]): string {
  if (names.length < 3) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type ConflictClass = Pick<LiveClassIn, 'id' | 'topicKey' | 'rotation' | 'title' | 'teacherId' | 'memberIds'>;

/** Conflict lines by class id, and the number of overlapping pairs (each pair and each kind counted once). */
export function liveConflicts(classes: readonly ConflictClass[], nameOf: (personId: number) => string): { lines: Map<string, string[]>; count: number } {
  const lines = new Map<string, string[]>(classes.map((c) => [c.id, []]));
  let count = 0;
  for (let i = 0; i < classes.length; i++) {
    for (let j = 0; j < classes.length; j++) {
      if (i === j) continue;
      const c = classes[i];
      const o = classes[j];
      const both = c.memberIds.filter((x) => o.memberIds.includes(x)).map(nameOf);
      const sameRotation = c.rotation != null && o.rotation === c.rotation;
      const out = lines.get(c.id)!;
      if (o.topicKey === c.topicKey && both.length) {
        out.push(`${joinNames(both)} also in the ${o.rotation != null ? `Rotation ${o.rotation}` : 'unscheduled'} repeat of this class`);
        if (i < j) count++;
      } else if (sameRotation && both.length) {
        out.push(`${joinNames(both)} also in ${o.title} this rotation`);
        if (i < j) count++;
      }
      if (sameRotation && c.teacherId != null && o.teacherId === c.teacherId) {
        out.push(`${nameOf(c.teacherId)} is also teaching ${o.title} this rotation`);
        if (i < j) count++;
      }
    }
  }
  return { lines, count };
}

// ── the snapshot the first Live write copies ─────────────────────────────────────────────────────────────────────

export interface LiveSnapshotClass {
  /** The matcher session it came from (or 'offer:<teacher>:<key>'); the preview's card id is 's:' + this. */
  sourceKey: string;
  topicKey: string;
  /** A title snapshot for merged sibling picks; null = the topic's own words. */
  title: string | null;
  rotation: number | null;
  teacherId: number | null;
  position: number;
  memberIds: number[];
}

export interface LiveSnapshot {
  rotations: LiveRotation[];
  classes: LiveSnapshotClass[];
}

export const previewId = (sourceKey: string) => `s:${sourceKey}`;
export const savedId = (classId: number) => `c:${classId}`;

/** The matcher's output as a placement. `titleOf(keys)` names merged sibling picks ('First Aid'). */
export function snapshotFromMatch(match: MatchResult, titleOf: (keys: readonly string[]) => string | null): LiveSnapshot {
  const classes: LiveSnapshotClass[] = [];
  const at = new Map<number | null, number>();
  const nextPos = (r: number | null) => {
    const n = at.get(r) ?? 0;
    at.set(r, n + 1);
    return n;
  };
  for (const s of match.sessions) {
    if (!s.keys.length) continue;
    const rotation = s.half + 1;
    classes.push({
      sourceKey: s.id,
      topicKey: s.keys[0],
      title: s.keys.length > 1 ? titleOf(s.keys) : null,
      rotation,
      teacherId: s.teacherId,
      position: nextPos(rotation),
      memberIds: s.scouts.map((x) => x.personId)
    });
  }
  const seen = new Set(classes.map((c) => c.sourceKey));
  for (const o of match.offeredNoTakers) {
    if (!o.key) continue;
    const sourceKey = `offer:${o.personId}:${o.key}`;
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    classes.push({ sourceKey, topicKey: o.key, title: null, rotation: null, teacherId: o.personId, position: nextPos(null), memberIds: [] });
  }
  const numbers = [...new Set([1, 2, ...classes.map((c) => c.rotation).filter((r): r is number => r != null)])].sort((a, b) => a - b);
  return { rotations: numbers.map((number) => ({ number, location: null })), classes };
}

// ── a saved placement as the match ───────────────────────────────────────────────────────────────────────────────

export interface SavedClass {
  id: number;
  topicKey: string;
  title: string | null;
  rotation: number | null;
  teacherId: number | null;
  position: number;
  version: number;
  memberIds: number[];
}

export interface SavedPlacement {
  startedAt: string;
  rotations: LiveRotation[];
  classes: SavedClass[];
}

const byPlace = (a: { rotation: number | null; position: number; id: number }, b: { rotation: number | null; position: number; id: number }) =>
  (a.rotation ?? 1e9) - (b.rotation ?? 1e9) || a.position - b.position || a.id - b.id;

/** A board row as the adapter needs it: who said what. */
export type PlacementBoardRow = { personId: number; intent: Intent | null; picks: readonly Pick<BoardPick, 'later'>[] };

export function placementAsMatch(p: SavedPlacement, board: readonly PlacementBoardRow[] = []): MatchResult {
  const classes = [...p.classes].sort(byPlace);
  const sessions: MatchSession[] = classes.map((c, i) => ({
    id: savedId(c.id),
    unitId: savedId(c.id),
    keys: [c.topicKey],
    block: i,
    half: c.rotation != null && c.rotation >= 2 ? 1 : 0,
    rotation: c.rotation,
    title: c.title,
    group: null,
    teacherId: c.teacherId,
    coTeacherIds: [],
    via: 'topic',
    flags: [],
    scouts: [...c.memberIds].sort((a, b) => a - b).map((personId) => ({ personId, key: c.topicKey, pickNo: null, via: 'pick' as const }))
  }));
  const seats = new Map<number, MatchResult['assignments'][number]['seats']>();
  for (const s of sessions) for (const x of s.scouts) seats.set(x.personId, [...(seats.get(x.personId) ?? []), { ...x, sessionId: s.id, block: s.block }]);
  const teaching = new Set(classes.map((c) => c.teacherId).filter((id): id is number => id != null));
  const rows = [...board].sort((a, b) => a.personId - b.personId);
  const intentOf = (r: PlacementBoardRow) => effectiveIntent(r.intent, r.picks);
  return {
    blockCount: sessions.length,
    sessions,
    assignments: [...seats].sort(([a], [b]) => a - b).map(([personId, list]) => ({ personId, seats: list })),
    wanted: [],
    offeredNoTakers: [],
    undecidedScouts: rows.filter((r) => intentOf(r) === 'undecided').map((r) => ({ personId: r.personId, placed: seats.has(r.personId) })),
    undecidedAdults: [],
    comingNothing: rows
      .filter((r) => intentOf(r) === 'coming' && !seats.has(r.personId) && !teaching.has(r.personId))
      .map((r) => ({ personId: r.personId, suggestion: null }))
  };
}

// ── the view model ───────────────────────────────────────────────────────────────────────────────────────────────

export function buildLiveView(input: {
  started: boolean;
  rotations: readonly LiveRotation[];
  classes: readonly LiveClassIn[];
  nameOf: (personId: number) => string;
  retake: (personId: number, topicKey: string) => boolean;
  /** Coming (or here) scouts; anyone placed in a class or teaching one is left out. */
  pool: readonly number[];
  /** Marked here (P4c). */
  present?: (personId: number) => boolean;
  /** A visitor (P4c). */
  visitor?: (personId: number) => boolean;
}): LiveView {
  const here = input.present ?? (() => false);
  const visiting = input.visitor ?? (() => false);
  const classes = [...input.classes].sort((a, b) => (a.rotation ?? 1e9) - (b.rotation ?? 1e9) || a.position - b.position || a.id.localeCompare(b.id));
  const { lines, count } = liveConflicts(classes, input.nameOf);
  const busy = new Set(classes.flatMap((c) => [...c.memberIds, ...(c.teacherId != null ? [c.teacherId] : [])]));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    started: input.started,
    rotations: [...input.rotations].sort((a, b) => a.number - b.number),
    cards: classes.map((c) => ({
      id: c.id,
      topicKey: c.topicKey,
      rotation: c.rotation,
      title: c.title,
      codeLabel: c.codeLabel,
      kind: c.kind,
      teacher: c.teacherId != null ? { personId: c.teacherId, name: input.nameOf(c.teacherId), present: here(c.teacherId) } : null,
      members: c.memberIds
        .map((personId) => ({ personId, name: input.nameOf(personId), retake: input.retake(personId, c.topicKey), present: here(personId), visitor: visiting(personId) }))
        .sort(byName),
      repeats: classes.filter((o) => o !== c && o.topicKey === c.topicKey).map((o) => o.rotation),
      conflicts: lines.get(c.id) ?? [],
      version: c.version
    })),
    pool: [...new Set(input.pool)]
      .filter((id) => !busy.has(id))
      .map((personId) => ({ personId, name: input.nameOf(personId), present: here(personId), visitor: visiting(personId) }))
      .sort(byName),
    overlaps: count
  };
}

// ── B8: attendance is approved after the meeting (D-429) ─────────────────────────────────────────────────────────

/**
 * Is the meeting over? After its last day (Central), or on that day once its end time has passed. Without an end time
 * the meeting runs to the end of its day: the calendar's meetings usually carry a start time only.
 * `now` is Central wall-clock ('YYYY-MM-DD', 'HH:MM'); `endTime` may be 'HH:MM' or 'HH:MM:SS'.
 */
export function meetingIsOver(m: { date: string; endDate?: string | null; endTime?: string | null }, now: { date: string; time: string }): boolean {
  const last = m.endDate && m.endDate > m.date ? m.endDate : m.date;
  if (now.date !== last) return now.date > last;
  return m.endTime ? now.time >= m.endTime.slice(0, 5) : false;
}

export type AttendanceGroupKey = 'class' | 'teaching' | 'visitor' | 'here' | 'recorded';

export const ATTENDANCE_GROUP_LABEL: Record<AttendanceGroupKey, string> = {
  class: 'In a class',
  teaching: 'Teaching',
  visitor: 'Visitors',
  here: 'Marked here',
  recorded: 'Already on Roll Call'
};

export interface AttendanceReviewPerson {
  personId: number;
  name: string;
  /** Already in event_attendance. */
  recorded: boolean;
  /** The checklist's starting tick: recorded, or the draft says here (placed, teaching and visitors count as here
   *  unless someone marked them not present). A recorded person always starts ticked: removing them takes an untick. */
  ticked: boolean;
}

export interface AttendanceReview {
  entryId: number;
  /** 'YYYY-MM-DD'. */
  date: string;
  groups: { key: AttendanceGroupKey; label: string; people: AttendanceReviewPerson[] }[];
}

/**
 * The approval checklist from the draft. Each person once, in the first group that fits: Visitors, Teaching, In a
 * class, Marked here (a "here" tap on someone in no class), Already on Roll Call (recorded, and nothing else). Someone
 * marked not present who is in no class and not recorded is left off. Names sort within a group; empty groups drop.
 */
export function buildAttendanceReview(input: {
  entryId: number;
  date: string;
  placed: readonly number[];
  teachers: readonly number[];
  visitors: readonly number[];
  /** Draft taps: person → here (true) or not (false). */
  draft: ReadonlyMap<number, boolean>;
  recorded: ReadonlySet<number>;
  nameOf: (personId: number) => string;
}): AttendanceReview {
  const groupOf = new Map<number, AttendanceGroupKey>();
  const put = (ids: Iterable<number>, key: AttendanceGroupKey) => {
    for (const id of ids) if (!groupOf.has(id)) groupOf.set(id, key);
  };
  put(input.visitors, 'visitor');
  put(input.teachers, 'teaching');
  put(input.placed, 'class');
  put([...input.draft].filter(([, here]) => here).map(([id]) => id), 'here');
  put(input.recorded, 'recorded');
  const order: AttendanceGroupKey[] = ['class', 'teaching', 'visitor', 'here', 'recorded'];
  return {
    entryId: input.entryId,
    date: input.date,
    groups: order
      .map((key) => ({
        key,
        label: ATTENDANCE_GROUP_LABEL[key],
        people: [...groupOf]
          .filter(([, k]) => k === key)
          .map(([personId]) => {
            const recorded = input.recorded.has(personId);
            return { personId, name: input.nameOf(personId), recorded, ticked: recorded || (input.draft.get(personId) ?? true) };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      }))
      .filter((g) => g.people.length > 0)
  };
}

/** What "Record attendance" will do: who to add (ticked, not recorded) and who to remove (recorded, unticked). */
export function attendanceChanges(review: AttendanceReview, ticked: ReadonlySet<number>): { add: number[]; remove: number[] } {
  const people = review.groups.flatMap((g) => g.people);
  return {
    add: people.filter((p) => !p.recorded && ticked.has(p.personId)).map((p) => p.personId),
    remove: people.filter((p) => p.recorded && !ticked.has(p.personId)).map((p) => p.personId)
  };
}
