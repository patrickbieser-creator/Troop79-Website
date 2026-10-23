/**
 * Meeting Live's server side (Plans/Meeting-Planner-II.md, Decision 8; the tech-lead's P4 spec section 6). Server-only:
 * every function takes the service-role client, so the caller gates.
 *
 *   - loadSavedPlacement: the saved placement, or null while Meeting Live hasn't started.
 *   - loadMatchOrPlacement: THE seam every reader of the match goes through (the member page, the agenda tray, v1's
 *     the Sunday board until P5). Before Live starts it is the matcher (loadLiveMatch); once live_started_at is set, the
 *     saved placement as a MatchResult (placementAsMatch). The planner board keeps its own loaders: it stays on screen.
 *   - startMeetingLive: copy on FIRST WRITE (Decision 8): run the matcher and save its output with meeting_live_start,
 *     which is idempotent under the meeting's Live lock.
 *   - loadLiveView: what /planner/live draws: the matcher's preview before start, the saved placement after.
 *   - B8 (D-429): presence on Live is a DRAFT (meeting_live_presence); nothing here writes attendance on its own. After
 *     the meeting, loadAttendancePrompt / loadAttendanceReview give the approval checklist, and the server action
 *     records only the differences through Roll Call's cascade. discardMeetingLive undoes Live.
 *   - Rotations L0: loadLiveView carries the drift (liveDrift) from what it already loads; loadMakeClass and
 *     loadClassForTeacherFix are the reads behind the strip's two composed fixes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardState, loadIntents, loadPeopleNames, loadScoutProgress, type BoardMeeting, type BoardScoutRow } from '@/lib/meeting-board';
import { boardName, effectiveIntent } from '@/lib/meeting-board-shared';
import { isPickFinished, rankTrees } from '@/lib/meeting-board-picklist';
import { sessionWords, type MatchResult } from '@/lib/meeting-board-match';
import { loadLiveMatch, loadTeachBoard, loadTeacherPeople, sanitizeRpcError, type TeachBoard } from '@/lib/meeting-board-supply';
import { teacherName } from '@/lib/meeting-board-teach';
import { shortRequirement } from '@/lib/rank-abbrev';
import {
  buildAttendanceReview,
  buildLiveView,
  liveDrift,
  meetingIsOver,
  placementAsMatch,
  previewId,
  savedId,
  snapshotFromMatch,
  type AttendanceReview,
  type LiveClassIn,
  type LiveSnapshot,
  type LiveView,
  type SavedPlacement
} from '@/lib/meeting-live-shared';

/** The system household that hosts Meeting Live visitors (P4c, households.system_key). */
export const VISITORS_KEY = 'meeting-visitors';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** When Meeting Live started on this meeting, or null. */
export async function liveStartedAt(sb: SupabaseClient, entryId: number): Promise<string | null> {
  const { data, error } = await sb.from('meeting_boards').select('live_started_at').eq('calendar_entry_id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { live_started_at: string | null } | null)?.live_started_at ?? null;
}

export async function loadSavedPlacement(sb: SupabaseClient, entryId: number): Promise<SavedPlacement | null> {
  const startedAt = await liveStartedAt(sb, entryId);
  if (!startedAt) return null;
  const [rot, cls] = await Promise.all([
    sb.from('meeting_rotations').select('number, location').eq('calendar_entry_id', entryId).order('number'),
    sb
      .from('meeting_classes')
      .select('id, rotation, teacher_person_id, title, position, version, meeting_topics(topic_key), meeting_class_members(person_id)')
      .eq('calendar_entry_id', entryId)
      .order('id')
  ]);
  const err = rot.error ?? cls.error;
  if (err) throw new Error(err.message);
  type Row = {
    id: number;
    rotation: number | null;
    teacher_person_id: number | null;
    title: string | null;
    position: number;
    version: number;
    meeting_topics: { topic_key: string } | { topic_key: string }[] | null;
    meeting_class_members: { person_id: number }[] | null;
  };
  return {
    startedAt,
    rotations: ((rot.data ?? []) as { number: number; location: string | null }[]).map((r) => ({ number: r.number, location: r.location })),
    classes: ((cls.data ?? []) as unknown as Row[])
      .filter((r) => one(r.meeting_topics)?.topic_key)
      .map((r) => ({
        id: r.id,
        topicKey: one(r.meeting_topics)!.topic_key,
        title: r.title,
        rotation: r.rotation,
        teacherId: r.teacher_person_id,
        position: r.position,
        version: r.version,
        memberIds: (r.meeting_class_members ?? []).map((m) => m.person_id).sort((a, b) => a - b)
      }))
  };
}

/** The match for a meeting, or once Meeting Live has started, its saved placement in the match's shape. */
export async function loadMatchOrPlacement(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  board: readonly BoardScoutRow[],
  teach: Pick<TeachBoard, 'supply' | 'intents'>
): Promise<MatchResult> {
  const saved = await loadSavedPlacement(sb, meeting.entryId);
  return saved ? placementAsMatch(saved, board) : loadLiveMatch(sb, meeting, board, teach);
}

type Catalog = AdvancementCatalog;

function wordsFor(catalog: Catalog, teach: Pick<TeachBoard, 'freeformTitles' | 'members'>) {
  const skillNames = new Map(catalog.skills.map((s) => [s.id, s.name]));
  return (keys: readonly string[]) => sessionWords(keys, catalog, skillNames, teach.freeformTitles, { mbReqs: catalog.meritBadgeRequirements, members: teach.members });
}

/** The matcher's output for a meeting, as the snapshot the first Live write saves. */
async function matchSnapshot(sb: SupabaseClient, meeting: BoardMeeting, catalog: Catalog, rows: readonly BoardScoutRow[], teach: TeachBoard) {
  const match = await loadLiveMatch(sb, meeting, rows, teach);
  const words = wordsFor(catalog, teach);
  return { match, snapshot: snapshotFromMatch(match, (keys) => words(keys).title) };
}

const snapshotJson = (s: LiveSnapshot) => ({
  rotations: s.rotations.map((r) => ({ number: r.number, location: r.location })),
  classes: s.classes.map((c) => ({
    source_key: c.sourceKey,
    topic_key: c.topicKey,
    title: c.title,
    rotation: c.rotation,
    teacher_person_id: c.teacherId,
    position: c.position,
    members: c.memberIds
  }))
});

/**
 * Start Meeting Live: save the matcher's current output as the meeting's placement. Already started = nothing changes
 * (started: false). The caller has checked the editor's right and the meeting.
 */
export async function startMeetingLive(sb: SupabaseClient, meeting: BoardMeeting, actorPersonId: number): Promise<{ ok: true; started: boolean } | { ok: false; error: string }> {
  if (await liveStartedAt(sb, meeting.entryId)) return { ok: true, started: false };
  const catalog = await loadAdvancementCatalog();
  const rows = await loadBoardState(sb, meeting, catalog);
  const teach = await loadTeachBoard(sb, meeting, catalog, rows);
  const { snapshot } = await matchSnapshot(sb, meeting, catalog, rows, teach);
  const { data, error } = await sb.rpc('meeting_live_start', { p_entry: meeting.entryId, p_actor: actorPersonId, p_snapshot: snapshotJson(snapshot) });
  if (error) return { ok: false, error: sanitizeRpcError(error.message) };
  return { ok: true, started: data === true };
}

/** What the Live screen draws for one meeting. */
export async function loadLiveView(sb: SupabaseClient, meeting: BoardMeeting): Promise<LiveView> {
  const catalog = await loadAdvancementCatalog();
  const rows = await loadBoardState(sb, meeting, catalog);
  const [teach, saved] = await Promise.all([loadTeachBoard(sb, meeting, catalog, rows), loadSavedPlacement(sb, meeting.entryId)]);
  const words = wordsFor(catalog, teach);

  let classes: LiveClassIn[];
  let rotations: LiveView['rotations'];
  let pool: number[];
  /** Saved classes that merged sibling picks (a title snapshot): L0's "doesn't pick" leaves them alone. */
  const merged = new Set<string>();
  // Who is here (B8): the draft tap when there is one, else what Roll Call has recorded. Visitors are guests of the
  // visitors household with a draft row or recorded attendance at this meeting.
  const { here: hereOf, visitors: visitorIds } = await loadPresence(sb, meeting.entryId);
  const attended = new Set([...hereOf].filter(([, v]) => v).map(([id]) => id));
  const scoutIds = new Set(rows.map((r) => r.personId));
  // Here, nothing assigned: attended scouts and visitors (an adult who is here is not waiting for a class).
  const hereWaiting = [...attended].filter((id) => scoutIds.has(id) || visitorIds.has(id));
  if (saved) {
    classes = saved.classes.map((c) => {
      const w = words([c.topicKey]);
      if (c.title != null) merged.add(savedId(c.id));
      return { id: savedId(c.id), topicKey: c.topicKey, rotation: c.rotation, title: c.title ?? w.title, codeLabel: w.codeLabel, kind: w.kind, teacherId: c.teacherId, memberIds: c.memberIds, position: c.position, version: c.version };
    });
    rotations = saved.rotations;
    // Coming, nothing assigned: scouts who said Coming (or picked), or are here, and aren't in a class.
    pool = [...rows.filter((r) => effectiveIntent(r.intent, r.picks) === 'coming').map((r) => r.personId), ...hereWaiting];
  } else {
    const { match, snapshot } = await matchSnapshot(sb, meeting, catalog, rows, teach);
    const keysOf = new Map(match.sessions.map((s) => [s.id, s.keys]));
    classes = snapshot.classes.map((c) => {
      const w = words(keysOf.get(c.sourceKey) ?? [c.topicKey]);
      return { id: previewId(c.sourceKey), topicKey: c.topicKey, rotation: c.rotation, title: c.title ?? w.title, codeLabel: w.codeLabel, kind: w.kind, teacherId: c.teacherId, memberIds: c.memberIds, position: c.position, version: 1 };
    });
    rotations = snapshot.rotations;
    pool = [...match.comingNothing.map((x) => x.personId), ...hereWaiting];
  }

  // Names: scouts as the board says them, teachers as the planner does, anyone else by their record.
  const rowOf = new Map(rows.map((r) => [r.personId, r]));
  const names = new Map<number, string>(rows.map((r) => [r.personId, boardName(r.name)]));
  for (const [id, p] of teach.people) if (!names.has(id)) names.set(id, teacherName(p, 'admin'));
  const missing = [...new Set([...classes.flatMap((c) => [...c.memberIds, ...(c.teacherId != null ? [c.teacherId] : [])]), ...pool])].filter((id) => !names.has(id));
  for (const [id, n] of await loadPeopleNames(sb, missing)) names.set(id, boardName(n));

  // Retake (8c): a placed scout who has already completed the class's topic gets a star.
  const placed = [...new Set(classes.flatMap((c) => c.memberIds))].map((id) => rowOf.get(id)).filter((r): r is BoardScoutRow => !!r);
  const progress = await loadScoutProgress(sb, placed.map((r) => r.scoutId));
  const trees = rankTrees(catalog.rankRequirements);
  const retake = (personId: number, key: string) => {
    const r = rowOf.get(personId);
    if (!r) return false;
    const p = progress.get(r.scoutId);
    return isPickFinished(key, {
      currentRank: r.currentRank,
      ranks: catalog.ranks,
      trees,
      rankCodes: p?.rankCodes ?? new Set<string>(),
      awardedMbs: new Set((p?.mbProgress ?? []).filter((m) => m.awarded).map((m) => m.mb_id))
    });
  };

  // Rotations L0: the drift, and each pool scout's picks the short way. From what is loaded above: no further reads.
  const codeOf = (key: string) => {
    const w = words([key]);
    return shortRequirement(w.codeLabel, '') || w.title;
  };
  const shortOf = (key: string) => {
    const w = words([key]);
    return shortRequirement(w.codeLabel, w.title);
  };
  const nameOf = (id: number) => names.get(id) ?? '';
  const drift = saved
    ? liveDrift({
        classes: classes.map((c) => ({ id: c.id, topicKey: c.topicKey, title: c.title, teacherId: c.teacherId, memberIds: c.memberIds, version: c.version, merged: merged.has(c.id) })),
        board: rows,
        topicTeachers: teach.supply.topicTeachers,
        notComing: teach.supply.notComing,
        seeded: new Set(teach.focus.map((t) => t.key)),
        freeform: new Set(teach.freeform.map((f) => f.key)),
        labelOf: codeOf,
        nameOf
      })
    : [];

  return buildLiveView({
    started: !!saved,
    rotations,
    classes,
    nameOf,
    retake,
    pool,
    present: (id) => attended.has(id),
    visitor: (id) => visitorIds.has(id),
    picksOf: (id) => (rowOf.get(id)?.picks ?? []).filter((p) => !p.later).map((p) => shortOf(p.key)),
    drift
  });
}

// ── P4b: editing ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A card id from the screen as a saved class id. 'c:<id>' is a saved card. 's:<source key>' is a preview card: the
 * first edit starts Meeting Live (idempotent), and the card is found by the matcher session it was copied from. Null
 * when it can't be found (the matcher no longer has that session, or it was removed): the caller says it's stale.
 */
export async function resolveLiveClass(sb: SupabaseClient, meeting: BoardMeeting, actorPersonId: number, id: string): Promise<number | null> {
  if (/^c:\d+$/.test(id)) return Number(id.slice(2));
  if (!id.startsWith('s:')) return null;
  const started = await startMeetingLive(sb, meeting, actorPersonId);
  if (!started.ok) throw new Error(started.error);
  const { data, error } = await sb.from('meeting_classes').select('id').eq('calendar_entry_id', meeting.entryId).eq('source_key', id.slice(2)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: number } | null)?.id ?? null;
}

