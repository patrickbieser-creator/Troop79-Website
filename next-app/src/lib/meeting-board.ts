/**
 * Meeting board loaders and writers (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md). Server-only: every
 * function takes the service-role client. The rules themselves are in lib/meeting-board-shared (pure) and
 * lib/meeting-board-picklist (pure); this file only reads and writes.
 *
 * "The next meeting" is the next published calendar entry whose category behaves as a meeting (behavior 'meeting',
 * today's Troop Meeting category), on or after today in Central time, so Sunday's board stays up all of Sunday.
 *
 * Carry-forward is LAZY: a scout's picks on a board they haven't touched yet are computed from their last board that
 * has a pick list (unfinished picks, "later" cleared, first-asked kept). The first write on the new board hands that
 * list to the RPC (p_carry), which copies it in under the per-(meeting, person) lock. The admin tab reads the same
 * computation, so a scout who never opens next week's page still counts with their carried picks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import { buildPickList, isPickFinished, rankTrees, trayPicks, type PickListView, type ScoutBoardView } from '@/lib/meeting-board-picklist';
import {
  boardName,
  carryForward,
  resolveBoardMode,
  summarizeBoard,
  type BoardMode,
  type BoardPick,
  type Intent
} from '@/lib/meeting-board-shared';

export interface BoardMeeting {
  entryId: number;
  /** 'YYYY-MM-DD' (a calendar day). */
  date: string;
  title: string;
  startTime: string | null;
  location: string | null;
  mode: BoardMode;
  mbId: string | null;
  blockCount: number;
}

type EntryRow = {
  id: number;
  entry_date: string;
  title: string;
  start_time: string | null;
  location: string | null;
  category: string;
  calendar_categories: { behavior: string | null } | { behavior: string | null }[] | null;
  meeting_boards: { board_mode: BoardMode; board_mb_id: string | null; block_count: number } | { board_mode: BoardMode; board_mb_id: string | null; block_count: number }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const ENTRY_COLS = 'id, entry_date, title, start_time, location, category, calendar_categories(behavior), meeting_boards(board_mode, board_mb_id, block_count)';

function toMeeting(r: EntryRow): BoardMeeting {
  const board = one(r.meeting_boards);
  return {
    entryId: r.id,
    date: r.entry_date,
    title: r.title,
    startTime: r.start_time,
    location: r.location,
    mode: resolveBoardMode({ boardMode: board?.board_mode ?? null, categoryBehavior: one(r.calendar_categories)?.behavior ?? null, title: r.title }),
    mbId: board?.board_mb_id ?? null,
    blockCount: board?.block_count ?? 2
  };
}

export async function loadNextMeeting(sb: SupabaseClient, today: string = centralToday()): Promise<BoardMeeting | null> {
  return (await loadUpcomingMeetings(sb, 1, today))[0] ?? null;
}

/** The next `limit` published Troop Meeting entries on or after today (Central), soonest first: the dates a standing
 *  teaching offer can list (Phase 2). Closed and merit badge boards are included; the caller filters by mode. */
export async function loadUpcomingMeetings(sb: SupabaseClient, limit: number, today: string = centralToday()): Promise<BoardMeeting[]> {
  const { data: cats, error: catErr } = await sb.from('calendar_categories').select('label').eq('behavior', 'meeting');
  if (catErr) throw new Error(catErr.message);
  const labels = ((cats ?? []) as { label: string }[]).map((c) => c.label);
  if (!labels.length) return [];
  const { data, error } = await sb
    .from('calendar_entries')
    .select(ENTRY_COLS)
    .in('category', labels)
    .eq('status', 'published')
    .gte('entry_date', today)
    .order('entry_date')
    .order('start_time', { nullsFirst: false })
    .order('id')
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as EntryRow[]).map(toMeeting);
}

