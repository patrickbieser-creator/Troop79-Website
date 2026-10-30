'use server';

/**
 * Meeting Planner server actions (Plans/Meeting-Planner-II.md).
 *
 * P1: the board's version stamp for the poller, for anyone who may view, and only for the meeting the planner shows.
 * P2a: an editor (meeting_planner.edit; the SPL holds it as a scout) enters answers and picks for someone, signs an
 * adult up to teach or takes them off, assigns a teacher, and adds an offer. Every write goes through v1's writers
 * with leader = true and the editor as entered_by, so the RPCs keep their own rules (active scouts only, 5 picks, who
 * may teach, Junior Leaders and adults-only skills, closed and past boards).
 * P2b: Send request goes through v1's invite sender (lib/meeting-invites-send), adults only.
 * B4 (Build a Plan, one add path): seeding moved to build-actions (plannerAddOfferingAction, plannerAddFocusSetAction,
 * plannerRemoveOfferingAction); the nudge actions retired with the Offered card (the Invite tab offers a class).
 * P5b: reminders to people who haven't answered, adults only, through the same invite pipeline.
 * Each write returns what it changed and the board's new stamp, so the poller doesn't refresh over it.
 * A drawer write revalidates nothing (perf, 2026-10-22): any revalidatePath makes Next re-render /planner inside the
 * action's response, and the planner refreshes the board itself, once, when the drawer closes (planner-client).
 */
import { revalidatePath } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import {
  addMeetingPick,
  loadBoardScouts,
  loadBoardStamp,
  loadIntents,
  loadMeetingForWrite,
  loadNextMeeting,
  loadScoutBoard,
  removeMeetingPick,
  setMeetingIntent
} from '@/lib/meeting-board';
import { assignForPicks, loadSupplyRows, loadTeacherPeople, teachTopic, unteachTopic } from '@/lib/meeting-board-supply';
import { effectiveIntent, INTENTS, type Intent } from '@/lib/meeting-board-shared';
import { BOR_LABEL, borCodeLabel, pickableKeys } from '@/lib/meeting-board-picklist';
import { borKey } from '@/lib/rank-calculus';
import { FREEFORM_MAX, freeformTitle, teacherIntent } from '@/lib/meeting-board-teach';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPersonDrawer, type PersonDrawer } from '@/lib/meeting-planner-drawer';
import { loadPlannerLists } from '@/lib/people-lists';
import { fitsGathering, topClasses } from '@/lib/requirement-class';

export type PlannerDrawerResult = { ok: true; drawer: PersonDrawer; stamp: string } | { ok: false; error: string };
/**
 * What one drawer write changed (perf, 2026-10-22): the option ticked (null for an answer), the person's count (picks
 * for this meeting, or topics they teach; null when unchanged), their stored answer and what the board shows for them.
 * The drawer lays it over what it has instead of the server reloading the whole board to redraw one drawer.
 */
export interface DrawerTick {
  key: string | null;
  on: boolean | null;
  count: number | null;
  intent: Intent | null;
  shown: Intent | null;
}
export type PlannerTickResult = { ok: true; tick: DrawerTick; stamp: string } | { ok: false; error: string };
export type PlannerWriteResult = { ok: true; stamp: string } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function plannerStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false }> {
  if (!plannerAccess(await resolveAdminActor()).canView || !Number.isInteger(entryId)) return { ok: false };
  try {
    const sb = createAdminClient();
    const lists = await loadPlannerLists();
    if ((await loadNextMeeting(sb, undefined, lists.meetingLabels))?.entryId !== entryId) return { ok: false };
    return { ok: true, stamp: await loadBoardStamp(sb, entryId) };
  } catch {
    return { ok: false };
  }
}

/**
 * An editor acting on an upcoming, published troop meeting that takes sign-ups (qa-lead, 2026-10-21: checked here,
 * not only by the RPCs, so a campout or a draft entry is refused with a plain reason).
 */
async function editor(entryId: unknown, personId: unknown) {
  if (!Number.isInteger(entryId) || !Number.isInteger(personId)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canEdit || actor?.personId == null) return fail('Only someone who can edit the Meeting Planner can do that.');
  const sb = createAdminClient();
  const meeting = await loadMeetingForWrite(sb, entryId as number);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  if (!meeting.published || meeting.closed) return fail('That meeting isn’t taking sign-ups.');
  if (meeting.date < centralToday()) return fail('That meeting has passed. Reload the page for the next one.');
  return { ok: true as const, sb, meeting, actorPersonId: actor.personId, personId: personId as number };
}