/**
 * Live's teacher rule, the same one its picker offers (loadLiveChoices): an adult, or a scout who may teach (First
 * Class and up, or a Junior Leader) as of the meeting date. Checked on the server before a teacher is saved.
 */
export async function canTeachOnLive(sb: SupabaseClient, meeting: BoardMeeting, personId: number): Promise<boolean> {
  const teachers = await loadTeacherPeople(sb, [personId], meeting.date, await loadAdvancementCatalog());
  const t = teachers.get(personId);
  return t !== undefined && t.eligible !== false;
}

export interface LiveChoices {
  /** Who can be picked to teach: adults first, then Junior Leaders, by name. */
  teachers: { personId: number; name: string }[];
  /** "+ Add an offer": the topics already on this meeting's board. */
  topics: { key: string; label: string }[];
  /** "+ Add" a scout: every active scout. */
  scouts: { personId: number; name: string }[];
}

/** The pickers' lists, for editors only. */
export async function loadLiveChoices(sb: SupabaseClient, meeting: BoardMeeting): Promise<LiveChoices> {
  const catalog = await loadAdvancementCatalog();
  const [teachers, rows, topics] = await Promise.all([
    loadTeacherPeople(sb, 'all', meeting.date, catalog),
    loadBoardState(sb, meeting, catalog),
    sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting.entryId)
  ]);
  if (topics.error) throw new Error(topics.error.message);
  const teach = await loadTeachBoard(sb, meeting, catalog, rows);
  const words = wordsFor(catalog, teach);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    teachers: [...teachers.values()]
      .filter((p) => p.eligible !== false)
      .sort((a, b) => Number(a.kind !== 'adult') - Number(b.kind !== 'adult') || teacherName(a, 'admin').localeCompare(teacherName(b, 'admin')))
      .map((p) => ({ personId: p.personId, name: teacherName(p, 'admin') })),
    topics: ((topics.data ?? []) as { topic_key: string }[])
      .map((t) => {
        const w = words([t.topic_key]);
        return { key: t.topic_key, label: w.codeLabel ? `${w.codeLabel} · ${w.title}` : w.title };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    scouts: rows.map((r) => ({ personId: r.personId, name: boardName(r.name) })).sort(byName)
  };
}