export async function loadMeetingById(sb: SupabaseClient, entryId: number): Promise<BoardMeeting | null> {
  const { data, error } = await sb.from('calendar_entries').select(ENTRY_COLS).eq('id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toMeeting(data as unknown as EntryRow) : null;
}

export interface BoardScout {
  personId: number;
  scoutId: string;
  name: string;
  currentRank: string | null;
}

/** Active scouts with a person record (picks are keyed to the person). Pass ids to narrow. */
export async function loadBoardScouts(sb: SupabaseClient, personIds?: readonly number[]): Promise<BoardScout[]> {
  let q = sb.from('scouts').select('id, display_name, person_id, current_rank').eq('active', true).not('person_id', 'is', null).order('display_name');
  if (personIds) {
    if (!personIds.length) return [];
    q = q.in('person_id', personIds as number[]);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; display_name: string; person_id: number; current_rank: string | null }[]).map((s) => ({
    personId: s.person_id,
    scoutId: s.id,
    name: s.display_name,
    currentRank: s.current_rank
  }));
}

/** The active scouts in any household this person belongs to (themself excluded). */
export async function loadHouseholdScoutPersonIds(sb: SupabaseClient, personId: number): Promise<number[]> {
  const { data: mine, error } = await sb.from('household_members').select('household_id').eq('person_id', personId);
  if (error) throw new Error(error.message);
  const households = ((mine ?? []) as { household_id: number }[]).map((h) => h.household_id);
  if (!households.length) return [];
  const { data: members, error: memErr } = await sb.from('household_members').select('person_id').in('household_id', households);
  if (memErr) throw new Error(memErr.message);
  const ids = [...new Set(((members ?? []) as { person_id: number }[]).map((m) => m.person_id))].filter((id) => id !== personId);
  return (await loadBoardScouts(sb, ids)).map((s) => s.personId);
}

export interface ScoutProgress {
  rankCodes: Set<string>;
  mbProgress: { mb_id: string; awarded: boolean; has_any_req: boolean }[];
}

/** Each scout's rank-requirement ledger codes and badge progress (paginated: the ledger is far past 1000 rows). */
export async function loadScoutProgress(sb: SupabaseClient, scoutIds: readonly string[]): Promise<Map<string, ScoutProgress>> {
  const out = new Map<string, ScoutProgress>(scoutIds.map((id) => [id, { rankCodes: new Set<string>(), mbProgress: [] }]));
  if (!scoutIds.length) return out;
  const ids = [...scoutIds];
  const [ledger, progress] = await Promise.all([
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      sb.from('ledger_active').select('scout_id, code').eq('kind', 'rank_requirement').in('scout_id', ids).order('id').range(from, to)
    ),
    fetchAllRows<{ scout_id: string; mb_id: string; awarded: boolean; has_any_req: boolean }>((from, to) =>
      sb.from('mb_progress').select('scout_id, mb_id, awarded, has_any_req').in('scout_id', ids).order('scout_id').order('mb_id').range(from, to)
    )
  ]);
  for (const l of ledger) out.get(l.scout_id)?.rankCodes.add(l.code);
  for (const p of progress) out.get(p.scout_id)?.mbProgress.push({ mb_id: p.mb_id, awarded: p.awarded, has_any_req: p.has_any_req });
  return out;
}

type PickDbRow = {
  calendar_entry_id: number;
  person_id: number;
  priority: number | null;
  later: boolean;
  note: string | null;
  first_asked_on: string;
  entered_by_person_id: number | null;
  meeting_topics: { topic_key: string } | { topic_key: string }[] | null;
};

function toPick(r: PickDbRow, carriedFrom: string | null): BoardPick | null {
  const key = one(r.meeting_topics)?.topic_key;
  if (!key) return null;
  return {
    key,
    priority: r.priority,
    later: r.later,
    note: r.note,
    firstAskedOn: r.first_asked_on,
    enteredByPersonId: r.entered_by_person_id,
    carriedFrom
  };
}

export interface EffectivePicks {
  /** The scout has their own list on this board (they or a parent changed something here). */
  hasOwnList: boolean;
  picks: BoardPick[];
}

/**
 * Each scout's picks on this board: their own list if they have one, otherwise what carries from their last board
 * that has one (finished picks dropped by the ledger, "later" cleared). Progress is loaded unless passed in.
 */
