'use server';

/**
 * Meeting Live server actions (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8d, 10a; the tech-lead's P4 spec).
 *
 * P4a: Start Meeting Live: the matcher's current output becomes the meeting's saved placement.
 * P4b: the edits. Every one checks meeting_planner.edit here, on the server (the SPL holds it as a scout); viewers are
 * refused whatever the page showed them. Meeting Live runs any open meeting: a merit badge night is just a meeting
 * (P5a, Decision 10). The first edit on a meeting that hasn't
 * started starts it (copy on first write) and finds a preview card ('s:…') by the matcher session it came from.
 * Card writes carry the card's version; a scout move is compare-and-set. Someone else's change first comes back as
 * { ok: false, stale: true } and the screen refreshes. Drag-and-drop and "Move to" call the same actions.
 * P4c: attendance (event_attendance through Roll Call's cascade, ledger credit included) and visitors, only on the
 * meeting day (Central). The same edit right takes attendance (Open Questions: edit alone is enough, SPL included).
 */
import { revalidatePath } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadBoardStamp, loadMeetingById, type BoardMeeting } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { SAVE_FAILED } from '@/lib/meeting-board-supply';
import { loadEntryContext, recordAttendance, removeAttendance } from '@/lib/attendance-admin';
import { canTeachOnLive, liveStartedAt, onLiveBoard, resolveLiveClass, startMeetingLive } from '@/lib/meeting-live';
import type { SupabaseClient } from '@supabase/supabase-js';

export type LiveWriteResult = { ok: true; stamp: string } | { ok: false; error: string; stale?: true };

const STALE_TEXT = 'Someone else changed this. Here’s the latest.';
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const stale = (): { ok: false; error: string; stale: true } => ({ ok: false, error: STALE_TEXT, stale: true });
/** The RPCs' own messages are written for people; anything else is not shown raw. */
const KNOWN = /^(Rotations 1 and 2|Only the last rotation|Move its classes|That’s as many rotations|That isn’t something|That meeting|Give the visitor)/;
const NOT_TODAY = 'Attendance is taken on the day of the meeting.';
const NOT_A_TEACHER = 'Teaching is for adults and Junior Leaders.';

type Editor = { ok: true; sb: SupabaseClient; meeting: BoardMeeting; actorPersonId: number; actorLabel: string };

/** An editor acting on an upcoming (or today's), published meeting that takes sign-ups. */
async function liveEditor(entryId: unknown): Promise<Editor | { ok: false; error: string }> {
  if (!Number.isInteger(entryId)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canEdit || actor?.personId == null) return fail('Only someone who can edit the Meeting Planner can do that.');
  const sb = createAdminClient();
  const meeting = await loadMeetingById(sb, entryId as number);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  const { data: entry } = await sb.from('calendar_entries').select('status').eq('id', meeting.entryId).maybeSingle();
  if ((entry as { status: string } | null)?.status !== 'published' || meeting.closed) return fail('That meeting isn’t taking sign-ups.');
  if (meeting.date < centralToday()) return fail('That meeting has passed. Reload the page for the next one.');
  return { ok: true, sb, meeting, actorPersonId: actor.personId, actorLabel: actor.label };
}

function revalidate() {
  revalidatePath('/planner');
  revalidatePath('/planner/live');
  revalidatePath('/member/meeting');
  revalidatePath('/admin/advancement/meeting-plan');
}

/** Run one Live write: start Live first when it hasn't (copy on first write), map STALE, return the new stamp. */
async function write(e: Editor, run: () => PromiseLike<{ error: { message: string } | null }>): Promise<LiveWriteResult> {
  try {
    if (!(await liveStartedAt(e.sb, e.meeting.entryId))) {
      const s = await startMeetingLive(e.sb, e.meeting, e.actorPersonId);
      if (!s.ok) return s;
    }
    const { error } = await run();
    if (error) {
      if (error.message === 'STALE') return stale();
      return fail(KNOWN.test(error.message) ? error.message : SAVE_FAILED);
    }
    revalidate();
    return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
  } catch {
    return fail(SAVE_FAILED);
  }
}

const isCardId = (v: unknown): v is string => typeof v === 'string' && /^(c:\d+|s:.{1,200})$/.test(v);
const isVersion = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isRotation = (v: unknown): v is number | null => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 99);
const isPerson = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** A card from the screen, as a saved class id (starting Live when the card is a preview). Null = stale. */
async function cardOf(e: Editor, id: string): Promise<number | null> {
  return resolveLiveClass(e.sb, e.meeting, e.actorPersonId, id);
}