// ── Rotations L0: the fixes' reads ───────────────────────────────────────────────────────────────────────────────

/**
 * What "Make a class" for `key` takes on a started arrangement: whether the topic is on the plan, whether a class for
 * it exists already (someone fixed it first), the plan's teachers in sign-up order (Can't-make-it left out), and the
 * scouts to place: coming, picked it for this meeting, in no class and teaching none (placing them from "nothing
 * assigned" is the RPC's compare-and-set).
 */
export async function loadMakeClass(sb: SupabaseClient, meeting: BoardMeeting, key: string): Promise<{ onPlan: boolean; exists: boolean; teacherIds: number[]; pickers: { personId: number; name: string }[] }> {
  const catalog = await loadAdvancementCatalog();
  const [topic, cls, teachers, rows] = await Promise.all([
    sb.from('meeting_topics').select('id').eq('calendar_entry_id', meeting.entryId).eq('topic_key', key).maybeSingle(),
    sb.from('meeting_classes').select('teacher_person_id, meeting_topics(topic_key), meeting_class_members(person_id)').eq('calendar_entry_id', meeting.entryId),
    sb
      .from('meeting_topic_teachers')
      .select('person_id, created_at, meeting_topics!inner(topic_key)')
      .eq('calendar_entry_id', meeting.entryId)
      .eq('meeting_topics.topic_key', key)
      .order('created_at'),
    loadBoardState(sb, meeting, catalog)
  ]);
  const err = topic.error ?? cls.error ?? teachers.error;
  if (err) throw new Error(err.message);
  type C = { teacher_person_id: number | null; meeting_topics: { topic_key: string } | { topic_key: string }[] | null; meeting_class_members: { person_id: number }[] | null };
  const classes = (cls.data ?? []) as unknown as C[];
  const placed = new Set(classes.flatMap((c) => (c.meeting_class_members ?? []).map((m) => m.person_id)));
  const busy = new Set(classes.map((c) => c.teacher_person_id).filter((id): id is number => id != null));
  const ids = [...new Set(((teachers.data ?? []) as { person_id: number }[]).map((t) => t.person_id))];
  const intents = await loadIntents(sb, meeting.entryId, ids);
  return {
    onPlan: topic.data != null,
    exists: classes.some((c) => one(c.meeting_topics)?.topic_key === key),
    teacherIds: ids.filter((id) => intents.get(id) !== 'not_coming'),
    pickers: rows
      .filter((r) => effectiveIntent(r.intent, r.picks) === 'coming' && r.picks.some((p) => !p.later && p.key === key) && !placed.has(r.personId) && !busy.has(r.personId))
      .map((r) => ({ personId: r.personId, name: r.name }))
  };
}