export async function loadEffectivePicks(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  scouts: readonly BoardScout[],
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements'>,
  progress?: Map<string, ScoutProgress>
): Promise<Map<number, EffectivePicks>> {
  const out = new Map<number, EffectivePicks>();
  if (!scouts.length) return out;
  const personIds = scouts.map((s) => s.personId);
  const PICK_COLS = 'calendar_entry_id, person_id, priority, later, note, first_asked_on, entered_by_person_id, meeting_topics(topic_key)';

  const [listsRes, ownRes] = await Promise.all([
    sb.from('meeting_pick_lists').select('calendar_entry_id, person_id, calendar_entries!inner(entry_date)').in('person_id', personIds).lte('calendar_entries.entry_date', meeting.date),
    sb.from('meeting_topic_picks').select(PICK_COLS).eq('calendar_entry_id', meeting.entryId).in('person_id', personIds)
  ]);
  if (listsRes.error ?? ownRes.error) throw new Error((listsRes.error ?? ownRes.error)!.message);

  type ListRow = { calendar_entry_id: number; person_id: number; calendar_entries: { entry_date: string } | { entry_date: string }[] | null };
  const own = new Set<number>();
  const lastPrior = new Map<number, { entryId: number; date: string }>();
  for (const l of (listsRes.data ?? []) as unknown as ListRow[]) {
    if (l.calendar_entry_id === meeting.entryId) {
      own.add(l.person_id);
      continue;
    }
    const date = one(l.calendar_entries)?.entry_date;
    if (!date || date > meeting.date) continue;
    const cur = lastPrior.get(l.person_id);
    if (!cur || date > cur.date || (date === cur.date && l.calendar_entry_id > cur.entryId)) {
      lastPrior.set(l.person_id, { entryId: l.calendar_entry_id, date });
    }
  }

  const ownByPerson = new Map<number, BoardPick[]>();
  for (const r of (ownRes.data ?? []) as unknown as PickDbRow[]) {
    const p = toPick(r, null);
    if (p) ownByPerson.set(r.person_id, [...(ownByPerson.get(r.person_id) ?? []), p]);
  }

  const carryFrom = [...lastPrior].filter(([pid]) => !own.has(pid));
  const priorByPerson = new Map<number, BoardPick[]>();
  if (carryFrom.length) {
    const entryIds = [...new Set(carryFrom.map(([, v]) => v.entryId))];
    const { data, error } = await sb.from('meeting_topic_picks').select(PICK_COLS).in('calendar_entry_id', entryIds).in('person_id', carryFrom.map(([pid]) => pid));
    if (error) throw new Error(error.message);
    const want = new Map(carryFrom.map(([pid, v]) => [pid, v.entryId]));
    for (const r of (data ?? []) as unknown as PickDbRow[]) {
      if (want.get(r.person_id) !== r.calendar_entry_id) continue;
      const p = toPick(r, null);
      if (p) priorByPerson.set(r.person_id, [...(priorByPerson.get(r.person_id) ?? []), p]);
    }
  }

  // A freeform pick carries only to a board where a teacher offered it again (the topic has to exist there).
  if ([...priorByPerson.values()].some((list) => list.some((p) => p.key.startsWith('ff:')))) {
    const { data, error } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting.entryId).eq('kind', 'freeform');
    if (error) throw new Error(error.message);
    const here = new Set(((data ?? []) as { topic_key: string }[]).map((t) => t.topic_key));
    for (const [pid, list] of priorByPerson) priorByPerson.set(pid, list.filter((p) => !p.key.startsWith('ff:') || here.has(p.key)));
  }

  const needProgress = scouts.filter((s) => priorByPerson.has(s.personId));
  const prog = progress ?? (needProgress.length ? await loadScoutProgress(sb, needProgress.map((s) => s.scoutId)) : new Map<string, ScoutProgress>());
  const trees = rankTrees(catalog.rankRequirements);

  for (const s of scouts) {
    if (own.has(s.personId)) {
      out.set(s.personId, { hasOwnList: true, picks: ownByPerson.get(s.personId) ?? [] });
      continue;
    }
    const prior = priorByPerson.get(s.personId);
    if (!prior?.length) {
      out.set(s.personId, { hasOwnList: false, picks: [] });
      continue;
    }
    const p = prog.get(s.scoutId) ?? { rankCodes: new Set<string>(), mbProgress: [] };
    const ctx = {
      currentRank: s.currentRank,
      ranks: catalog.ranks,
      trees,
      rankCodes: p.rankCodes,
      awardedMbs: new Set(p.mbProgress.filter((m) => m.awarded).map((m) => m.mb_id))
    };
    out.set(s.personId, { hasOwnList: false, picks: carryForward(prior, lastPrior.get(s.personId)!.date, (key) => isPickFinished(key, ctx)) });
  }
  return out;
}

