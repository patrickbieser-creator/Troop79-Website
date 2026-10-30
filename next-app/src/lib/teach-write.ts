import 'server-only';

/**
 * One teacher write on the family page (Plans/Meeting-Planner-III-Family.md, F3–F5): the core behind /member/meeting's
 * teach actions (signed in, teach-actions.ts) and the email link's planPageTeachAction (/i/plan/<token>).
 *
 * NOT a server action: it takes `actorPersonId` and `leader` from its caller, who decided them from a verified session
 * or a claimed link. A 'use server' file must never export a function that accepts them.
 *
 * Who may teach at all is loadTeacherPeople: an adult, or a scout canOfferToTeach admits on the meeting date. 'add' ops
 * need that; 'edit' ops (Remove, Withdraw, Clear, the note) work for someone who no longer qualifies, so nothing gets
 * stuck. The RPCs re-check self-or-leader, refuse a scout an adults-only skill, and refuse closed and past boards. The
 * Sunday limit (TEACH_MAX_CLASSES classes, TEACH_MAX_MIN minutes; D1) is checked here before any add on this meeting; a
 * Junior Leader can't take an adults-only class (D8). Each write returns the person's fresh card (lib/teacher-week).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { NOT_A_TEACHER } from '@/lib/can-offer-to-teach';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { INTENTS, type Intent } from '@/lib/meeting-board-shared';
import { freeformTitle } from '@/lib/meeting-board-teach';
import { DEFAULT_TEACH_MINUTES } from '@/lib/meeting-board-picklist';
import { loadBoardState, loadUpcomingMeetings, clearMeetingIntent, setMeetingIntent, type BoardMeeting, type BoardWriteResult } from '@/lib/meeting-board';
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

export type OfferWhat = { type: 'skill'; skillId: string } | { type: 'req'; key: string } | { type: 'ff'; title: string };

/** What a teacher card asks for. */
export type TeachOp =
  | { op: 'teach'; key: string }
  | { op: 'unteach'; key: string }
  | { op: 'withdraw'; skillId: string }
  | { op: 'intent'; intent: Intent | null }
  | { op: 'offer'; what: OfferWhat; entryIds: number[]; note?: string }
  | { op: 'clear'; takeOff: boolean }
  | { op: 'note'; note: string };

export interface TeachContext {
  sb: SupabaseClient;
  meeting: BoardMeeting;
  catalog: AdvancementCatalog;
  /** The teacher. */
  personId: number;
  /** Who is writing: the teacher, or a leader on their behalf. */
  actorPersonId: number;
  leader: boolean;
  /** How a refusal names the teacher: 'You', or their first name (a leader entering for them). */
  who: 'You' | 'first name';
}

export const teachFail = (error: string, field?: 'what' | 'dates'): { ok: false; error: string; field?: 'what' | 'dates' } => ({ ok: false, error, ...(field ? { field } : {}) });

const ADDS = new Set<TeachOp['op']>(['teach', 'intent', 'offer']);

