'use server';

/**
 * Build a Plan server actions (Plans/Build-A-Plan.md, B1). Seed holders only (lib/meeting-planner-seeder), on one of
 * the next 4 meetings the switcher offers, checked before the database is written; the RPCs re-check the meeting.
 *
 * Perf (2026-10-22): no whole-board reload and no revalidatePath per click. Each write returns the slice it changed,
 * the board's stamp read just BEFORE the write (`prior`) and the one after (`stamp`). The page keeps the new stamp only
 * when `prior` is the stamp it already had, so a change someone else made since the page loaded still refreshes it
 * (qa-lead, 2026-10-22). The prior stamp is read alongside the gate's own reads: one more round trip, no more latency.
 *   - Add: the gate (meeting, the next meetings), the prior stamp, one meeting_seed_many call (one advisory lock for
 *     every key), then the stamp and who teaches the new rows (two reads; more only when someone could be teaching
 *     them). The same count however many keys.
 *   - Remove: the gate, the prior stamp, the unseed RPC, one read of whether the topic stayed, the stamp.
 *
 * The stamp window (qa-lead B2 #2, documented rather than closed): `prior` and `stamp` are read outside the write's
 * own lock, so a change someone else commits between the prior read and the after read is folded into `stamp` and
 * that page won't refresh for it. Reading both inside the RPC's lock would only narrow it (picks and answers don't
 * take the seed lock), so the window stays; the cost is one missed refresh, which the next poll tick or any later
 * change repairs (the poller compares the whole board stamp).
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadBoardStamp, loadUpcomingMeetings } from '@/lib/meeting-board';
import { editMix, newMix, seedFocusSet, seedMany, unseedTopic } from '@/lib/meeting-focus-db';
import { teachTopic, unteachTopic } from '@/lib/meeting-board-supply';
import { SET_NAME_MAX, type FocusSetItem } from '@/lib/meeting-focus';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { loadPlannerLists } from '@/lib/people-lists';
import { loadMixOnMeeting, loadTeacherChoices, teachersOfKeys } from '@/lib/build-plan-db';
import { isOfferingKey, PLAN_MEETINGS, type TeacherChoice } from '@/lib/build-plan';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The most keys one Add sends (the Suggested column shows at most 8). Mirrors meeting_seed_many's own cap. */
const ADD_MAX = 20;

export type BuildAddResult = { ok: true; added: string[]; teachers: Record<string, string[]>; prior: string; stamp: string } | { ok: false; error: string };
export type BuildRemoveResult = { ok: true; stays: boolean; prior: string; stamp: string } | { ok: false; error: string };

/** The seed gate (or, for a teacher, the edit gate) on one of the next meetings, with the board's stamp as it stood
 *  before the write. */
async function gate(entryId: unknown, right: 'seed' | 'edit' = 'seed') {
  if (!Number.isInteger(entryId)) return fail('Malformed request');
  const [s, prior] = await Promise.all([plannerSeeder(entryId, { within: PLAN_MEETINGS, right }), loadBoardStamp(createAdminClient(), entryId as number).catch(() => '')]);
  return s.ok ? { ...s, prior } : s;
}

const MIX_KEY = /^fg:(\d{1,18})$/;
/** A focus set item: a requirement key at any level ('tenderfoot-4a.1', 'first-aid-9b'). */
const isItemKey = (k: unknown): k is string => typeof k === 'string' && /^[a-z0-9][a-z0-9.-]{0,118}[a-z0-9]$/i.test(k);
const MIX_MAX = 300;
function mixInput(name: unknown, items: unknown): { name: string; items: string[] } | { error: string } {
  if (typeof name !== 'string' || !Array.isArray(items) || items.length > MIX_MAX || !items.every(isItemKey)) return { error: 'Malformed request' };
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return { error: 'Give the mix a name.' };
  if (n.length > SET_NAME_MAX) return { error: `Keep the name to ${SET_NAME_MAX} characters.` };
  if (!items.length) return { error: 'Tick at least one requirement.' };
  return { name: n, items: [...new Set(items)] };
}

