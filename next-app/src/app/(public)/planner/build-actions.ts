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
import { loadMixOnMeeting, loadTeacherChoices, loadTeacherChoicesMany, teachersOfKeys } from '@/lib/build-plan-db';
import { invitedCount, isOfferingKey, PLAN_MEETINGS, type TeacherChoice } from '@/lib/build-plan';
// The most keys one Add sends (Suggestions mode's "Add N to the plan" chunks at it). Mirrors meeting_seed_many's cap.
import { ADD_MAX } from '@/lib/build-plan-suggest';
import { loadInviteRows } from '@/lib/meeting-invites-db';
import { loadInviteTab } from '@/lib/meeting-invite-digest-db';
import { sendInviteDigests } from '@/lib/meeting-invite-digest-send';
import { DIGEST_INVITE_CAP, DIGEST_KEYS_MAX, type InviteTabData } from '@/lib/meeting-invite-digest';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });


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

export type BuildMixResult = { ok: true; setId: number; name: string; setName: string; items: FocusSetItem[] } | { ok: false; error: string };

/** A mix on the plan, for its Edit: this meeting's name and requirements, and the focus set's own name (B5b). */
export async function plannerMixAction(input: { entryId: number; key: string }): Promise<BuildMixResult> {
  if (typeof input?.key !== 'string' || !MIX_KEY.test(input.key)) return fail('Malformed request');
  const s = await plannerSeeder(input.entryId, { within: PLAN_MEETINGS });
  if (!s.ok) return s;
  const mix = await loadMixOnMeeting(s.sb, s.meeting.entryId, input.key);
  return mix ? { ok: true, ...mix } : fail('That set is no longer on this meeting.');
}

/**
 * Change a mix's name and requirements on THIS meeting's class only (B5b). `updateSet` ("Also update the focus set",
 * confirmed in a Dialog) writes the focus set too, for plans that add it from now on. Both need the seed right; other
 * meetings keep their copy either way.
 */
export async function plannerEditMixAction(input: { entryId: number; key: string; name: string; items: string[]; updateSet?: boolean }): Promise<BuildClassResult> {
  const id = typeof input?.key === 'string' ? MIX_KEY.exec(input.key)?.[1] : undefined;
  if (!id || (input.updateSet !== undefined && typeof input.updateSet !== 'boolean')) return fail('Malformed request');
  const m = mixInput(input.name, input.items);
  if ('error' in m) return fail(m.error);
  const s = await gate(input.entryId);
  if (!s.ok) return s;
  const res = await editMix(s.sb, s.meeting.entryId, Number(id), m.name, m.items, s.actorPersonId, input.updateSet === true);
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

// ── B3: Invite… (adults with the edit right; Decision 2: one digest per recipient) ──────────────────────────────────

/** An adult editor on one of the next meetings, with the keys on its plan. A scout editor (the SPL) never sends. */
async function inviteGate(entryId: unknown) {
  const s = await gate(entryId, 'edit');
  if (!s.ok) return s;
  if (!plannerAccess(await resolveAdminActor()).canEmail) return fail('Only adults send email.');
  const { data, error } = await s.sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', s.meeting.entryId);
  if (error) return fail('That didn’t load. Try again.');
  return { ...s, onPlan: ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key) };
}

export type InviteSheetResult = ({ ok: true } & InviteTabData) | { ok: false; error: string };

/** The Invite tab's data after a send (B6): every offering on the plan, or one. The page loads it first itself. */
export async function plannerInviteSheetAction(input: { entryId: number; key?: string }): Promise<InviteSheetResult> {
  if (input?.key !== undefined && !isTopicKey(input.key)) return fail('Malformed request');
  const s = await inviteGate(input?.entryId);
  if (!s.ok) return s;
  const keys = input.key !== undefined ? s.onPlan.filter((k) => k === input.key) : s.onPlan;
  if (input.key !== undefined && !keys.length) return fail('That isn’t on this meeting’s plan.');
  try {
    return { ok: true, ...(await loadInviteTab(s.sb, s.meeting, keys)) };
  } catch {
    return fail('The list didn’t load. Close and try again.');
  }
}

export type InviteSendResult =
  | { ok: true; sent: string[]; emails: number; skipped: { name: string; reason: string }[]; invited: number; prior: string; stamp: string }
  | { ok: false; error: string };

const idList = (xs: unknown): xs is number[] => Array.isArray(xs) && xs.length <= DIGEST_INVITE_CAP && xs.every((n) => Number.isInteger(n));

/**
 * Send N emails: the ticked teach asks and scout offers, one digest per recipient. Only offerings on this meeting's
 * plan; a teach ask only to a qualified adult not already teaching it (the sheet's rule, re-read here); everything
 * else about who may be invited is re-decided in createInviteDigest.
 */
export async function plannerSendInvitesAction(input: { entryId: number; teach: { key: string; personIds: number[] }[]; pick: { key: string; scoutIds: number[] }[] }): Promise<InviteSendResult> {
  const teach = input?.teach;
  const pick = input?.pick;
  if (!Array.isArray(teach) || !Array.isArray(pick) || teach.length + pick.length > DIGEST_KEYS_MAX * 2) return fail('Malformed request');
  if (!teach.every((t) => isTopicKey(t?.key) && idList(t.personIds)) || !pick.every((p) => isTopicKey(p?.key) && idList(p.scoutIds))) return fail('Malformed request');
  if (!teach.some((t) => t.personIds.length) && !pick.some((p) => p.scoutIds.length)) return fail('Tick at least one person.');
  const s = await inviteGate(input.entryId);
  if (!s.ok) return s;
  const onPlan = new Set(s.onPlan);
  if (![...teach, ...pick].every((x) => onPlan.has(x.key))) return fail('That isn’t on this meeting’s plan.');

  const skippedTeach: { name: string; reason: string }[] = [];
  let allowed = teach;
  if (teach.length) {
    const { choices, people } = await loadTeacherChoicesMany(s.sb, s.meeting, [...new Set(teach.map((t) => t.key))]);
    allowed = teach.map((t) => {
      const ok = new Set((choices.get(t.key) ?? []).filter((c) => c.qualified && !c.teaching && people.get(c.personId)?.kind === 'adult').map((c) => c.personId));
      for (const id of t.personIds) if (!ok.has(id)) skippedTeach.push({ name: people.get(id)?.displayName ?? `Person ${id}`, reason: 'isn’t someone who can teach that' });
      return { key: t.key, personIds: t.personIds.filter((id) => ok.has(id)) };
    });
  }
  if (!allowed.some((t) => t.personIds.length) && !pick.some((p) => p.scoutIds.length)) {
    // Every tick was refused here: say who and why, send nothing.
    return { ok: true, sent: [], emails: 0, skipped: skippedTeach, invited: invitedCount(await loadInviteRows(s.sb, s.meeting.entryId)), prior: s.prior, stamp: s.prior };
  }
  const res = await sendInviteDigests(s.sb, { entryId: s.meeting.entryId, teach: allowed, pick, sentBy: s.actorPersonId });
  if (!res.ok) return res;
  const [stamp, rows] = await Promise.all([loadBoardStamp(s.sb, s.meeting.entryId), loadInviteRows(s.sb, s.meeting.entryId)]);
  return { ...res, skipped: [...skippedTeach, ...res.skipped], invited: invitedCount(rows), prior: s.prior, stamp };
}