/** Explicit answers only; implied Coming is the shared effectiveIntent(). */
export async function loadIntents(sb: SupabaseClient, entryId: number, personIds?: readonly number[]): Promise<Map<number, Intent>> {
  let q = sb.from('meeting_intents').select('person_id, intent').eq('calendar_entry_id', entryId);
  if (personIds) {
    if (!personIds.length) return new Map();
    q = q.in('person_id', personIds as number[]);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { person_id: number; intent: Intent }[]).map((r) => [r.person_id, r.intent]));
}

export async function loadPeopleNames(sb: SupabaseClient, ids: readonly number[]): Promise<Map<number, string>> {
  const want = [...new Set(ids)];
  if (!want.length) return new Map();
  const { data, error } = await sb.from('people').select('id, display_name').in('id', want);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
}

export interface BoardScoutRow extends BoardScout {
  intent: Intent | null;
  hasOwnList: boolean;
  picks: BoardPick[];
}

/** Everyone on the board: every active scout with their answer and effective picks. One read path for the member
 *  page's "who else picked" and the admin tab's counts. */
export async function loadBoardState(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements'>
): Promise<BoardScoutRow[]> {
  const scouts = await loadBoardScouts(sb);
  const [picks, intents] = await Promise.all([loadEffectivePicks(sb, meeting, scouts, catalog), loadIntents(sb, meeting.entryId)]);
  return scouts.map((s) => ({
    ...s,
    intent: intents.get(s.personId) ?? null,
    hasOwnList: picks.get(s.personId)?.hasOwnList ?? false,
    picks: picks.get(s.personId)?.picks ?? []
  }));
}

export async function loadBoardStamp(sb: SupabaseClient, entryId: number): Promise<string> {
  const { data, error } = await sb.rpc('meeting_board_stamp', { p_entry: entryId });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

// ── writers (one RPC each; the RPC holds the lock and re-checks who may act) ─────────────────────────────────────────

export interface BoardWriter {
  entryId: number;
  /** The scout whose picks (or the person whose answer) this is. */
  personId: number;
  /** Who is entering it. */
  actorPersonId: number;
  /** A leader entering on someone's behalf; the caller has checked the capability. */
  leader: boolean;
  /** The carried picks, sent only when the scout has no list on this board yet. */
  carry: BoardPick[] | null;
}

export type BoardWriteResult = { ok: true } | { ok: false; error: string };

/** Carried picks as the pick RPCs take them (p_carry). Also used by the invite answer (lib/meeting-invites-db). */
export const carryJson = (carry: BoardPick[] | null) =>
  (carry ?? []).map((p) => ({
    topic_key: p.key,
    first_asked_on: p.firstAskedOn,
    priority: p.priority,
    note: p.note,
    entered_by_person_id: p.enteredByPersonId
  }));
const base = (w: BoardWriter) => ({ p_entry: w.entryId, p_person: w.personId, p_actor: w.actorPersonId, p_leader: w.leader });
const done = (error: { message: string } | null): BoardWriteResult => (error ? { ok: false, error: error.message } : { ok: true });

export async function addMeetingPick(sb: SupabaseClient, w: BoardWriter, key: string, opts: { later: boolean; markComing: boolean }): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_add_pick', { ...base(w), p_topic_key: key, p_later: opts.later, p_mark_coming: opts.markComing, p_carry: carryJson(w.carry) });
  return done(error);
}

