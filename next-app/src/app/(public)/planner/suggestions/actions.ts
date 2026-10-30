'use server';

/**
 * Suggestions' one write of its own (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"): put several
 * requirements on a meeting's plan at once, through This week's own add (lib/meeting-focus-db seedMany, the
 * meeting_seed_many RPC), so This week's checklist and Live see them at once. The planning team (seed) only, on one of
 * the planner's meetings. A teacher from the Teaching view goes through This week's twSetTeacherAction; Save as a
 * focus set through Focus sets' focusSaveSetAction.
 */
import { addMeetingPick, loadBoardScouts, loadBoardStamp, loadScoutBoard } from '@/lib/meeting-board';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { teachTopic } from '@/lib/meeting-board-supply';
import { seedMany } from '@/lib/meeting-focus-db';
import { checkReviewers, reviewRule } from '@/lib/planner-reviews';
import { loadReviewData } from '@/lib/planner-reviews-db';
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

export type ReviewAddResult = { ok: true; stamp: string } | { ok: false; error: string };

/**
 * The lead list's Add (Patrick, 2026-10-29): put a scout's Scoutmaster conference and/or board of review on a meeting's
 * plan with the people sitting it. Everything is decided again here: the scout must still have only those left
 * (lib/planner-reviews), each item must be one they need, and its people must fit the rule (the Scoutmaster; two
 * scouts of the right rank; an adult and a First Class scout; two adults). The items go on through This week's own add,
 * the people sign up to teach them, the scout picks each, and is placed in the board (or the conference when that's
 * all) so This week lists them there.
 */
export async function suggestAddReviewAction(input: { entryId: number; personId: number; items: { key: string; reviewerIds: number[] }[] }): Promise<ReviewAddResult> {
  const items = input?.items;
  if (
    !Number.isInteger(input?.personId) ||
    !Array.isArray(items) ||
    !items.length ||
    items.length > 2 ||
    !items.every((i) => typeof i?.key === 'string' && Array.isArray(i.reviewerIds) && i.reviewerIds.length <= 4 && i.reviewerIds.every((n) => Number.isInteger(n)))
  ) {
    return { ok: false, error: 'Malformed request' };
  }
  const s = await plannerSeeder(input.entryId, { within: PLANNER_WEEKS, right: 'seed' });
  if (!s.ok) return s;
  const data = await loadReviewData(s.sb, input.personId);
  const who = data.candidates.find((c) => c.personId === input.personId);
  if (!who) return { ok: false, error: 'They have more than the conference and board of review left.' };
  for (const item of items) {
    const need = who.needs.find((n) => n.key === item.key);
    if (!need) return { ok: false, error: 'That isn’t something they still need.' };
    const rule = reviewRule(need.kind, who.rankId, data.ranks);
    if (!rule) return { ok: false, error: 'That board isn’t planned at troop meetings.' };
    const wrong = checkReviewers(rule, item.reviewerIds, data.pool, who.personId);
    if (wrong) return { ok: false, error: wrong };
  }
  const keys = items.map((i) => i.key);
  const seeded = await seedMany(s.sb, s.meeting.entryId, keys, s.actorPersonId);
  if (!seeded.ok) return seeded;
  for (const item of items) {
    for (const id of item.reviewerIds) {
      const res = await teachTopic(s.sb, { personId: id, actorPersonId: s.actorPersonId, leader: true }, [s.meeting.entryId], { key: item.key }, null);
      if (!res.ok) return res;
    }
  }
  const [scout] = await loadBoardScouts(s.sb, [who.personId]);
  if (scout) {
    const board = await loadScoutBoard(s.sb, s.meeting, scout, await loadAdvancementCatalog(), { viewerPersonId: s.actorPersonId });
    const writer = { entryId: s.meeting.entryId, personId: who.personId, actorPersonId: s.actorPersonId, leader: true, carry: board.hasOwnList ? null : board.picks };
    for (const key of keys) {
      if (board.picks.some((p) => p.key === key && !p.later)) continue;
      const res = await addMeetingPick(s.sb, writer, key, { later: false, markComing: false });
      if (!res.ok) return res;
      writer.carry = null;
    }
  }
  const place = keys.find((k) => /-bor$/i.test(k)) ?? keys[0];
  const { error } = await s.sb
    .from('meeting_scout_roles')
    .upsert({ calendar_entry_id: s.meeting.entryId, person_id: who.personId, role: 'request', ref_key: place, set_by_person_id: s.actorPersonId, set_at: new Date().toISOString() }, { onConflict: 'calendar_entry_id,person_id' });
  if (error) return { ok: false, error: 'Couldn’t place them. Try again.' };
  return { ok: true, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
}
