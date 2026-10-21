'use server';

/**
 * Meeting Live server actions (Plans/Meeting-Planner-II.md, Decision 8; the tech-lead's P4 spec).
 *
 * P4a: Start Meeting Live. An editor (meeting_planner.edit; the SPL holds it as a scout) saves the matcher's current
 * output as the meeting's placement; from then on the saved placement is the truth for that meeting. Viewers are
 * refused here, on the server, whatever the page showed them. Starting twice changes nothing.
 * P4b adds the edits (rotation, teacher, scout moves, repeats) and P4c attendance and visitors, through this file.
 */
import { revalidatePath } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadBoardStamp, loadMeetingById } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { SAVE_FAILED } from '@/lib/meeting-board-supply';
import { startMeetingLive } from '@/lib/meeting-live';

export type LiveWriteResult = { ok: true; stamp: string } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** An editor acting on an upcoming (or today's), published troop meeting that takes sign-ups. */
async function liveEditor(entryId: unknown) {
  if (!Number.isInteger(entryId)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canEdit || actor?.personId == null) return fail('Only someone who can edit the Meeting Planner can do that.');
  const sb = createAdminClient();
  const meeting = await loadMeetingById(sb, entryId as number);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  const { data: entry } = await sb.from('calendar_entries').select('status').eq('id', meeting.entryId).maybeSingle();
  if ((entry as { status: string } | null)?.status !== 'published' || meeting.mode === 'closed') return fail('That meeting isn’t taking sign-ups.');
  if (meeting.date < centralToday()) return fail('That meeting has passed. Reload the page for the next one.');
  return { ok: true as const, sb, meeting, actorPersonId: actor.personId };
}

function revalidate() {
  revalidatePath('/planner');
  revalidatePath('/planner/live');
  revalidatePath('/member/meeting');
  revalidatePath('/admin/advancement/meeting-plan');
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