export async function removeMeetingPick(sb: SupabaseClient, w: BoardWriter, key: string): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_remove_pick', { ...base(w), p_topic_key: key, p_carry: carryJson(w.carry) });
  return done(error);
}

/** keys null clears the order. */
export async function setMeetingPickOrder(sb: SupabaseClient, w: BoardWriter, keys: string[] | null): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_set_pick_order', { ...base(w), p_keys: keys, p_carry: carryJson(w.carry) });
  return done(error);
}

export async function setMeetingPickNote(sb: SupabaseClient, w: BoardWriter, key: string, note: string): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_set_pick_note', { ...base(w), p_topic_key: key, p_note: note, p_carry: carryJson(w.carry) });
  return done(error);
}

export async function setMeetingIntent(sb: SupabaseClient, w: Omit<BoardWriter, 'carry'>, intent: Intent): Promise<BoardWriteResult> {
  const { error } = await sb.rpc('meeting_set_intent', { ...base({ ...w, carry: null }), p_intent: intent });
  return done(error);
}

export interface ScoutBoard {
  view: ScoutBoardView;
  pickList: PickListView;
  hasOwnList: boolean;
  /** The scout's effective picks as stored or carried (what a first write hands the RPC as p_carry). */
  picks: BoardPick[];
}

/** One scout's side of the board: answer, picks (own or carried) and their ordered pick list. */
export async function loadScoutBoard(
  sb: SupabaseClient,
  meeting: Pick<BoardMeeting, 'entryId' | 'date'>,
  scout: BoardScout,
  catalog: Pick<AdvancementCatalog, 'ranks' | 'rankRequirements' | 'meritBadges'>,
  opts: {
    viewerPersonId: number | null;
    othersByKey?: ReadonlyMap<string, readonly string[]>;
    /** Phase 2: the teacher coming for each key, as scouts see them. */
    teacherByKey?: ReadonlyMap<string, string>;
    /** Phase 2: freeform topics a teacher put on this board. */
    freeform?: readonly { key: string; title: string }[];
  }
): Promise<ScoutBoard> {
  const progress = await loadScoutProgress(sb, [scout.scoutId]);
  const [eff, intents] = await Promise.all([
    loadEffectivePicks(sb, meeting, [scout], catalog, progress),
    loadIntents(sb, meeting.entryId, [scout.personId])
  ]);
  const mine = eff.get(scout.personId) ?? { hasOwnList: false, picks: [] };
  const p = progress.get(scout.scoutId) ?? { rankCodes: new Set<string>(), mbProgress: [] };
  const pickList = buildPickList({
    currentRank: scout.currentRank,
    ranks: catalog.ranks,
    rankReqs: catalog.rankRequirements,
    mbs: catalog.meritBadges,
    mbProgress: p.mbProgress,
    rankCodes: p.rankCodes,
    othersByKey: opts.othersByKey,
    teacherByKey: opts.teacherByKey,
    freeform: opts.freeform
  });
  const names = await loadPeopleNames(sb, mine.picks.map((x) => x.enteredByPersonId).filter((id): id is number => id != null));
  return {
    view: {
      personId: scout.personId,
      intent: intents.get(scout.personId) ?? null,
      picks: trayPicks(mine.picks, {
        view: pickList,
        ranks: catalog.ranks,
        rankReqs: catalog.rankRequirements,
        mbs: catalog.meritBadges,
        names,
        scoutPersonId: scout.personId,
        viewerPersonId: opts.viewerPersonId
      })
    },
    pickList,
    hasOwnList: mine.hasOwnList,
    picks: mine.picks
  };
}

/** For the member page: the board names of the OTHER scouts who picked each key for this meeting (Can't-make-it
 *  scouts and "later" picks left out, as in the counts). */
export function othersByKeyFor(board: readonly BoardScoutRow[], excludePersonId: number): Map<string, string[]> {
  const { demand } = summarizeBoard(board);
  const nameOf = new Map(board.map((s) => [s.personId, boardName(s.name)]));
  return new Map(
    [...demand].map(([key, ids]) => [key, ids.filter((id) => id !== excludePersonId).map((id) => nameOf.get(id) ?? '').filter(Boolean)])
  );
}