/**
 * A saved class as "Use <class teacher>" checks it: its topic, version and teacher; the plan's teachers for that topic;
 * and who teaches another repeat of it (they stay on the plan). Null when the class is gone.
 */
export async function loadClassForTeacherFix(sb: SupabaseClient, entryId: number, classId: number) {
  const { data, error } = await sb.from('meeting_classes').select('id, version, teacher_person_id, meeting_topics(topic_key)').eq('calendar_entry_id', entryId).eq('id', classId).maybeSingle();
  if (error) throw new Error(error.message);
  type R = { id: number; version: number; teacher_person_id: number | null; meeting_topics: { topic_key: string } | { topic_key: string }[] | null };
  const r = data as R | null;
  const key = one(r?.meeting_topics)?.topic_key ?? null;
  if (!r || !key) return null;
  const [siblings, plan] = await Promise.all([
    sb.from('meeting_classes').select('id, teacher_person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', entryId).eq('meeting_topics.topic_key', key).neq('id', classId),
    sb.from('meeting_topic_teachers').select('person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', entryId).eq('meeting_topics.topic_key', key)
  ]);
  const e2 = siblings.error ?? plan.error;
  if (e2) throw new Error(e2.message);
  return {
    key,
    version: r.version,
    teacherId: r.teacher_person_id,
    planTeachers: [...new Set(((plan.data ?? []) as { person_id: number }[]).map((t) => t.person_id))],
    teachingRepeat: new Set(((siblings.data ?? []) as { teacher_person_id: number | null }[]).map((c) => c.teacher_person_id).filter((id): id is number => id != null))
  };
}

