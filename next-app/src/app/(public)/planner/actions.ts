'use server';

/**
 * Meeting Planner server actions (Plans/Meeting-Planner-II.md).
 *
 * P1: the board's version stamp for the poller, for anyone who may view, and only for the meeting the planner shows.
 * P2a: an editor (meeting_planner.edit; the SPL holds it as a scout) enters answers and picks for someone, signs an
 * adult up to teach or takes them off, assigns a teacher, and adds an offer. Every write goes through v1's writers
 * with leader = true and the editor as entered_by, so the RPCs keep their own rules (active scouts only, 5 picks, who
 * may teach, Junior Leaders and adults-only skills, closed and past boards). No email here: that's P2b, adults only.
 * Each write returns the person's fresh drawer and the board's new stamp, so the poller doesn't refresh over it.
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
  loadMeetingById,
  loadNextMeeting,
  loadScoutBoard,
  removeMeetingPick,
  setMeetingIntent,
  type BoardWriteResult
} from '@/lib/meeting-board';
import { loadSupplyRows, loadTeacherPeople, teachTopic, unteachTopic } from '@/lib/meeting-board-supply';
import { INTENTS, type Intent } from '@/lib/meeting-board-shared';
import { pickableKeys } from '@/lib/meeting-board-picklist';
import { FREEFORM_MAX, freeformTitle } from '@/lib/meeting-board-teach';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPersonDrawer, type PersonDrawer } from '@/lib/meeting-planner-drawer';

export type PlannerDrawerResult = { ok: true; drawer: PersonDrawer; stamp: string } | { ok: false; error: string };
export type PlannerWriteResult = { ok: true; stamp: string } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function plannerStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false }> {
  if (!plannerAccess(await resolveAdminActor()).canView || !Number.isInteger(entryId)) return { ok: false };
  try {
    const sb = createAdminClient();
    if ((await loadNextMeeting(sb))?.entryId !== entryId) return { ok: false };
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
  const meeting = await loadMeetingById(sb, entryId as number);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  const { data: entry } = await sb.from('calendar_entries').select('status').eq('id', meeting.entryId).maybeSingle();
  if ((entry as { status: string } | null)?.status !== 'published' || meeting.mode === 'closed') return fail('That meeting isn’t taking sign-ups.');
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
  revalidatePath('/member');
  revalidatePath('/member/meeting');
  revalidatePath('/admin/advancement/meeting-plan');
}

async function drawerAfter(e: Editor, res: BoardWriteResult): Promise<PlannerDrawerResult> {
  if (!res.ok) return res;
  revalidate();
  const [drawer, stamp] = await Promise.all([loadPersonDrawer(e.sb, e.meeting, e.personId, e.actorPersonId), loadBoardStamp(e.sb, e.meeting.entryId)]);
  return drawer ? { ok: true, drawer, stamp } : fail('That person isn’t on the board.');
}

/** Open someone's drawer. */
export async function plannerOpenPersonAction(input: { entryId: number; personId: number }): Promise<PlannerDrawerResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  return drawerAfter(e, { ok: true });
}

/** Coming / Not sure / Can't, for a scout or an adult. */
export async function plannerSetAnswerAction(input: { entryId: number; personId: number; intent: Intent }): Promise<PlannerDrawerResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (!INTENTS.includes(input.intent)) return fail('Malformed request');
  if (!(await onTheBoard(e))) return fail('That person isn’t on the board.');
  return drawerAfter(e, await setMeetingIntent(e.sb, { entryId: e.meeting.entryId, personId: e.personId, actorPersonId: e.actorPersonId, leader: true }, input.intent));
}