/** On the board: an active scout, or someone who may teach (an adult, or a Junior Leader). Checked BEFORE a write. */
async function onTheBoard(e: Editor): Promise<boolean> {
  if ((await loadBoardScouts(e.sb, [e.personId])).length) return true;
  const catalog = await loadAdvancementCatalog();
  const p = (await loadTeacherPeople(e.sb, [e.personId], e.meeting.date, catalog)).get(e.personId);
  return !!p && p.eligible !== false;
}
type Editor = Exclude<Awaited<ReturnType<typeof editor>>, { ok: false }>;

function revalidate() {
  revalidatePath('/planner');
  revalidatePath('/planner/focus-sets');
  revalidatePath('/member');
  revalidatePath('/member/meeting');
}

/** Open someone's drawer: the one full read. Writes from it return only what changed (DrawerTick). */
export async function plannerOpenPersonAction(input: { entryId: number; personId: number }): Promise<PlannerDrawerResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  const lists = await loadPlannerLists();
  const [drawer, stamp] = await Promise.all([loadPersonDrawer(e.sb, e.meeting, e.personId, e.actorPersonId, lists), loadBoardStamp(e.sb, e.meeting.entryId)]);
  return drawer ? { ok: true, drawer, stamp } : fail('That person isn’t on the board.');
}

/** Coming / Not sure / Can't, for a scout or an adult. A stored answer is what the board shows. */
export async function plannerSetAnswerAction(input: { entryId: number; personId: number; intent: Intent }): Promise<PlannerTickResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (!INTENTS.includes(input.intent)) return fail('Malformed request');
  if (!(await onTheBoard(e))) return fail('That person isn’t on the board.');
  const res = await setMeetingIntent(e.sb, { entryId: e.meeting.entryId, personId: e.personId, actorPersonId: e.actorPersonId, leader: true }, input.intent);
  if (!res.ok) return res;
  return { ok: true, tick: { key: null, on: null, count: null, intent: input.intent, shown: input.intent }, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
}

/** Tick or untick one of a scout's picks. The board read before the write (for the carry and the pick list) also
 *  gives what changed: their picks for this meeting with this one added or taken off. */
export async function plannerTogglePickAction(input: { entryId: number; personId: number; key: string; on: boolean }): Promise<PlannerTickResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (typeof input.key !== 'string' || typeof input.on !== 'boolean') return fail('Malformed request');
  const [scouts, supply, catalog] = await Promise.all([loadBoardScouts(e.sb, [e.personId]), loadSupplyRows(e.sb, [e.meeting.entryId]), loadAdvancementCatalog()]);
  const scout = scouts[0];
  if (!scout) return fail('Picks are for scouts.');
  const freeform = supply.freeform.map((f) => ({ key: f.key, title: f.title }));
  const board = await loadScoutBoard(e.sb, e.meeting, scout, catalog, { viewerPersonId: e.actorPersonId, freeform });
  const writer = { entryId: e.meeting.entryId, personId: e.personId, actorPersonId: e.actorPersonId, leader: true, carry: board.hasOwnList ? null : board.picks };
  if (input.on && !pickableKeys(board.pickList).has(input.key)) return fail('That isn’t on their pick list.');
  const res = input.on ? await addMeetingPick(e.sb, writer, input.key, { later: false, markComing: false }) : await removeMeetingPick(e.sb, writer, input.key);
  if (!res.ok) return res;
  const now = new Set(board.picks.filter((p) => !p.later).map((p) => p.key));
  if (input.on) now.add(input.key);
  else now.delete(input.key);
  const intent = board.view.intent;
  const shown = effectiveIntent(intent, [...now].map(() => ({ later: false })));
  return { ok: true, tick: { key: input.key, on: input.on, count: now.size, intent, shown }, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
}