// ── P4c / B8: presence ───────────────────────────────────────────────────────────────────────────────────────────

/** The visitors household's id, or null before the first visitor. */
async function visitorsHouseholdId(sb: SupabaseClient): Promise<number | null> {
  const { data, error } = await sb.from('households').select('id').eq('system_key', VISITORS_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: number } | null)?.id ?? null;
}

/**
 * One meeting's presence: `draft` (Live's taps), `recorded` (event_attendance), `here` (the draft tap when there is
 * one, else recorded) and `visitors` (guests of the visitors household with a draft row or recorded attendance here).
 */
export async function loadPresence(sb: SupabaseClient, entryId: number) {
  const [draftRes, attRes, hhId] = await Promise.all([
    sb.from('meeting_live_presence').select('person_id, present').eq('calendar_entry_id', entryId),
    sb.from('event_attendance').select('person_id').eq('calendar_entry_id', entryId),
    visitorsHouseholdId(sb)
  ]);
  if (draftRes.error) throw new Error(draftRes.error.message);
  if (attRes.error) throw new Error(attRes.error.message);
  const draft = new Map(((draftRes.data ?? []) as { person_id: number; present: boolean }[]).map((r) => [r.person_id, r.present]));
  const recorded = new Set(((attRes.data ?? []) as { person_id: number }[]).map((r) => r.person_id));
  const here = new Map<number, boolean>([...[...recorded].map((id) => [id, true] as const), ...draft]);
  const visitors = new Set<number>();
  const everyone = [...new Set([...draft.keys(), ...recorded])];
  if (hhId != null && everyone.length) {
    const { data, error } = await sb.from('people').select('id').eq('guest_host_household_id', hhId).in('id', everyone);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: number }[]) visitors.add(r.id);
  }
  return { draft, recorded, here, visitors };
}

