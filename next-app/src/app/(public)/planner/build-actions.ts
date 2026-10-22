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
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadBoardStamp, loadUpcomingMeetings } from '@/lib/meeting-board';
import { seedMany, unseedTopic } from '@/lib/meeting-focus-db';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { loadPlannerLists } from '@/lib/people-lists';
import { teachersOfKeys } from '@/lib/build-plan-db';
import { isOfferingKey, PLAN_MEETINGS } from '@/lib/build-plan';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The most keys one Add sends (the Suggested column shows at most 8). Mirrors meeting_seed_many's own cap. */
const ADD_MAX = 20;

export type BuildAddResult = { ok: true; added: string[]; teachers: Record<string, string[]>; prior: string; stamp: string } | { ok: false; error: string };
export type BuildRemoveResult = { ok: true; stays: boolean; prior: string; stamp: string } | { ok: false; error: string };

/** The seed gate on one of the next meetings, with the board's stamp as it stood before the write. */
async function gate(entryId: unknown) {
  if (!Number.isInteger(entryId)) return fail('Malformed request');
  const [s, prior] = await Promise.all([plannerSeeder(entryId, { within: PLAN_MEETINGS }), loadBoardStamp(createAdminClient(), entryId as number).catch(() => '')]);
  return s.ok ? { ...s, prior } : s;
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