export async function teachWrite(ctx: TeachContext, op: TeachOp): Promise<TeachActionResult> {
  if (!op || typeof op !== 'object') return teachFail('Malformed request');
  const { sb, meeting, catalog, personId } = ctx;
  const me = (await loadTeacherPeople(sb, [personId], meeting.date, catalog)).get(personId);
  if (!me && ADDS.has(op.op)) return teachFail(NOT_A_TEACHER);
  const upcoming = await loadUpcomingMeetings(sb, OFFER_DATES, meeting.date);
  const writer: TeachWriter = { personId, actorPersonId: ctx.actorPersonId, leader: ctx.leader };
  const refresh = async (res: BoardWriteResult): Promise<TeachActionResult> => {
    if (!res.ok) return res;
    revalidatePath('/member');
    revalidatePath('/member/meeting');
    const board = await loadBoardState(sb, meeting, catalog);
    const [view, week] = await Promise.all([loadTeachView(sb, meeting, catalog, personId, { board, upcoming }), loadTeacherWeek(sb, meeting, catalog, personId)]);
    // Someone who no longer qualifies and just took back their last row has nothing left to show.
    return { ok: true, view: view ?? emptyTeachView(personId), week };
  };
  /** Why adding `key` (or `min` minutes) to this meeting doesn't fit this person's Sunday; null when it does. */
  const refusal = async (key: string | null, min?: number): Promise<string | null> => {
    const week = await loadTeacherWeek(sb, meeting, catalog, personId);
    if (!week || (key && (week.mine.some((m) => m.key === key) || week.other.some((o) => o.key === key)))) return null;
    if (key && week.junior && [...week.needs, ...week.taught].some((c) => c.key === key && c.adultsOnly)) return 'Adults only: a registered counselor teaches the merit badge.';
    return teachRefusal(ctx.who === 'You' ? 'You' : week.firstName, week.load, min ?? (key ? minutesOf(week, key, catalog) : 0));
  };

  switch (op.op) {
    // "I'll teach this" on this meeting.
    case 'teach': {
      if (typeof op.key !== 'string' || !op.key) return teachFail('Malformed request');
      const no = await refusal(op.key);
      if (no) return teachFail(no);
      return refresh(await teachTopic(sb, writer, [meeting.entryId], { key: op.key }, null));
    }
    case 'unteach':
      if (typeof op.key !== 'string') return teachFail('Malformed request');
      return refresh(await unteachTopic(sb, writer, meeting.entryId, op.key));
    case 'withdraw':
      if (typeof op.skillId !== 'string') return teachFail('Malformed request');
      return refresh(await withdrawSkillOffer(sb, writer, meeting.entryId, op.skillId));
    // Coming / Not sure yet / Can't make it; null = "Clear this answer", back to no answer.
    case 'intent':
      if (op.intent === null) return refresh(await clearMeetingIntent(sb, { entryId: meeting.entryId, personId }));
      if (!INTENTS.includes(op.intent)) return teachFail('Malformed request');
      return refresh(await setMeetingIntent(sb, { entryId: meeting.entryId, personId, actorPersonId: writer.actorPersonId, leader: writer.leader }, op.intent));
    // "Offer something": a skill, a requirement, or something else, on one or more upcoming dates, with a note. Each
    // date becomes its own row.
    case 'offer': {
      if (!me) return teachFail(NOT_A_TEACHER);
      const choices = offerChoices(me, catalog, upcoming);
      const what = op.what;
      if (!what || typeof what !== 'object') return teachFail('Malformed request');
      if (what.type === 'skill' && !choices.skills.some((s) => s.id === what.skillId)) {
        return teachFail(what.skillId ? 'Add it to What I can teach first.' : 'Choose a skill.', 'what');
      }
      if (what.type === 'req' && !choices.requirements.some((g) => g.options.some((o) => o.key === what.key))) return teachFail('Choose a requirement.', 'what');
      if (what.type === 'ff' && !freeformTitle(typeof what.title === 'string' ? what.title : '')) return teachFail('Say what you’ll teach.', 'what');
      if (!['skill', 'req', 'ff'].includes(what.type)) return teachFail('Malformed request');
      const allowed = new Set(choices.dates.map((d) => d.entryId));
      const entryIds = Array.isArray(op.entryIds) ? [...new Set(op.entryIds)].filter((id) => Number.isInteger(id)) : [];
      if (!entryIds.length) return teachFail('Pick at least one date.', 'dates');
      if (entryIds.some((id) => !allowed.has(id))) return teachFail('One of those dates has no teaching sign-up. Reload the page and try again.', 'dates');
      // An offer for this Sunday counts toward its limit like any class.
      if (entryIds.includes(meeting.entryId)) {
        // A skill already offered this Sunday is held, not added (the refusal skips a key the person holds).
        const no = await refusal(what.type === 'req' ? what.key : what.type === 'skill' ? what.skillId : null, what.type === 'req' ? undefined : DEFAULT_TEACH_MINUTES);
        if (no) return teachFail(no, 'dates');
      }
      const note = typeof op.note === 'string' ? op.note.trim().slice(0, 200) || null : null;
      const res =
        what.type === 'skill'
          ? await offerSkill(sb, writer, entryIds, what.skillId, note)
          : await teachTopic(sb, writer, entryIds, what.type === 'req' ? { key: what.key } : { title: freeformTitle(what.title) }, note);
      if (!res.ok) return teachFail(res.error);
      return refresh(res);
    }
    // "Not sure yet? Clear …'s answer" (F4): back to Not sure yet, and everything signed up on this page goes back
    // (classes taken on, help-teach classes, offers on this meeting). `takeOff` also releases what a planner assigned,
    // so that class opens for another adult.
    case 'clear': {
      if (typeof op.takeOff !== 'boolean') return teachFail('Malformed request');
      // Every row the person holds on this meeting (qa-lead 2026-10-30): not the derived card, which skips a group no
      // longer on the plan.
      const rows = await loadSupplyRows(sb, [meeting.entryId]);
      for (const row of rows.topicTeachers.filter((x) => x.personId === personId)) {
        const preassigned = row.enteredByPersonId != null && row.enteredByPersonId !== personId;
        if (preassigned && !op.takeOff) continue;
        const res = await unteachTopic(sb, writer, meeting.entryId, row.key);
        if (!res.ok) return teachFail(res.error);
      }
      for (const o of rows.skillOffers.filter((x) => x.personId === personId)) {
        const res = await withdrawSkillOffer(sb, writer, meeting.entryId, o.skillId);
        if (!res.ok) return teachFail(res.error);
      }
      return refresh(await setMeetingIntent(sb, { entryId: meeting.entryId, personId, actorPersonId: writer.actorPersonId, leader: writer.leader }, 'undecided'));
    }
    // The optional note with "Can't make it this week" (F3b): at most 3 lines and 240 characters (the database checks
    // the same). Only on that answer: any other answer drops it (a trigger on meeting_intents). Blank clears it.
    case 'note': {
      if (typeof op.note !== 'string' || op.note.length > 2000) return teachFail('Malformed request');
      const { data, error } = await sb
        .from('meeting_intents')
        .update({ note: cleanDeclineNote(op.note) })
        .eq('calendar_entry_id', meeting.entryId)
        .eq('person_id', personId)
        .eq('intent', 'not_coming')
        .select('person_id');
      if (error) return teachFail('That didn’t save. Try again.');
      if (!data?.length) return teachFail('Choose Can’t make it this week first.');
      return refresh({ ok: true });
    }
    default:
      return teachFail('Malformed request');
  }
}