/** Start Meeting Live: the board's current match becomes the saved placement. */
export async function plannerLiveStartAction(input: { entryId: number }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  try {
    const res = await startMeetingLive(e.sb, e.meeting, e.actorPersonId);
    if (!res.ok) return res;
    revalidate();
    return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
  } catch {
    return fail(SAVE_FAILED);
  }
}

/** Move a scout between classes; from null = Coming, nothing assigned; to null = back there. */
export async function plannerLiveMoveScoutAction(input: { entryId: number; personId: number; from: string | null; to: string | null }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (!isPerson(input.personId) || (input.from !== null && !isCardId(input.from)) || (input.to !== null && !isCardId(input.to)) || (input.from === null && input.to === null))
    return fail('Malformed request');
  try {
    const from = input.from === null ? null : await cardOf(e, input.from);
    const to = input.to === null ? null : await cardOf(e, input.to);
    if ((input.from !== null && from === null) || (input.to !== null && to === null)) return stale();
    return write(e, () => e.sb.rpc('meeting_live_move_scout', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_person: input.personId, p_from: from, p_to: to }));
  } catch {
    return fail(SAVE_FAILED);
  }
}

/** A card op: resolve the card, then run the RPC with its id and expected version. */
async function cardOp(
  input: { entryId: number; classId: string; version: number },
  valid: boolean,
  rpc: (e: Editor, classId: number) => PromiseLike<{ error: { message: string } | null }>,
  teacherId: number | null = null
): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (!isCardId(input.classId) || !isVersion(input.version) || !valid) return fail('Malformed request');
  try {
    if (teacherId !== null && !(await canTeachOnLive(e.sb, e.meeting, teacherId))) return fail(NOT_A_TEACHER);
    const id = await cardOf(e, input.classId);
    if (id === null) return stale();
    return write(e, () => rpc(e, id));
  } catch {
    return fail(SAVE_FAILED);
  }
}

/** Set a card's teacher, or clear it (teacherId null). The teacher must be someone Live's picker offers. */
export async function plannerLiveSetTeacherAction(input: { entryId: number; classId: string; version: number; teacherId: number | null }): Promise<LiveWriteResult> {
  return cardOp(input, input?.teacherId === null || isPerson(input?.teacherId), (e, id) =>
    e.sb.rpc('meeting_live_set_teacher', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_class: id, p_expected: input.version, p_teacher: input.teacherId }),
    input?.teacherId ?? null
  );
}

/** Move a card to a rotation, or to Not scheduled (rotation null). */
export async function plannerLiveMoveClassAction(input: { entryId: number; classId: string; version: number; rotation: number | null }): Promise<LiveWriteResult> {
  return cardOp(input, isRotation(input?.rotation), (e, id) =>
    e.sb.rpc('meeting_live_move_class', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_class: id, p_expected: input.version, p_rotation: input.rotation })
  );
}

/** Repeat a card into a rotation: the same class again, with its own teacher and scouts (8a). */
export async function plannerLiveRepeatClassAction(input: { entryId: number; classId: string; version: number; rotation: number | null }): Promise<LiveWriteResult> {
  return cardOp(input, isRotation(input?.rotation), (e, id) =>
    e.sb.rpc('meeting_live_repeat_class', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_class: id, p_expected: input.version, p_rotation: input.rotation })
  );
}

/** Remove a card; its scouts go back to Coming, nothing assigned. */
export async function plannerLiveRemoveClassAction(input: { entryId: number; classId: string; version: number }): Promise<LiveWriteResult> {
  return cardOp(input, true, (e, id) => e.sb.rpc('meeting_live_remove_class', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_class: id, p_expected: input.version }));
}

/** "+ Add rotation": adds one after the highest the screen showed (another leader's add first = nothing more). */
export async function plannerLiveAddRotationAction(input: { entryId: number; expectMax: number }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (!Number.isInteger(input.expectMax) || input.expectMax < 0 || input.expectMax > 99) return fail('Malformed request');
  return write(e, () => e.sb.rpc('meeting_live_add_rotation', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_expect_max: input.expectMax }));
}

