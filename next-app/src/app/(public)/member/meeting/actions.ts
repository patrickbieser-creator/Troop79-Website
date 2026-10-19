'use server';

/**
 * /member/meeting writes (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md). Everything saves on tap.
 *
 * Who may write is decided here from the VERIFIED session, never from the request: a scout writes for themself; an
 * adult for the active scouts in their household (Verified Signup's household model); a leader holding
 * meeting_plan.use (and not signed in as a scout) for anyone, when the page was opened "on behalf" from Admin ›
 * Meeting Plan. The RPCs re-check the household rule and refuse a closed board. A meeting that has passed takes no
 * more writes. Each write records who entered it and returns the scout's fresh picks.
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { actorHas, resolveAdminActor } from '@/lib/admin-actor';
import { centralToday } from '@/lib/dates';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { pickableKeys, type ScoutBoardView } from '@/lib/meeting-board-picklist';
import { decideActFor, INTENTS, type Intent } from '@/lib/meeting-board-shared';
import {
  addMeetingPick,
  loadBoardScouts,
  loadHouseholdScoutPersonIds,
  loadMeetingById,
  loadScoutBoard,
  removeMeetingPick,
  setMeetingIntent,
  setMeetingPickNote,
  setMeetingPickOrder,
  type BoardWriteResult,
  type BoardWriter
} from '@/lib/meeting-board';
import { loadSupplyRows } from '@/lib/meeting-board-supply';

export type MeetingActionResult = { ok: true; view: ScoutBoardView } | { ok: false; error: string };

interface Target {
  entryId: number;
  /** The scout. */
  personId: number;
  /** Opened from Admin › Meeting Plan to enter for someone. */
  onBehalf?: boolean;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function resolve(t: Target) {
  if (!Number.isInteger(t?.entryId) || !Number.isInteger(t?.personId)) return fail('Malformed request');
  const sb = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(sb, session))) return fail('Your sign-in has expired. Sign in again to save.');

  let actorPersonId = session.personId;
  let leader = false;
  if (t.onBehalf) {
    const actor = await resolveAdminActor();
    if (!actor || actor.subjectKind === 'scout' || !actorHas(actor, 'meeting_plan.use')) {
      return fail('Only a leader can enter picks for someone else.');
    }
    actorPersonId = actor.personId ?? session.personId;
    leader = true;
  } else {
    const actorIsScout = session.subjectKind === 'scout';
    const household = actorIsScout ? [] : await loadHouseholdScoutPersonIds(sb, session.personId);
    if (!decideActFor({ actorPersonId, actorIsScout, targetPersonId: t.personId, householdScoutPersonIds: household, leader: false })) {
      return fail('You can only pick for yourself or the scouts in your household.');
    }
  }

  const meeting = await loadMeetingById(sb, t.entryId);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  if (meeting.date < centralToday()) return fail('That meeting has passed. Reload the page for the next one.');
  const scout = (await loadBoardScouts(sb, [t.personId]))[0];
  if (!scout) return fail('Picks are for scouts.');
  const catalog = await loadAdvancementCatalog();
  // Freeform topics a teacher offered on this board are pickable too (Phase 2).
  const freeform = (await loadSupplyRows(sb, [meeting.entryId])).freeform.map((f) => ({ key: f.key, title: f.title }));
  const board = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId: actorPersonId, freeform });
  const writer: BoardWriter = {
    entryId: meeting.entryId,
    personId: scout.personId,
    actorPersonId,
    leader,
    carry: board.hasOwnList ? null : board.picks
  };
  const refresh = async (res: BoardWriteResult): Promise<MeetingActionResult> => {
    if (!res.ok) return res;
    revalidatePath('/member');
    revalidatePath('/member/meeting');
    revalidatePath('/admin/advancement/meeting-plan');
    const fresh = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId: actorPersonId, freeform });
    return { ok: true, view: fresh.view };
  };
  return { ok: true as const, sb, board, writer, refresh };
}

export async function meetingAddPickAction(t: Target & { key: string; later?: boolean; markComing?: boolean }): Promise<MeetingActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (typeof t.key !== 'string' || !pickableKeys(r.board.pickList).has(t.key)) return fail('That isn’t something you can pick for this meeting.');
  return r.refresh(await addMeetingPick(r.sb, r.writer, t.key, { later: t.later === true, markComing: t.markComing === true }));
}

export async function meetingRemovePickAction(t: Target & { key: string }): Promise<MeetingActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (typeof t.key !== 'string') return fail('Malformed request');
  return r.refresh(await removeMeetingPick(r.sb, r.writer, t.key));
}

/** keys: every pick, in order; null clears the order. */
export async function meetingSetOrderAction(t: Target & { keys: string[] | null }): Promise<MeetingActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (t.keys !== null && (!Array.isArray(t.keys) || !t.keys.every((k) => typeof k === 'string'))) return fail('Malformed request');
  return r.refresh(await setMeetingPickOrder(r.sb, r.writer, t.keys));
}

export async function meetingSetNoteAction(t: Target & { key: string; note: string }): Promise<MeetingActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (typeof t.key !== 'string' || typeof t.note !== 'string') return fail('Malformed request');
  return r.refresh(await setMeetingPickNote(r.sb, r.writer, t.key, t.note.slice(0, 200)));
}

export async function meetingSetIntentAction(t: Target & { intent: Intent }): Promise<MeetingActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (!INTENTS.includes(t.intent)) return fail('Malformed request');
  return r.refresh(await setMeetingIntent(r.sb, { entryId: r.writer.entryId, personId: r.writer.personId, actorPersonId: r.writer.actorPersonId, leader: r.writer.leader }, t.intent));
}