/** Tick or untick one of a scout's picks. */
export async function plannerTogglePickAction(input: { entryId: number; personId: number; key: string; on: boolean }): Promise<PlannerDrawerResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (typeof input.key !== 'string' || typeof input.on !== 'boolean') return fail('Malformed request');
  const scout = (await loadBoardScouts(e.sb, [e.personId]))[0];
  if (!scout) return fail('Picks are for scouts.');
  const catalog = await loadAdvancementCatalog();
  const freeform = (await loadSupplyRows(e.sb, [e.meeting.entryId])).freeform.map((f) => ({ key: f.key, title: f.title }));
  const board = await loadScoutBoard(e.sb, e.meeting, scout, catalog, { viewerPersonId: e.actorPersonId, freeform });
  const writer = { entryId: e.meeting.entryId, personId: e.personId, actorPersonId: e.actorPersonId, leader: true, carry: board.hasOwnList ? null : board.picks };
  if (!input.on) return drawerAfter(e, await removeMeetingPick(e.sb, writer, input.key));
  if (!pickableKeys(board.pickList).has(input.key)) return fail('That isn’t on their pick list.');
  return drawerAfter(e, await addMeetingPick(e.sb, writer, input.key, { later: false, markComing: false }));
}

/** Sign an adult (or a Junior Leader) up to teach a topic, or take them off it. No cap (Decision 7). */
export async function plannerToggleTeachAction(input: { entryId: number; personId: number; key: string; on: boolean }): Promise<PlannerDrawerResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (typeof input.key !== 'string' || typeof input.on !== 'boolean') return fail('Malformed request');
  const w = { personId: e.personId, actorPersonId: e.actorPersonId, leader: true };
  return drawerAfter(e, input.on ? await teachTopic(e.sb, w, [e.meeting.entryId], { key: input.key }, null) : await unteachTopic(e.sb, w, e.meeting.entryId, input.key));
}

/**
 * Assign: for the day of the meeting. The person teaches the topic and is marked Coming. Two writes, both idempotent;
 * if the second fails the commitment stands and the message says so.
 */
export async function plannerAssignAction(input: { entryId: number; personId: number; key: string }): Promise<PlannerWriteResult> {
  const e = await editor(input?.entryId, input?.personId);
  if (!e.ok) return e;
  if (typeof input.key !== 'string') return fail('Malformed request');
  const taught = await teachTopic(e.sb, { personId: e.personId, actorPersonId: e.actorPersonId, leader: true }, [e.meeting.entryId], { key: input.key }, null);
  if (!taught.ok) return taught;
  revalidate();
  const coming = await setMeetingIntent(e.sb, { entryId: e.meeting.entryId, personId: e.personId, actorPersonId: e.actorPersonId, leader: true }, 'coming');
  if (!coming.ok) return fail('Assigned, but couldn’t mark them Coming. Open their name to set it.');
  return { ok: true, stamp: await loadBoardStamp(e.sb, e.meeting.entryId) };
}

/** Add an offer: a requirement or a typed title, taught by someone (P2a: a teacher is required; Decision 10b). */
export async function plannerAddOfferAction(input: { entryId: number; personId: number; what: { key: string } | { title: string } }): Promise<PlannerDrawerResult> {
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
  return drawerAfter(e, await teachTopic(e.sb, w, [e.meeting.entryId], 'key' in what ? { key: what.key } : { title }, null));
}

export interface OfferChoice {
  key: string;
  /** 'Tenderfoot 4a'. */
  codeLabel: string;
  label: string;
}

/** What an offer can be: every top-level rank requirement that can be done at a meeting, and every merit badge. */
export async function plannerOfferChoicesAction(): Promise<{ ok: true; choices: OfferChoice[] } | { ok: false; error: string }> {
  if (!plannerAccess(await resolveAdminActor()).canEdit) return fail('Only someone who can edit the Meeting Planner can do that.');
  const catalog = await loadAdvancementCatalog();
  const ranks = [...catalog.ranks].sort((a, b) => a.sort_order - b.sort_order);
  const reqs = ranks.flatMap((r) =>
    catalog.rankRequirements
      .filter((q) => q.rank_id === r.id && q.parent_id == null && q.venue !== 'outing' && q.code.toLowerCase() !== 'bor')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((q) => ({ key: `${r.id}-${q.code}`, codeLabel: `${r.display_name} ${q.code}`, label: q.label }))
  );
  const badges = [...catalog.meritBadges].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ key: `mb:${m.id}`, codeLabel: 'Merit badge', label: m.name }));
  return { ok: true, choices: [...reqs, ...badges] };
}
