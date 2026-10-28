/**
 * Meeting Planner III, the family side of a meeting (Plans/Meeting-Planner-III.md, Decision 5): what one household
 * sees and may change for one meeting. Shared by /member/meeting (a verified sign-in) and /i/plan/<token> (the
 * published email's scoped link). Server-only, service role; each caller decides WHICH scouts first.
 *
 *   - The focus, the options and each scout's suggestions come from the latest published snapshot: families see what
 *     was sent, not the planners' live edits (none published yet → no options, and "Request something else" still
 *     works).
 *   - A scout's answer is Coming / Not sure yet / Can't make it (meeting_intents, as before).
 *   - A tick is a real pick on the option's topic (a group 'fr:…', a badge group, a class from requests and offers).
 *     At most PLAN_PICK_CAP ticks per scout, checked here and again in the database under the scout's pick lock
 *     (meeting_add_pick_capped). "Request something else" picks from the scout's own pick
 *     list (their next rank, their badges in progress, any badge), the same list the RPC checks.
 *   - Design III carries nothing over from an earlier meeting (Decision 9): a write never hands the RPC carried picks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardScouts, loadMeetingForWrite, loadScoutBoard, loadUpcomingMeetings, removeMeetingPick, setMeetingIntent, type BoardMeeting } from '@/lib/meeting-board';
import { centralToday } from '@/lib/dates';
import { fetchMeetingLabels } from '@/lib/people-lists';
import { PLANNER_WEEKS } from '@/lib/this-week';
import { INTENTS, firstNameOf, type Intent } from '@/lib/meeting-board-shared';
import { pickableKeys, type PickRow } from '@/lib/meeting-board-picklist';
import { loadLatestSnapshot } from '@/lib/plan-snapshot-db';
import type { SnapshotOption } from '@/lib/plan-snapshot';

import { PLAN_PICK_CAP } from '@/lib/family-week-shared';
import { sanitizeRpcError } from '@/lib/meeting-board-supply';

export interface FamilyScout {
  personId: number;
  firstName: string;
  intent: Intent | null;
  /** Current picks for this meeting (their own, not "later"). */
  picks: string[];
  /** The option keys suggested for this scout in the published snapshot. */
  suggested: string[];
  /** "Request something else": the scout's pick list (next rank first, then badges in progress, then any badge). */
  requestable: Pick<PickRow, 'key' | 'label' | 'codeLabel'>[];
  /** Words for picks that aren't options (a request), by key. */
  words: Record<string, { label: string; codeLabel: string }>;
}

export interface FamilyWeek {
  entryId: number;
  date: string;
  focus: string[];
  options: SnapshotOption[];
  /** Null before the first publish. */
  snapshotN: number | null;
  scouts: FamilyScout[];
}

type Catalog = Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges' | 'meritBadgeRequirements'>;

async function scoutSide(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, personId: number, catalog: Catalog, viewerPersonId: number | null) {
  const [scout] = await loadBoardScouts(sb, [personId]);
  if (!scout) return null;
  const board = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId });
  return { scout, board };
}

export async function loadFamilyWeek(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  scoutPersonIds: readonly number[],
  catalog: Catalog,
  viewerPersonId: number | null
): Promise<FamilyWeek> {
  const [snap, sides] = await Promise.all([loadLatestSnapshot(sb, meeting.entryId), Promise.all(scoutPersonIds.map((id) => scoutSide(sb, meeting, id, catalog, viewerPersonId)))]);
  const optionKeys = new Set((snap?.payload.options ?? []).map((o) => o.key));
  const scouts: FamilyScout[] = [];
  for (const side of sides) {
    if (!side) continue;
    const { scout, board } = side;
    const pl = board.pickList;
    const next = pl.groups.find((g) => g.next)?.rows ?? [];
    const requestable = [...next, ...pl.working, ...pl.badges].filter((r) => !optionKeys.has(r.key)).map((r) => ({ key: r.key, label: r.label, codeLabel: r.codeLabel }));
    const own = board.hasOwnList ? board.picks.filter((p) => !p.later).map((p) => p.key) : [];
    const words: FamilyScout['words'] = {};
    for (const t of board.view.picks) words[t.key] = { label: t.label, codeLabel: t.codeLabel };
    scouts.push({
      personId: scout.personId,
      firstName: firstNameOf(scout.name),
      intent: board.view.intent,
      picks: own,
      suggested: snap?.payload.suggested[String(scout.personId)] ?? [],
      requestable,
      words
    });
  }
  return { entryId: meeting.entryId, date: meeting.date, focus: snap?.payload.focus ?? [], options: snap?.payload.options ?? [], snapshotN: snap?.n ?? null, scouts };
}

