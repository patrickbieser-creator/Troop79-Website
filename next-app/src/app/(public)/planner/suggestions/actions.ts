'use server';

/**
 * Suggestions' one write of its own (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"): put several
 * requirements on a meeting's plan at once, through This week's own add (lib/meeting-focus-db seedMany, the
 * meeting_seed_many RPC), so This week's checklist and Live see them at once. The planning team (seed) only, on one of
 * the planner's meetings. A teacher from the Teaching view goes through This week's twSetTeacherAction; Save as a
 * focus set through Focus sets' focusSaveSetAction.
 */
import { loadBoardStamp } from '@/lib/meeting-board';
import { seedMany } from '@/lib/meeting-focus-db';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { PLANNER_WEEKS } from '@/lib/this-week';
import { isGroupKey } from '@/lib/focus-plan';
import { ADD_MAX } from '@/lib/planner-suggest';

export type SuggestAddResult = { ok: true; stamp: string; seeded: string[] } | { ok: false; error: string };

/** A requirement the engine suggests: a rank or merit badge requirement's key, never a group, focus or freeform topic. */
const REQ_KEY = /^[a-z0-9][a-z0-9.-]{0,118}[a-z0-9]$/;

export async function suggestAddAction(input: { entryId: number; keys: string[] }): Promise<SuggestAddResult> {
  const keys = input?.keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > ADD_MAX || !keys.every((k) => typeof k === 'string' && REQ_KEY.test(k) && !isGroupKey(k))) {
    return { ok: false, error: 'Malformed request' };
  }
  const s = await plannerSeeder(input.entryId, { within: PLANNER_WEEKS, right: 'seed' });
  if (!s.ok) return s;
  const res = await seedMany(s.sb, s.meeting.entryId, [...new Set(keys)], s.actorPersonId);
  if (!res.ok) return res;
  return { ok: true, stamp: await loadBoardStamp(s.sb, s.meeting.entryId), seeded: res.seeded };
}