/** Add one or more offerings (top-level requirements) to a meeting's plan: live to scouts at once (Decision 1). */
export async function plannerAddOfferingAction(input: { entryId: number; keys: string[] }): Promise<BuildAddResult> {
  const keys = input?.keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > ADD_MAX || !keys.every(isOfferingKey)) return fail('Malformed request');
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await seedMany(s.sb, s.meeting.entryId, keys, s.actorPersonId);
  if (!res.ok) return res;
  const [stamp, teachers] = await Promise.all([loadBoardStamp(s.sb, s.meeting.entryId), teachersOfKeys(s.sb, s.meeting, keys).catch(() => new Map<string, string[]>())]);
  return { ok: true, added: res.seeded, teachers: Object.fromEntries(teachers), prior: s.prior, stamp };
}

/** Remove a seeded offering: the unseed. It stays (as theirs) when scouts picked it or someone signed up to teach it. */
export async function plannerRemoveOfferingAction(input: { entryId: number; key: string }): Promise<BuildRemoveResult> {
  if (!isOfferingKey(input?.key) && !/^fg:\d{1,18}$/.test(String(input?.key))) return fail('Malformed request');
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await unseedTopic(s.sb, s.meeting.entryId, input.key);
  if (!res.ok) return res;
  const [{ data, error }, stamp] = await Promise.all([
    s.sb.from('meeting_topics').select('id').eq('calendar_entry_id', s.meeting.entryId).eq('topic_key', input.key).maybeSingle(),
    loadBoardStamp(s.sb, s.meeting.entryId)
  ]);
  // Unread: keep the row in view (as theirs); the next refresh shows it as it is.
  return { ok: true, stays: error != null || data != null, prior: s.prior, stamp };
}

/** The board stamp for the poller on Build a Plan: any viewer, any of the meetings the switcher offers. */
export async function plannerBuildStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false }> {
  if (!plannerAccess(await resolveAdminActor()).canView || !Number.isInteger(entryId)) return { ok: false };
  try {
    const sb = createAdminClient();
    const lists = await loadPlannerLists();
    const meetings = (await loadUpcomingMeetings(sb, PLAN_MEETINGS * 2, undefined, lists.meetingLabels)).filter((m) => !m.closed).slice(0, PLAN_MEETINGS);
    if (!meetings.some((m) => m.entryId === entryId)) return { ok: false };
    return { ok: true, stamp: await loadBoardStamp(sb, entryId) };
  } catch {
    return { ok: false };
  }
}

// ── B2: focus sets, new mixes, editing a mix, the teacher ────────────────────────────────────────────────────────────

export type BuildClassResult = { ok: true; key: string; title: string; count: number; teachers: string[]; prior: string; stamp: string } | { ok: false; error: string };

/** Add a focus set to the plan as one class (fg:<id>). Adding it again changes nothing. */
export async function plannerAddFocusSetAction(input: { entryId: number; setId: number }): Promise<BuildClassResult> {
  if (!Number.isInteger(input?.setId)) return fail('Malformed request');
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await seedFocusSet(s.sb, s.meeting.entryId, input.setId, s.actorPersonId);
  if (!res.ok) return res;
  const key = `fg:${input.setId}`;
  const [stamp, teachers, title] = await Promise.all([
    loadBoardStamp(s.sb, s.meeting.entryId),
    teachersOfKeys(s.sb, s.meeting, [key]).catch(() => new Map<string, string[]>()),
    s.sb.from('meeting_topics').select('title').eq('calendar_entry_id', s.meeting.entryId).eq('topic_key', key).maybeSingle()
  ]);
  return { ok: true, key, title: (title.data as { title: string } | null)?.title ?? '', count: res.count, teachers: teachers.get(key) ?? [], prior: s.prior, stamp };
}

/**
 * A new mix: the ticked requirements saved as a new focus set AND added to the plan as one class, in one transaction
 * (meeting_new_mix), so a failure leaves no set behind.
 */
