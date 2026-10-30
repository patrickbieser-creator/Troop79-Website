'use server';

/**
 * /member/meeting teach-section writes (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md). Everything saves on
 * tap, except "Offer something", which is a small form posted once.
 *
 * Who may write is decided here from the VERIFIED session, never from the request: a teaching commitment is personal,
 * so an adult or Junior Leader writes only for themself; a leader holding meeting_plan.use (and not signed in as a
 * scout) writes for anyone when the page was opened "on behalf" from Admin › Meeting Plan. Who may teach at all is
 * loadTeacherPeople: an adult, or a scout canOfferToTeach admits on the meeting date. The RPCs re-check self-or-leader,
 * hold the 2-commitment cap under the lock, refuse a scout an adults-only skill, and refuse closed and past boards.
 * Each write returns the person's fresh teach section.
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { actorHas, resolveAdminActor } from '@/lib/admin-actor';
import { centralToday } from '@/lib/dates';
import { NOT_A_TEACHER } from '@/lib/can-offer-to-teach';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { INTENTS, type Intent } from '@/lib/meeting-board-shared';
import { freeformTitle } from '@/lib/meeting-board-teach';
import { loadBoardState, loadMeetingById, loadUpcomingMeetings, clearMeetingIntent, setMeetingIntent, type BoardWriteResult } from '@/lib/meeting-board';
import {
  emptyTeachView,
  loadTeachView,
  loadTeacherPeople,
  offerChoices,
  offerSkill,
  OFFER_DATES,
  teachTopic,
  unteachTopic,
  withdrawSkillOffer,
  type TeachView,
  type TeachWriter
} from '@/lib/meeting-board-supply';

export type TeachActionResult = { ok: true; view: TeachView } | { ok: false; error: string; field?: 'what' | 'dates' };

interface TeachTarget {
  entryId: number;
  /** The teacher. */
  personId: number;
  /** Opened from Admin › Meeting Plan to enter for someone. */
  onBehalf?: boolean;
}

const fail = (error: string, field?: 'what' | 'dates'): { ok: false; error: string; field?: 'what' | 'dates' } => ({ ok: false, error, ...(field ? { field } : {}) });

/** `op` 'edit' (Remove, Withdraw) works for someone who no longer qualifies to teach, so nothing gets stuck. */
async function resolve(t: TeachTarget, op: 'add' | 'edit' = 'add') {
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
  const me = (await loadTeacherPeople(sb, [t.personId], meeting.date, catalog)).get(t.personId);
  if (!me && op === 'add') return fail(NOT_A_TEACHER);
  const upcoming = await loadUpcomingMeetings(sb, OFFER_DATES, meeting.date);
  const writer: TeachWriter = { personId: t.personId, actorPersonId, leader };
  const refresh = async (res: BoardWriteResult): Promise<TeachActionResult> => {
    if (!res.ok) return res;
    revalidatePath('/member');
    revalidatePath('/member/meeting');
    const board = await loadBoardState(sb, meeting, catalog);
    const view = await loadTeachView(sb, meeting, catalog, t.personId, { board, upcoming });
    // Someone who no longer qualifies and just took back their last row has nothing left to show.
    return { ok: true, view: view ?? emptyTeachView(t.personId) };
  };
  return { ok: true as const, sb, meeting, catalog, me, upcoming, writer, refresh };
}

/** "I'll teach this" on this meeting. */
export async function meetingTeachAction(t: TeachTarget & { key: string }): Promise<TeachActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (typeof t.key !== 'string' || !t.key) return fail('Malformed request');
  return r.refresh(await teachTopic(r.sb, r.writer, [r.meeting.entryId], { key: t.key }, null));
}

export async function meetingUnteachAction(t: TeachTarget & { key: string }): Promise<TeachActionResult> {
  const r = await resolve(t, 'edit');
  if (!r.ok) return r;
  if (typeof t.key !== 'string') return fail('Malformed request');
  return r.refresh(await unteachTopic(r.sb, r.writer, r.meeting.entryId, t.key));
}

export async function meetingWithdrawOfferAction(t: TeachTarget & { skillId: string }): Promise<TeachActionResult> {
  const r = await resolve(t, 'edit');
  if (!r.ok) return r;
  if (typeof t.skillId !== 'string') return fail('Malformed request');
  return r.refresh(await withdrawSkillOffer(r.sb, r.writer, r.meeting.entryId, t.skillId));
}

/** An adult's Coming / Not sure yet ("put me where I'm needed") / Can't make it. A Junior Leader answers as a scout. */
/** Coming / Not sure yet / Can't make it; null = "Clear this answer", back to no answer. */
export async function meetingTeacherIntentAction(t: TeachTarget & { intent: Intent | null }): Promise<TeachActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (t.intent === null) return r.refresh(await clearMeetingIntent(r.sb, { entryId: r.meeting.entryId, personId: t.personId }));
  if (!INTENTS.includes(t.intent)) return fail('Malformed request');
  return r.refresh(await setMeetingIntent(r.sb, { entryId: r.meeting.entryId, personId: t.personId, actorPersonId: r.writer.actorPersonId, leader: r.writer.leader }, t.intent));
}

export type OfferWhat = { type: 'skill'; skillId: string } | { type: 'req'; key: string } | { type: 'ff'; title: string };

/**
 * "Offer something": a skill, a requirement, or something else, on one or more upcoming dates, with a note. Each date
 * becomes its own row.
 */
export async function meetingPostOfferAction(t: TeachTarget & { what: OfferWhat; entryIds: number[]; note?: string }): Promise<TeachActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (!r.me) return fail(NOT_A_TEACHER);
  const choices = offerChoices(r.me, r.catalog, r.upcoming);
  const what = t.what;
  if (!what || typeof what !== 'object') return fail('Malformed request');
  if (what.type === 'skill' && !choices.skills.some((s) => s.id === what.skillId)) {
    return fail(what.skillId ? 'Add it to What I can teach first.' : 'Choose a skill.', 'what');
  }
  if (what.type === 'req' && !choices.requirements.some((g) => g.options.some((o) => o.key === what.key))) return fail('Choose a requirement.', 'what');
  if (what.type === 'ff' && !freeformTitle(typeof what.title === 'string' ? what.title : '')) return fail('Say what you’ll teach.', 'what');
  if (!['skill', 'req', 'ff'].includes(what.type)) return fail('Malformed request');
  const allowed = new Set(choices.dates.map((d) => d.entryId));
  const entryIds = Array.isArray(t.entryIds) ? [...new Set(t.entryIds)].filter((id) => Number.isInteger(id)) : [];
  if (!entryIds.length) return fail('Pick at least one date.', 'dates');
  if (entryIds.some((id) => !allowed.has(id))) return fail('One of those dates has no teaching sign-up. Reload the page and try again.', 'dates');
  const note = typeof t.note === 'string' ? t.note.trim().slice(0, 200) || null : null;
  const res =
    what.type === 'skill'
      ? await offerSkill(r.sb, r.writer, entryIds, what.skillId, note)
      : await teachTopic(r.sb, r.writer, entryIds, what.type === 'req' ? { key: what.key } : { title: freeformTitle(what.title) }, note);
  if (!res.ok) return fail(res.error);
  return r.refresh(res);
}