/** Sign an adult (or a Junior Leader) up to teach a topic, or take them off it. No cap (Decision 7). */
export async function plannerToggleTeachAction(input: { entryId: number; personId: number; key: string; on: boolean }): Promise<PlannerTickResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (typeof input.key !== 'string' || typeof input.on !== 'boolean') return fail('Malformed request');
  const w = { personId: e.personId, actorPersonId: e.actorPersonId, leader: true };
  const res = input.on ? await teachTopic(e.sb, w, [e.meeting.entryId], { key: input.key }, null) : await unteachTopic(e.sb, w, e.meeting.entryId, input.key);
  if (!res.ok) return res;
  const [teaching, intents, stamp] = await Promise.all([
    e.sb.from('meeting_topic_teachers').select('topic_id', { count: 'exact', head: true }).eq('calendar_entry_id', e.meeting.entryId).eq('person_id', e.personId),
    loadIntents(e.sb, e.meeting.entryId, [e.personId]),
    loadBoardStamp(e.sb, e.meeting.entryId)
  ]);
  if (teaching.error) throw new Error(teaching.error.message);
  const count = teaching.count ?? 0;
  const intent = intents.get(e.personId) ?? null;
  return { ok: true, tick: { key: input.key, on: input.on, count, intent, shown: teacherIntent(intent, count) }, stamp };
}

/**
 * Assign: for the day of the meeting. The person teaches the topic (for the scouts who picked it: they come off it
 * when nobody picks it any more) and is marked Coming. Two writes, both idempotent;
 * if the second fails the commitment stands and the message says so.
 */
export async function plannerAssignAction(input: { entryId: number; personId: number; key: string }): Promise<PlannerWriteResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (typeof input.key !== 'string') return fail('Malformed request');
  const taught = await assignForPicks(e.sb, { personId: e.personId, actorPersonId: e.actorPersonId, leader: true }, e.meeting.entryId, input.key);
  if (!taught.ok) return taught;
  revalidate();
  const coming = await setMeetingIntent(e.sb, { entryId: e.meeting.entryId, personId: e.personId, actorPersonId: e.actorPersonId, leader: true }, 'coming');
  if (!coming.ok) return fail('Assigned, but couldn’t mark them Coming. Open their name to set it.');
  return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
}

/** Add an offer: a requirement or a typed title, taught by someone (P2a: a teacher is required; Decision 10b). */
export async function plannerAddOfferAction(input: { entryId: number; personId: number; what: { key: string } | { title: string } }): Promise<PlannerWriteResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  const what = input.what;
  if (!what || ('key' in what ? typeof what.key !== 'string' : typeof (what as { title?: unknown }).title !== 'string')) return fail('Malformed request');
  let title = '';
  if ('title' in what) {
    const collapsed = what.title.trim().replace(/\s+/g, ' ');
    if (!collapsed) return fail('Type what will be taught.');
    if (collapsed.length > FREEFORM_MAX) return fail(`Keep it to ${FREEFORM_MAX} characters.`);
    title = freeformTitle(collapsed);
  }
  const w = { personId: e.personId, actorPersonId: e.actorPersonId, leader: true };
  const res = await teachTopic(e.sb, w, [e.meeting.entryId], 'key' in what ? { key: what.key } : { title }, null);
  if (!res.ok) return res;
  return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
}

export interface OfferChoice {
  key: string;
  /** 'Tenderfoot 4a'. */
  codeLabel: string;
  label: string;
}

/** What an offer can be: every top-level rank requirement that can be done at a meeting, each rank's board of review
 *  (not Scout's), and every merit badge. */
export async function plannerOfferChoicesAction(): Promise<{ ok: true; choices: OfferChoice[] } | { ok: false; error: string }> {
  if (!plannerAccess(await resolveAdminActor()).canEdit) return fail('Only someone who can edit the Meeting Planner can do that.');
  const catalog = await loadAdvancementCatalog();
  const ranks = [...catalog.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const reqs = ranks.flatMap((r) =>
    catalog.rankRequirements
      .filter((q) => q.rank_id === r.id && q.parent_id == null && fitsGathering(topClasses(q), 'meeting') && q.code.toLowerCase() !== 'bor')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((q) => ({ key: `${r.id}-${q.code}`, codeLabel: `${r.display_name} ${q.code}`, label: q.label }))
      .concat(r.id === 'scout' ? [] : [{ key: borKey(r.id), codeLabel: borCodeLabel(r.display_name), label: BOR_LABEL }])
  );
  const badges = [...catalog.meritBadges].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ key: `mb:${m.id}`, codeLabel: 'Merit badge', label: m.name }));
  return { ok: true, choices: [...reqs, ...badges] };
}
