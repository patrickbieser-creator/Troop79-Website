'use server';

/**
 * Build a Plan server actions (Plans/Build-A-Plan.md, B1). Seed holders only (lib/meeting-planner-seeder), checked
 * before the database is written; the RPCs re-check the meeting.
 *
 * Perf (2026-10-22): no whole-board reload and no revalidatePath per click. Each write returns the slice it changed
 * and the board's new stamp, so the page lays it over what it shows and the poller doesn't refresh over it.
 *   - Add: one meeting read, one meeting_seed_many call (one advisory lock for every key), one stamp read: three round
 *     trips however many keys.
 *   - Remove: the existing unseed RPC, one read of whether the topic stayed (picks or teachers keep it), one stamp.
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadBoardStamp, loadUpcomingMeetings } from '@/lib/meeting-board';
import { seedMany, unseedTopic } from '@/lib/meeting-focus-db';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { loadPlannerLists } from '@/lib/people-lists';
import { PLAN_MEETINGS } from '@/lib/build-plan';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The most keys one Add sends (the Suggested column shows at most 8). Mirrors meeting_seed_many's own cap. */
const ADD_MAX = 20;

export type BuildAddResult = { ok: true; added: string[]; stamp: string } | { ok: false; error: string };
export type BuildRemoveResult = { ok: true; stays: boolean; stamp: string } | { ok: false; error: string };

/** Add one or more offerings (top-level requirements) to a meeting's plan: live to scouts at once (Decision 1). */
export async function plannerAddOfferingAction(input: { entryId: number; keys: string[] }): Promise<BuildAddResult> {
  const keys = input?.keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > ADD_MAX || !keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 120)) return fail('Malformed request');
  const s = await plannerSeeder(input.entryId);
  if (!s.ok) return s;
  const res = await seedMany(s.sb, s.meeting.entryId, keys, s.actorPersonId);
  if (!res.ok) return res;
  return { ok: true, added: res.seeded, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
}

/** Remove a seeded offering: the unseed. It stays (as theirs) when scouts picked it or someone signed up to teach it. */
export async function plannerRemoveOfferingAction(input: { entryId: number; key: string }): Promise<BuildRemoveResult> {
  const s = await plannerSeeder(input?.entryId);
  if (!s.ok) return s;
  if (typeof input.key !== 'string' || !input.key) return fail('Malformed request');
  const res = await unseedTopic(s.sb, s.meeting.entryId, input.key);
  if (!res.ok) return res;
  const [{ data, error }, stamp] = await Promise.all([
    s.sb.from('meeting_topics').select('id').eq('calendar_entry_id', s.meeting.entryId).eq('topic_key', input.key).maybeSingle(),
    loadBoardStamp(s.sb, s.meeting.entryId)
  ]);
  // Unread: keep the row in view (as theirs); the next refresh shows it as it is.
  return { ok: true, stays: error != null || data != null, stamp };
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
