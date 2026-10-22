/**
 * Meeting Live's server side (Plans/Meeting-Planner-II.md, Decision 8; the tech-lead's P4 spec section 6). Server-only:
 * every function takes the service-role client, so the caller gates.
 *
 *   - loadSavedPlacement: the saved placement, or null while Meeting Live hasn't started.
 *   - loadMatchOrPlacement: THE seam every reader of the match goes through (the member page, the agenda tray, v1's
 *     This Sunday until P5). Before Live starts it is the matcher (loadLiveMatch); once live_started_at is set, the
 *     saved placement as a MatchResult (placementAsMatch). The planner board keeps its own loaders: it stays on screen.
 *   - startMeetingLive: copy on FIRST WRITE (Decision 8): run the matcher and save its output with meeting_live_start,
 *     which is idempotent under the meeting's Live lock.
 *   - loadLiveView: what /planner/live draws: the matcher's preview before start, the saved placement after.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { loadEntryContext, seedAttendance } from '@/lib/attendance-admin';
import { loadAdvancementCatalog, type AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardState, loadPeopleNames, loadScoutProgress, type BoardMeeting, type BoardScoutRow } from '@/lib/meeting-board';
import { boardName, effectiveIntent } from '@/lib/meeting-board-shared';
import { isPickFinished, rankTrees } from '@/lib/meeting-board-picklist';
import { sessionWords, type MatchResult } from '@/lib/meeting-board-match';
import { loadLiveMatch, loadTeachBoard, loadTeacherPeople, sanitizeRpcError, type TeachBoard } from '@/lib/meeting-board-supply';
import { teacherName } from '@/lib/meeting-board-teach';
import {
  buildLiveView,
  placementAsMatch,
  previewId,
  savedId,
  snapshotFromMatch,
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
  // Who is here (P4c): event_attendance is the one presence truth; visitors are guests of the visitors household.
  const [attRes, visitorHh] = await Promise.all([
    sb.from('event_attendance').select('person_id').eq('calendar_entry_id', meeting.entryId),
    sb.from('households').select('id').eq('system_key', VISITORS_KEY).maybeSingle()
  ]);
  if (attRes.error) throw new Error(attRes.error.message);
  const attended = new Set(((attRes.data ?? []) as { person_id: number }[]).map((a) => a.person_id));
  const visitorIds = new Set<number>();
  const hhId = (visitorHh.data as { id: number } | null)?.id;
  if (hhId != null && attended.size) {
    const { data, error } = await sb.from('people').select('id').eq('guest_host_household_id', hhId).in('id', [...attended]);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: number }[]) visitorIds.add(r.id);
  }
  const scoutIds = new Set(rows.map((r) => r.personId));
  // Here, nothing assigned: attended scouts and visitors (an adult who is here is not waiting for a class).
  const hereWaiting = [...attended].filter((id) => scoutIds.has(id) || visitorIds.has(id));
  if (saved) {
    classes = saved.classes.map((c) => {
      const w = words([c.topicKey]);
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

  return buildLiveView({
    started: !!saved,
    rotations,
    classes,
    nameOf: (id) => names.get(id) ?? '',
    retake,
    pool,
    present: (id) => attended.has(id),
    visitor: (id) => visitorIds.has(id)
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

// ── P4c: attendance ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The meeting day's one-time seed (P4 spec section 4, Roll Call's seedFromSignup pattern): once Meeting Live has
 * started and only on the meeting day (Central), placed scouts and class teachers are marked here, through Roll Call's
 * cascade (ledger credit included). Claimed under the Live lock, so two leaders opening Live at once seed once.
 * `seeded`: this call seeded. `failed`: how many people the seed couldn't mark (qa-lead, P4c): the claim is already
 * taken, so they are not retried; the problems are logged and the page tells editors to tap those people.
 */
export async function seedLiveAttendance(sb: SupabaseClient, meeting: BoardMeeting, by: string): Promise<{ seeded: boolean; failed: number }> {
  if (meeting.date !== centralToday()) return { seeded: false, failed: 0 };
  const { data: claimed, error } = await sb.rpc('meeting_live_claim_seed', { p_entry: meeting.entryId });
  if (error) throw new Error(error.message);
  if (claimed !== true) return { seeded: false, failed: 0 };
  const [ctx, saved] = await Promise.all([loadEntryContext(sb, meeting.entryId), loadSavedPlacement(sb, meeting.entryId)]);
  if (!ctx || !saved) return { seeded: true, failed: 0 };
  const ids = saved.classes.flatMap((c) => [...c.memberIds, ...(c.teacherId != null ? [c.teacherId] : [])]);
  const { problems } = await seedAttendance(sb, ctx, ids, by);
  if (problems.length) console.error(`Meeting Live seed for entry ${meeting.entryId}: ${problems.length} not marked`, problems);
  const touch = await sb.rpc('meeting_live_touch', { p_entry: meeting.entryId });
  if (touch.error) console.error(`Meeting Live touch failed for entry ${meeting.entryId}: ${touch.error.message}`);
  return { seeded: true, failed: problems.length };
}

/**
 * Who Meeting Live may mark here (qa-lead, P4c): an active scout, an adult on the roster (the planner's picker), a
 * visitor recorded at THIS meeting, or anyone placed in or teaching one of its classes.
 */
export async function onLiveBoard(sb: SupabaseClient, entryId: number, personId: number): Promise<boolean> {
  const [scout, adult, placed, teaching, visitor] = await Promise.all([
    sb.from('scouts').select('id').eq('person_id', personId).eq('active', true).limit(1),
    sb.from('person_directory').select('person_id').eq('person_id', personId).in('tab', ['leader', 'adult']).eq('in_picker', true).limit(1),
    sb.from('meeting_class_members').select('person_id, meeting_classes!inner(calendar_entry_id)').eq('person_id', personId).eq('meeting_classes.calendar_entry_id', entryId).limit(1),
    sb.from('meeting_classes').select('id').eq('calendar_entry_id', entryId).eq('teacher_person_id', personId).limit(1),
    // A visitor here: hosted by the visitors household and marked at THIS meeting.
    sb
      .from('event_attendance')
      .select('person_id, people!inner(guest_host_household_id)')
      .eq('calendar_entry_id', entryId)
      .eq('person_id', personId)
      .not('people.guest_host_household_id', 'is', null)
      .limit(1)
  ]);
  for (const r of [scout, adult, placed, teaching, visitor]) if (r.error) throw new Error(r.error.message);
  if ([scout, adult, placed, teaching].some((r) => (r.data ?? []).length > 0)) return true;
  const host = ((visitor.data ?? []) as unknown as { people: { guest_host_household_id: number } | { guest_host_household_id: number }[] }[])[0]?.people;
  const hostId = Array.isArray(host) ? host[0]?.guest_host_household_id : host?.guest_host_household_id;
  if (hostId == null) return false;
  const { data, error } = await sb.from('households').select('id').eq('id', hostId).eq('system_key', VISITORS_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}
