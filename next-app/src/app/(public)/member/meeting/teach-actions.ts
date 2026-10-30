'use server';

/**
 * /member/meeting teach-section writes (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md). Everything saves on
 * tap, except "Offer something", which is a small form posted once.
 *
 * Who may write is decided here from the VERIFIED session, never from the request: a teaching commitment is personal,
 * so an adult or Junior Leader writes only for themself; a leader holding meeting_plan.use (and not signed in as a
 * scout) writes for anyone when the page was opened "on behalf" from Admin › Meeting Plan. The write itself, with who
 * may teach, the Sunday limit and the adults-only rule, is lib/teach-write (shared with the email link's
 * planPageTeachAction). Each write returns the person's fresh card (lib/teacher-week).
 */
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { actorHas, resolveAdminActor } from '@/lib/admin-actor';
import { centralToday } from '@/lib/dates';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import type { Intent } from '@/lib/meeting-board-shared';
import { loadMeetingById } from '@/lib/meeting-board';
import { teachFail as fail, teachWrite, type OfferWhat, type TeachActionResult, type TeachOp } from '@/lib/teach-write';

export type { OfferWhat, TeachActionResult } from '@/lib/teach-write';

interface TeachTarget {
  entryId: number;
  /** The teacher. */
  personId: number;
  /** Opened from Admin › Meeting Plan to enter for someone. */
  onBehalf?: boolean;
}

/** The session (self, or a leader on behalf), then the shared write. */
async function write(t: TeachTarget, op: TeachOp): Promise<TeachActionResult> {
  if (!Number.isInteger(t?.entryId) || !Number.isInteger(t?.personId)) return fail('Malformed request');
  const sb = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(sb, session))) return fail('Your sign-in has expired. Sign in again to save.');

  let actorPersonId = session.personId;
  let leader = false;
  if (t.onBehalf) {
    const actor = await resolveAdminActor();
    if (!actor || actor.subjectKind === 'scout' || !actorHas(actor, 'meeting_plan.use')) return fail('Only a leader can sign someone else up to teach.');
    actorPersonId = actor.personId ?? session.personId;
    leader = true;
  } else if (t.personId !== session.personId) {
    return fail('You can only sign up to teach for yourself.');
  }

  const meeting = await loadMeetingById(sb, t.entryId);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  if (meeting.date < centralToday()) return fail('That meeting has passed. Reload the page for the next one.');
  const catalog = await loadAdvancementCatalog();
  return teachWrite({ sb, meeting, catalog, personId: t.personId, actorPersonId, leader, who: t.onBehalf ? 'first name' : 'You' }, op);
}

/** "I'll teach this" on this meeting. */
export async function meetingTeachAction(t: TeachTarget & { key: string }): Promise<TeachActionResult> {
  return write(t, { op: 'teach', key: t?.key });
}

export async function meetingUnteachAction(t: TeachTarget & { key: string }): Promise<TeachActionResult> {
  return write(t, { op: 'unteach', key: t?.key });
}

export async function meetingWithdrawOfferAction(t: TeachTarget & { skillId: string }): Promise<TeachActionResult> {
  return write(t, { op: 'withdraw', skillId: t?.skillId });
}

/** Coming / Not sure yet / Can't make it; null = "Clear this answer", back to no answer. */
export async function meetingTeacherIntentAction(t: TeachTarget & { intent: Intent | null }): Promise<TeachActionResult> {
  return write(t, { op: 'intent', intent: t?.intent });
}

/** "Offer something": a skill, a requirement, or something else, on one or more upcoming dates, with a note. */
export async function meetingPostOfferAction(t: TeachTarget & { what: OfferWhat; entryIds: number[]; note?: string }): Promise<TeachActionResult> {
  return write(t, { op: 'offer', what: t?.what, entryIds: t?.entryIds, note: t?.note });
}

/** "Not sure yet? Clear …'s answer" (F4). */
export async function meetingTeacherClearAction(t: TeachTarget & { takeOff: boolean }): Promise<TeachActionResult> {
  return write(t, { op: 'clear', takeOff: t?.takeOff });
}

/** The optional note with "Can't make it this week" (F3b). */
export async function meetingTeacherNoteAction(t: TeachTarget & { note: string }): Promise<TeachActionResult> {
  return write(t, { op: 'note', note: t?.note });
}