export async function plannerNewMixAction(input: { entryId: number; name: string; items: string[] }): Promise<BuildClassResult> {
  const m = mixInput(input?.name, input?.items);
  if ('error' in m) return fail(m.error);
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await newMix(s.sb, s.meeting.entryId, m.name, m.items, s.actorPersonId);
  if (!res.ok) return res;
  return { ok: true, key: `fg:${res.setId}`, title: m.name, count: m.items.length, teachers: [], prior: s.prior, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
}

export type BuildMixResult = { ok: true; setId: number; name: string; items: FocusSetItem[] } | { ok: false; error: string };

/** A mix on the plan, for its Edit: its name and the requirements this meeting's class holds. */
export async function plannerMixAction(input: { entryId: number; key: string }): Promise<BuildMixResult> {
  if (typeof input?.key !== 'string' || !MIX_KEY.test(input.key)) return fail('Malformed request');
  const s = await plannerSeeder(input.entryId, { within: PLAN_MEETINGS });
  if (!s.ok) return s;
  const mix = await loadMixOnMeeting(s.sb, s.meeting.entryId, input.key);
  return mix ? { ok: true, ...mix } : fail('That set is no longer on this meeting.');
}

/** Change a mix's name and requirements: the focus set (wherever it is used next) and this meeting's class. */
export async function plannerEditMixAction(input: { entryId: number; key: string; name: string; items: string[] }): Promise<BuildClassResult> {
  const id = typeof input?.key === 'string' ? MIX_KEY.exec(input.key)?.[1] : undefined;
  if (!id) return fail('Malformed request');
  const m = mixInput(input.name, input.items);
  if ('error' in m) return fail(m.error);
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await editMix(s.sb, s.meeting.entryId, Number(id), m.name, m.items, s.actorPersonId);
  if (!res.ok) return res;
  return { ok: true, key: input.key, title: m.name, count: res.count, teachers: [], prior: s.prior, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
}

const isTopicKey = (k: unknown): k is string => isOfferingKey(k) || (typeof k === 'string' && (MIX_KEY.test(k) || /^(ff|mb):.{1,100}$/.test(k)));

/** Who could teach an offering: qualified first with why, counselors labelled (editors only). */
export async function plannerTeacherChoicesAction(input: { entryId: number; key: string }): Promise<{ ok: true; choices: TeacherChoice[] } | { ok: false; error: string }> {
  if (!isTopicKey(input?.key)) return fail('Malformed request');
  const s = await plannerSeeder(input.entryId, { within: PLAN_MEETINGS, right: 'edit' });
  if (!s.ok) return s;
  return { ok: true, choices: await loadTeacherChoices(s.sb, s.meeting, input.key) };
}

export type BuildTeacherResult = { ok: true; teachers: string[]; onBoard: boolean; prior: string; stamp: string } | { ok: false; error: string };

/**
 * Set or clear one teacher on an offering (edit right): signs them up to teach it (for_picks false: theirs until taken
 * off) or takes them off. The RPCs re-check who may teach. Returns the row's teachers and whether it is still on the
 * meeting (a row nothing else holds goes when its last teacher does).
 */
export async function plannerSetTeacherAction(input: { entryId: number; key: string; personId: number; on: boolean }): Promise<BuildTeacherResult> {
  if (!isTopicKey(input?.key) || !Number.isInteger(input.personId) || typeof input.on !== 'boolean') return fail('Malformed request');
  const s = await gate(input.entryId, 'edit');
  if (!s.ok) return s;
  if (input.on) {
    // Only an offering already on the plan (qa-lead B2 #4): an edit-only holder must not put a new topic on the meeting.
    const { data: onPlan } = await s.sb.from('meeting_topics').select('id').eq('calendar_entry_id', s.meeting.entryId).eq('topic_key', input.key).maybeSingle();
    if (!onPlan) return fail('That isn’t on this meeting’s plan.');
  }
  const w = { personId: input.personId, actorPersonId: s.actorPersonId, leader: true };
  const res = input.on ? await teachTopic(s.sb, w, [s.meeting.entryId], { key: input.key }, null) : await unteachTopic(s.sb, w, s.meeting.entryId, input.key);
  if (!res.ok) return res;
  const [stamp, teachers, topic] = await Promise.all([
    loadBoardStamp(s.sb, s.meeting.entryId),
    teachersOfKeys(s.sb, s.meeting, [input.key]),
    s.sb.from('meeting_topics').select('id').eq('calendar_entry_id', s.meeting.entryId).eq('topic_key', input.key).maybeSingle()
  ]);
  return { ok: true, teachers: teachers.get(input.key) ?? [], onBoard: topic.error != null || topic.data != null, prior: s.prior, stamp };
}
