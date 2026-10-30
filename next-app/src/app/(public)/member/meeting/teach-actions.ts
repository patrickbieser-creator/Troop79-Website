'use server';

/**
 * /member/meeting teach-section writes (Phase 2 of Plans/Meeting-Requests-And-Teaching-Offers.md). Everything saves on
 * tap, except "Offer something", which is a small form posted once.
 *
 * Who may write is decided here from the VERIFIED session, never from the request: a teaching commitment is personal,
 * so an adult or Junior Leader writes only for themself; a leader holding meeting_plan.use (and not signed in as a
 * scout) writes for anyone when the page was opened "on behalf" from Admin › Meeting Plan. Who may teach at all is
 * loadTeacherPeople: an adult, or a scout canOfferToTeach admits on the meeting date. The RPCs re-check self-or-leader,
 * refuse a scout an adults-only skill, and refuse closed and past boards. The Sunday limit (TEACH_MAX_CLASSES classes,
 * TEACH_MAX_MIN minutes; Plans/Meeting-Planner-III-Family.md, D1) is checked here before any add on this meeting; a
 * Junior Leader can't take an adults-only class (D8). Each write returns the person's fresh card (lib/teacher-week).
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
import { DEFAULT_TEACH_MINUTES } from '@/lib/meeting-board-picklist';
import { loadBoardState, loadMeetingById, loadUpcomingMeetings, clearMeetingIntent, setMeetingIntent, type BoardWriteResult } from '@/lib/meeting-board';
import {
  emptyTeachView,
  loadSupplyRows,
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
import { teachRefusal } from '@/lib/family-week-shared';
import { cleanDeclineNote } from '@/lib/decline-note';
import { loadTeacherWeek, minutesOf, type TeacherWeek } from '@/lib/teacher-week';

export type TeachActionResult = { ok: true; view: TeachView; week: TeacherWeek | null } | { ok: false; error: string; field?: 'what' | 'dates' };

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
    const [view, week] = await Promise.all([loadTeachView(sb, meeting, catalog, t.personId, { board, upcoming }), loadTeacherWeek(sb, meeting, catalog, t.personId)]);
    // Someone who no longer qualifies and just took back their last row has nothing left to show.
    return { ok: true, view: view ?? emptyTeachView(t.personId), week };
  };
  /** Why adding `key` (or `min` minutes) to this meeting doesn't fit this person's Sunday; null when it does. */
  const refusal = async (key: string | null, min?: number): Promise<string | null> => {
    const week = await loadTeacherWeek(sb, meeting, catalog, t.personId);
    if (!week || (key && (week.mine.some((m) => m.key === key) || week.other.some((o) => o.key === key)))) return null;
    if (key && week.junior && [...week.needs, ...week.taught].some((c) => c.key === key && c.adultsOnly)) return 'Adults only: a registered counselor teaches the merit badge.';
    return teachRefusal(t.onBehalf ? week.firstName : 'You', week.load, min ?? (key ? minutesOf(week, key, catalog) : 0));
  };
  return { ok: true as const, sb, meeting, catalog, me, upcoming, writer, refresh, refusal };
}

/** "I'll teach this" on this meeting. */
export async function meetingTeachAction(t: TeachTarget & { key: string }): Promise<TeachActionResult> {
  const r = await resolve(t);
  if (!r.ok) return r;
  if (typeof t.key !== 'string' || !t.key) return fail('Malformed request');
  const no = await r.refusal(t.key);
  if (no) return fail(no);
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
  // An offer for this Sunday counts toward its limit like any class.
  if (entryIds.includes(r.meeting.entryId)) {
    // A skill already offered this Sunday is held, not added (the refusal skips a key the person holds).
    const no = await r.refusal(what.type === 'req' ? what.key : what.type === 'skill' ? what.skillId : null, what.type === 'req' ? undefined : DEFAULT_TEACH_MINUTES);
    if (no) return fail(no, 'dates');
  }
  const note = typeof t.note === 'string' ? t.note.trim().slice(0, 200) || null : null;
  const res =
    what.type === 'skill'
      ? await offerSkill(r.sb, r.writer, entryIds, what.skillId, note)
      : await teachTopic(r.sb, r.writer, entryIds, what.type === 'req' ? { key: what.key } : { title: freeformTitle(what.title) }, note);
  if (!res.ok) return fail(res.error);
  return r.refresh(res);
}

/**
 * "Not sure yet? Clear …'s answer" (F4): back to Not sure yet, and everything signed up on this page goes back
 * (classes taken on, help-teach classes, offers on this meeting). `takeOff` also releases what a planner assigned, so
 * that class opens for another adult.
 */
export async function meetingTeacherClearAction(t: TeachTarget & { takeOff: boolean }): Promise<TeachActionResult> {
  const r = await resolve(t, 'edit');
  if (!r.ok) return r;
  if (typeof t.takeOff !== 'boolean') return fail('Malformed request');
  // Every row the person holds on this meeting (qa-lead 2026-10-30): not the derived card, which skips a group no
  // longer on the plan.
  const rows = await loadSupplyRows(r.sb, [r.meeting.entryId]);
  for (const row of rows.topicTeachers.filter((x) => x.personId === t.personId)) {
    const preassigned = row.enteredByPersonId != null && row.enteredByPersonId !== t.personId;
    if (preassigned && !t.takeOff) continue;
    const res = await unteachTopic(r.sb, r.writer, r.meeting.entryId, row.key);
    if (!res.ok) return fail(res.error);
  }
  for (const o of rows.skillOffers.filter((x) => x.personId === t.personId)) {
    const res = await withdrawSkillOffer(r.sb, r.writer, r.meeting.entryId, o.skillId);
    if (!res.ok) return fail(res.error);
  }
  return r.refresh(await setMeetingIntent(r.sb, { entryId: r.meeting.entryId, personId: t.personId, actorPersonId: r.writer.actorPersonId, leader: r.writer.leader }, 'undecided'));
}

/**
 * The optional note with "Can't make it this week" (F3b): what the person would like the planners to know, at most
 * 3 lines and 240 characters (the database checks the same). Only on that answer: any other answer drops it (a trigger
 * on meeting_intents). Blank clears it.
 */
export async function meetingTeacherNoteAction(t: TeachTarget & { note: string }): Promise<TeachActionResult> {
  const r = await resolve(t, 'edit');
  if (!r.ok) return r;
  if (typeof t.note !== 'string' || t.note.length > 2000) return fail('Malformed request');
  const { data, error } = await r.sb
    .from('meeting_intents')
    .update({ note: cleanDeclineNote(t.note) })
    .eq('calendar_entry_id', r.meeting.entryId)
    .eq('person_id', t.personId)
    .eq('intent', 'not_coming')
    .select('person_id');
  if (error) return fail('That didn’t save. Try again.');
  if (!data?.length) return fail('Choose Can’t make it this week first.');
  return r.refresh({ ok: true });
}