/**
 * Who Meeting Live may mark here (qa-lead, P4c): an active scout, an adult on the roster (the planner's picker), a
 * visitor of THIS meeting (a draft row or recorded attendance), or anyone placed in or teaching one of its classes.
 */
export async function onLiveBoard(sb: SupabaseClient, entryId: number, personId: number): Promise<boolean> {
  const [scout, adult, placed, teaching, drafted, attended] = await Promise.all([
    sb.from('scouts').select('id').eq('person_id', personId).eq('active', true).limit(1),
    sb.from('person_directory').select('person_id').eq('person_id', personId).in('tab', ['leader', 'adult']).eq('in_picker', true).limit(1),
    sb.from('meeting_class_members').select('person_id, meeting_classes!inner(calendar_entry_id)').eq('person_id', personId).eq('meeting_classes.calendar_entry_id', entryId).limit(1),
    sb.from('meeting_classes').select('id').eq('calendar_entry_id', entryId).eq('teacher_person_id', personId).limit(1),
    // A visitor here: a draft row or recorded attendance at THIS meeting (checked against the household below).
    sb.from('meeting_live_presence').select('person_id').eq('calendar_entry_id', entryId).eq('person_id', personId).limit(1),
    sb.from('event_attendance').select('person_id').eq('calendar_entry_id', entryId).eq('person_id', personId).limit(1)
  ]);
  for (const r of [scout, adult, placed, teaching, drafted, attended]) if (r.error) throw new Error(r.error.message);
  if ([scout, adult, placed, teaching].some((r) => (r.data ?? []).length > 0)) return true;
  if (![drafted, attended].some((r) => (r.data ?? []).length > 0)) return false;
  const hhId = await visitorsHouseholdId(sb);
  if (hhId == null) return false;
  const { data, error } = await sb.from('people').select('id').eq('id', personId).eq('guest_host_household_id', hhId).maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

// ── B8: Discard, and attendance approved after the meeting ───────────────────────────────────────────────────────

/** "Discard Live arrangement" (meeting_live_discard, under the Live lock). `discarded`: there was one to discard. */
export async function discardMeetingLive(sb: SupabaseClient, entryId: number, actorPersonId: number): Promise<{ ok: true; discarded: boolean } | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('meeting_live_discard', { p_entry: entryId, p_actor: actorPersonId });
  if (error) return { ok: false, error: sanitizeRpcError(error.message) };
  return { ok: true, discarded: data === true };
}

/** A meeting's calendar facts as the "is it over?" rule reads them. */
export interface OverFacts {
  entryId: number;
  date: string;
  endDate: string | null;
  endTime: string | null;
}