export type FamilyWrite = { ok: true } | { ok: false; error: string };

export type FamilyOp = { op: 'intent'; intent: Intent } | { op: 'pick'; key: string; on: boolean };

/**
 * One family write for one scout the caller has already allowed. The key must be an option of the latest snapshot or
 * on the scout's own pick list; a fourth tick is refused.
 */
export async function familyWrite(
  sb: SupabaseClient,
  w: { meeting: Pick<BoardMeeting, 'entryId' | 'date'>; actorPersonId: number; scoutPersonId: number; catalog: Catalog },
  op: FamilyOp
): Promise<FamilyWrite> {
  const writer = { entryId: w.meeting.entryId, personId: w.scoutPersonId, actorPersonId: w.actorPersonId, leader: false };
  if (op.op === 'intent') {
    if (!INTENTS.includes(op.intent)) return { ok: false, error: 'Malformed request' };
    return setMeetingIntent(sb, writer, op.intent);
  }
  if (typeof op.key !== 'string' || typeof op.on !== 'boolean') return { ok: false, error: 'Malformed request' };
  const side = await scoutSide(sb, w.meeting, w.scoutPersonId, w.catalog, w.actorPersonId);
  if (!side) return { ok: false, error: 'Picks are for scouts.' };
  const own = side.board.hasOwnList ? side.board.picks.filter((p) => !p.later).map((p) => p.key) : [];
  if (!op.on) return removeMeetingPick(sb, { ...writer, carry: [] }, op.key);
  if (own.includes(op.key)) return { ok: true };
  if (own.length >= PLAN_PICK_CAP) return { ok: false, error: `Pick up to ${PLAN_PICK_CAP} things. Untick one first.` };
  const snap = await loadLatestSnapshot(sb, w.meeting.entryId);
  const isOption = (snap?.payload.options ?? []).some((o) => o.key === op.key);
  if (!isOption && !pickableKeys(side.board.pickList).has(op.key)) return { ok: false, error: 'That isn’t something to pick for this meeting.' };
  // The cap is counted again in the database, under the scout's pick lock, so two ticks at once can't both pass.
  const { error } = await sb.rpc('meeting_add_pick_capped', { p_entry: w.meeting.entryId, p_person: w.scoutPersonId, p_actor: w.actorPersonId, p_topic_key: op.key, p_cap: PLAN_PICK_CAP });
  return error ? { ok: false, error: /^Pick up to/.test(error.message) ? error.message : sanitizeRpcError(error.message) } : { ok: true };
}

/**
 * The meeting a family write is for, or null (qa-lead 2026-10-28): a published troop meeting that takes sign-ups, today
 * or later, and one of the next PLANNER_WEEKS meetings the planner offers. Never a campout, a draft or a far-off entry.
 */
export async function loadOpenMeeting(sb: SupabaseClient, entryId: number): Promise<BoardMeeting | null> {
  const [meeting, labels] = await Promise.all([loadMeetingForWrite(sb, entryId), fetchMeetingLabels(sb)]);
  if (!meeting || !meeting.published || meeting.closed || meeting.date < centralToday()) return null;
  const upcoming = (await loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, labels)).filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
  return upcoming.some((m) => m.entryId === entryId) ? meeting : null;
}