/** Remove the last rotation, when it's empty (never Rotation 1 or 2). */
export async function plannerLiveDropRotationAction(input: { entryId: number; number: number }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (!isRotation(input.number) || input.number === null) return fail('Malformed request');
  return write(e, () => e.sb.rpc('meeting_live_drop_rotation', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_number: input.number }));
}

/** A rotation's location ("Back room"); blank clears it. */
export async function plannerLiveSetLocationAction(input: { entryId: number; number: number; location: string }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (!isRotation(input.number) || input.number === null || typeof input.location !== 'string' || input.location.length > 200) return fail('Malformed request');
  return write(e, () => e.sb.rpc('meeting_live_set_location', { p_entry: e.meeting.entryId, p_actor: e.actorPersonId, p_number: input.number, p_location: input.location }));
}

/** "+ Add an offer" on Live: a requirement already on the board (key) or a free-text title, an optional teacher. */
export async function plannerLiveAddClassAction(input: { entryId: number; key: string | null; title: string | null; teacherId: number | null; rotation: number | null }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  const key = typeof input.key === 'string' && input.key.trim() ? input.key.trim().slice(0, 120) : null;
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 80) : null;
  if ((!key && !title) || !isRotation(input.rotation) || (input.teacherId !== null && !isPerson(input.teacherId))) return fail('Malformed request');
  try {
    if (input.teacherId !== null && !(await canTeachOnLive(e.sb, e.meeting, input.teacherId))) return fail(NOT_A_TEACHER);
  } catch {
    return fail(SAVE_FAILED);
  }
  return write(e, () =>
    e.sb.rpc('meeting_live_add_class', {
      p_entry: e.meeting.entryId,
      p_actor: e.actorPersonId,
      p_topic_key: key,
      p_title: key ? null : title,
      p_teacher: input.teacherId,
      p_rotation: input.rotation
    })
  );
}

/** Mark someone here or not here (attendance). The meeting day only. */
export async function plannerLiveSetPresentAction(input: { entryId: number; personId: number; present: boolean }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (!isPerson(input.personId) || typeof input.present !== 'boolean') return fail('Malformed request');
  if (e.meeting.date !== centralToday()) return fail(NOT_TODAY);
  try {
    if (!(await onLiveBoard(e.sb, e.meeting.entryId, input.personId))) return fail('That person isn’t on this meeting’s board.');
    const ctx = await loadEntryContext(e.sb, e.meeting.entryId);
    if (!ctx) return fail('That meeting is no longer on the calendar.');
    const res = input.present
      ? await recordAttendance(e.sb, ctx, input.personId, null, 'manual', e.actorLabel)
      : await removeAttendance(e.sb, ctx, input.personId, e.actorLabel);
    if (!res.ok) return fail(SAVE_FAILED);
    // The attendance is saved either way; a failed bump only delays other screens until the next stamp change.
    const touch = await e.sb.rpc('meeting_live_touch', { p_entry: e.meeting.entryId });
    if (touch.error) console.error(`Meeting Live touch failed for entry ${e.meeting.entryId}: ${touch.error.message}`);
    revalidate();
    return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
  } catch {
    return fail(SAVE_FAILED);
  }
}

/** "+ Add as visitor": a guest person, marked here, in a class (to) or in the pool (to null). The meeting day only. */
export async function plannerLiveAddVisitorAction(input: { entryId: number; name: string; to: string | null }): Promise<LiveWriteResult> {
  const e = await liveEditor(input?.entryId);
  if (!e.ok) return e;
  if (typeof input.name !== 'string' || input.name.length > 200 || (input.to !== null && !isCardId(input.to))) return fail('Malformed request');
  if (e.meeting.date !== centralToday()) return fail(NOT_TODAY);
  try {
    const to = input.to === null ? null : await cardOf(e, input.to);
    if (input.to !== null && to === null) return stale();
    const ctx = await loadEntryContext(e.sb, e.meeting.entryId);
    if (!ctx) return fail('That meeting is no longer on the calendar.');
    const { error } = await e.sb.rpc('meeting_live_add_visitor', {
      p_entry: e.meeting.entryId,
      p_actor: e.actorPersonId,
      p_by: e.actorLabel,
      p_name: input.name,
      p_to: to,
      p_qty: ctx.defaultQty
    });
    if (error) return error.message === 'STALE' ? stale() : fail(KNOWN.test(error.message) ? error.message : SAVE_FAILED);
    revalidate();
    return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
  } catch {
    return fail(SAVE_FAILED);
  }
}
