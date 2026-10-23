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
 *   - buildLiveView: the cards, repeats, retake stars, conflicts and the "Not in a class yet" pool the Live screen
 *     draws, from either the preview or the saved placement.
 *   - liveDrift (Rotations L0): where the plan and a started arrangement disagree, each case with its fix.
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
  /** Not in a class yet: coming (or here), nothing assigned. `picks`: what they picked, short ('Star 6 · Cyber Chip'). */
  pool: { personId: number; name: string; present: boolean; visitor: boolean; picks: string[] }[];
  /** How many overlapping pairs need fixing (the header's red count). */
  overlaps: number;
  /** Rotations L0: where the plan and the arrangement have drifted apart (started only; empty before). */
  drift: LiveDrift[];
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

// ── Rotations L0: where the plan and Live have drifted apart (Plans/Build-A-Plan.md, "Rotations") ─────────────────

/**
 * One drift case on a started arrangement, each with its one-click fix on the Live screen:
 *   - offering: a topic someone teaches on the plan with no class → Make a class;
 *   - pick: a scout in no class who picked a topic with no class → Create class and place (the same mechanism);
 *   - cant / dropped: a placed scout who said Can't make it, or whose picks no longer include the class's topic →
 *     Remove from class / Keep;
 *   - teacher: the class's teacher isn't one of the plan's teachers for its topic → Use <plan> / Use <class>;
 *   - orphan: a class whose topic nothing holds on the plan any more (not seeded, no picks, no teacher) → Keep as
 *     extra / Remove class.
 * `id` is stable across reloads: a session's Keep hides it by id.
 */
export type LiveDrift =
  | { id: string; kind: 'offering'; key: string; label: string; teacherId: number | null }
  | { id: string; kind: 'pick'; key: string; label: string; personId: number; name: string }
  | { id: string; kind: 'cant' | 'dropped'; classId: string; title: string; personId: number; name: string }
  | { id: string; kind: 'teacher'; classId: string; version: number; title: string; plan: { personId: number; name: string }; current: { personId: number; name: string } | null }
  | { id: string; kind: 'orphan'; classId: string; version: number; title: string };

export interface DriftClass {
  id: string;
  topicKey: string;
  title: string;
  teacherId: number | null;
  memberIds: readonly number[];
  version: number;
  /** A matcher class that merged sibling picks (a title snapshot): its members picked a sibling, not its lead key. */
  merged: boolean;
}

/** What a drift sentence says (the strip and the in-place note read one definition). */
export function driftText(d: LiveDrift): string {
  switch (d.kind) {
    case 'offering':
      return `${d.label} has no class`;
    case 'pick':
      return `${d.name} picked ${d.label} · no class`;
    case 'cant':
      return `${d.name} said Can’t make it · in ${d.title}`;
    case 'dropped':
      return `${d.name} doesn’t pick ${d.title}`;
    case 'teacher':
      return d.current ? `${d.title}: the plan says ${d.plan.name}, the class has ${d.current.name}` : `${d.title} has no teacher · the plan says ${d.plan.name}`;
    case 'orphan':
      return `${d.title} is no longer on the plan`;
  }
}

/**
 * The drift between the plan (topic teachers, picks, answers, seeded topics) and a started arrangement. Pure: the
 * loader passes what the Live page already loaded. Freeform topics are never orphans (a "Something else…" class is an
 * extra by nature). Adults and visitors in a class are not checked for picks.
 */