/**
 * A PUBLISHED TROOP MEETING's calendar facts (its category's behavior is 'meeting': the filter loadAttendancePrompt
 * uses), or null. B8 qa: every after-the-meeting action goes through this, so a crafted call can't reach a campout's
 * Roll Call (and its ledger credit) through the planner's Edit right.
 */
export async function loadOverFacts(sb: SupabaseClient, entryId: number): Promise<OverFacts | null> {
  const { data, error } = await sb.from('calendar_entries').select('id, entry_date, end_date, end_time, status, calendar_categories(behavior)').eq('id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  type Cat = { behavior: string | null };
  const r = data as { id: number; entry_date: string; end_date: string | null; end_time: string | null; status: string; calendar_categories: Cat | Cat[] | null } | null;
  if (!r || r.status !== 'published') return null;
  const cat = Array.isArray(r.calendar_categories) ? r.calendar_categories[0] : r.calendar_categories;
  if (cat?.behavior !== 'meeting') return null;
  return { entryId: r.id, date: r.entry_date, endDate: r.end_date, endTime: r.end_time };
}

/** The approval checklist for one meeting: its draft (the saved placement, Live's taps, visitors) and Roll Call. */
export async function loadAttendanceReview(sb: SupabaseClient, entryId: number, date: string): Promise<AttendanceReview> {
  const [saved, presence, boardRes] = await Promise.all([
    loadSavedPlacement(sb, entryId),
    loadPresence(sb, entryId),
    sb.from('meeting_boards').select('attendance_seeded_at').eq('calendar_entry_id', entryId).maybeSingle()
  ]);
  if (boardRes.error) throw new Error(boardRes.error.message);
  const classes = saved?.classes ?? [];
  const placed = classes.flatMap((c) => c.memberIds);
  const teachers = classes.map((c) => c.teacherId).filter((id): id is number => id != null);
  const ids = [...new Set([...placed, ...teachers, ...presence.draft.keys(), ...presence.recorded])];
  const names = await loadPeopleNames(sb, ids);
  return buildAttendanceReview({
    entryId,
    date,
    placed,
    teachers,
    visitors: [...presence.visitors],
    draft: presence.draft,
    recorded: presence.recorded,
    nameOf: (id) => boardName(names.get(id) ?? ''),
    seededByOldCode: (boardRes.data as { attendance_seeded_at: string | null } | null)?.attendance_seeded_at != null
  });
}

/**
 * "Would you like to update attendance?": the most recent troop meeting that is over (as of `now`, Central wall
 * clock) and has a draft to approve (a Live arrangement or Live taps), with its checklist. Null when there is none.
 */
export async function loadAttendancePrompt(sb: SupabaseClient, now: { date: string; time: string }): Promise<AttendanceReview | null> {
  const { data: cats, error: catErr } = await sb.from('calendar_categories').select('label').eq('behavior', 'meeting');
  if (catErr) throw new Error(catErr.message);
  const labels = ((cats ?? []) as { label: string }[]).map((c) => c.label);
  if (!labels.length) return null;
  const { data, error } = await sb
    .from('calendar_entries')
    .select('id, entry_date, end_date, end_time')
    .in('category', labels)
    .eq('status', 'published')
    .lte('entry_date', now.date)
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(3);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: number; entry_date: string; end_date: string | null; end_time: string | null }[];
  const last = rows.find((r) => meetingIsOver({ date: r.entry_date, endDate: r.end_date, endTime: r.end_time }, now));
  if (!last) return null;
  const [boardRes, draftRes] = await Promise.all([
    sb.from('meeting_boards').select('live_started_at').eq('calendar_entry_id', last.id).maybeSingle(),
    sb.from('meeting_live_presence').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', last.id)
  ]);
  if (boardRes.error) throw new Error(boardRes.error.message);
  if (draftRes.error) throw new Error(draftRes.error.message);
  const started = (boardRes.data as { live_started_at: string | null } | null)?.live_started_at != null;
  if (!started && !draftRes.count) return null;
  const review = await loadAttendanceReview(sb, last.id, last.entry_date);
  return review.groups.length ? review : null;
}