export function liveDrift(input: {
  classes: readonly DriftClass[];
  board: readonly { personId: number; intent: Intent | null; picks: readonly Pick<BoardPick, 'key' | 'later'>[] }[];
  /** The plan's teachers in sign-up order (meeting_topic_teachers). */
  topicTeachers: readonly { key: string; personId: number }[];
  /** Teachers who said Can't make it: not the plan's teacher for this meeting. */
  notComing: ReadonlySet<number>;
  seeded: ReadonlySet<string>;
  freeform: ReadonlySet<string>;
  /** 'Star 6': the short code of a topic, or its title when it has none. */
  labelOf: (key: string) => string;
  nameOf: (personId: number) => string;
}): LiveDrift[] {
  const { classes, board } = input;
  const classKeys = new Set(classes.map((c) => c.topicKey));
  const placed = new Set(classes.flatMap((c) => c.memberIds));
  const teaching = new Set(classes.map((c) => c.teacherId).filter((id): id is number => id != null));
  const planTeachers = new Map<string, number[]>();
  for (const t of input.topicTeachers) {
    if (input.notComing.has(t.personId)) continue;
    const list = planTeachers.get(t.key) ?? [];
    if (!list.includes(t.personId)) planTeachers.set(t.key, [...list, t.personId]);
  }
  const anyTeacher = new Set(input.topicTeachers.map((t) => t.key));
  const picked = new Set(board.flatMap((r) => r.picks.map((p) => p.key)));
  const out: LiveDrift[] = [];

  for (const [key, ids] of planTeachers) {
    if (!classKeys.has(key)) out.push({ id: `o:${key}`, kind: 'offering', key, label: input.labelOf(key), teacherId: ids[0] ?? null });
  }
  const byName = (a: { personId: number }, b: { personId: number }) => input.nameOf(a.personId).localeCompare(input.nameOf(b.personId));
  for (const r of [...board].sort(byName)) {
    if (effectiveIntent(r.intent, r.picks) !== 'coming' || placed.has(r.personId) || teaching.has(r.personId)) continue;
    for (const p of r.picks) {
      if (p.later || classKeys.has(p.key)) continue;
      out.push({ id: `p:${r.personId}:${p.key}`, kind: 'pick', key: p.key, label: input.labelOf(p.key), personId: r.personId, name: input.nameOf(r.personId) });
    }
  }
  const rowOf = new Map(board.map((r) => [r.personId, r]));
  for (const c of classes) {
    for (const personId of [...c.memberIds].sort((a, b) => input.nameOf(a).localeCompare(input.nameOf(b)))) {
      const r = rowOf.get(personId);
      if (!r) continue;
      const now = r.picks.filter((p) => !p.later);
      const base = { classId: c.id, title: c.title, personId, name: input.nameOf(personId) };
      if (effectiveIntent(r.intent, r.picks) === 'not_coming') out.push({ id: `x:${c.id}:${personId}`, kind: 'cant', ...base });
      else if (!c.merged && now.length && !now.some((p) => p.key === c.topicKey)) out.push({ id: `d:${c.id}:${personId}`, kind: 'dropped', ...base });
    }
  }
  for (const c of classes) {
    const plan = planTeachers.get(c.topicKey) ?? [];
    if (plan.length && (c.teacherId == null || !plan.includes(c.teacherId))) {
      out.push({
        id: `t:${c.id}:${c.teacherId ?? 'none'}:${plan[0]}`,
        kind: 'teacher',
        classId: c.id,
        version: c.version,
        title: c.title,
        plan: { personId: plan[0], name: input.nameOf(plan[0]) },
        current: c.teacherId != null ? { personId: c.teacherId, name: input.nameOf(c.teacherId) } : null
      });
    }
  }
  for (const c of classes) {
    if (input.freeform.has(c.topicKey) || input.seeded.has(c.topicKey) || anyTeacher.has(c.topicKey) || picked.has(c.topicKey)) continue;
    out.push({ id: `r:${c.id}`, kind: 'orphan', classId: c.id, version: c.version, title: c.title });
  }
  return out;
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
  /** What a pool scout picked, short (L0). */
  picksOf?: (personId: number) => string[];
  drift?: LiveDrift[];
}): LiveView {
  const picksOf = input.picksOf ?? (() => []);
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
      .map((personId) => ({ personId, name: input.nameOf(personId), present: here(personId), visitor: visiting(personId), picks: picksOf(personId) }))
      .sort(byName),
    overlaps: count,
    drift: input.started ? (input.drift ?? []) : []
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
  /**
   * The meeting ran under the old P4c code (meeting_boards.attendance_seeded_at is set). There, "Mark not present"
   * deleted the attendance row and left no draft row, so a placed or teaching person with no draft row and no
   * attendance may have been marked not here: they start UNticked rather than credited by one careless tap.
   */
  seededByOldCode?: boolean;
}): AttendanceReview {
  const noTap = !input.seededByOldCode;
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
            return { personId, name: input.nameOf(personId), recorded, ticked: recorded || (input.draft.get(personId) ?? noTap) };
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
