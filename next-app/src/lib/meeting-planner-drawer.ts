/**
 * The Meeting Planner's person drawer (Plans/Meeting-Planner-II.md P2a; prototypes/meeting-plan-II/README.md "Screen
 * 2", phone/drawer.html): one person's answer and, for a scout, their picks; for an adult (or a Junior Leader), what
 * they're teaching. Server-only: reads with the service-role client; the planner's actions gate.
 *
 * Every rule is v1's: the scout's pick list (buildPickList: their next rank, badges they've started, freeform offers),
 * the 5-pick cap (the RPC), "who may teach this" (assessTeacher), no teaching cap (Decision 7).
 *
 * Options, in order:
 *   - Scout: what's on the board this week (asked for, offered, ready) that's on their pick list, then the rest of
 *     their next rank. Each row says who's teaching it ("teacher: Jenna M") or "no teacher yet".
 *   - Adult: the board's topics they're qualified for first, then the rest of the board. What they're teaching is on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadBoardScouts, loadBoardState, loadScoutBoard, type BoardMeeting } from '@/lib/meeting-board';
import { loadTeachBoard } from '@/lib/meeting-board-supply';
import { assessTeacher, teacherIntent, teacherName } from '@/lib/meeting-board-teach';
import { boardName, effectiveIntent, MAX_PICKS, type Intent } from '@/lib/meeting-board-shared';
import { allRows, nextRankOf, topicWords } from '@/lib/meeting-board-picklist';

export interface DrawerOption {
  key: string;
  title: string;
  /** 'Tenderfoot 4a · teacher: Jenna M', 'Second Class 2f · no teacher yet'. */
  meta: string;
  on: boolean;
  /** 'board': on this week's board; 'more': the rest of the list. */
  section: 'board' | 'more';
}

interface DrawerBase {
  personId: number;
  name: string;
  /** 'Working on Tenderfoot', 'Adult · can teach'. */
  sub: string;
  /** The stored answer (a pick or a commitment also counts as Coming on the board). */
  intent: Intent | null;
  /** What the board shows for them: the stored answer, or Coming from a pick or commitment. */
  shown: Intent | null;
  options: DrawerOption[];
}

export interface ScoutDrawer extends DrawerBase {
  kind: 'scout';
  /** Picks for this meeting (not "later"). */
  picked: number;
  max: number;
}

export interface AdultDrawer extends DrawerBase {
  kind: 'adult';
  teaching: number;
}

export type PersonDrawer = ScoutDrawer | AdultDrawer;

/** The options list: the board first, then the rest; the person's own picks or commitments stay even when off-list. */
export function drawerOptions(input: {
  boardKeys: readonly string[];
  listKeys: readonly string[];
  onKeys: ReadonlySet<string>;
  words: (key: string) => { title: string; codeLabel: string };
  teachers: (key: string) => readonly string[];
  /** Scouts: only keys on their pick list (or already picked) are offered. Adults: undefined (anything on the board). */
  allowed?: ReadonlySet<string>;
  /** Adults: keys they're qualified for, listed first within the board. */
  preferred?: ReadonlySet<string>;
}): DrawerOption[] {
  const seen = new Set<string>();
  const row = (key: string, section: DrawerOption['section']): DrawerOption => {
    const w = input.words(key);
    const t = input.teachers(key);
    return { key, title: w.title, meta: [w.codeLabel, t.length ? `teacher: ${t.join(', ')}` : 'no teacher yet'].filter(Boolean).join(' · '), on: input.onKeys.has(key), section };
  };
  const ok = (key: string) => !input.allowed || input.allowed.has(key) || input.onKeys.has(key);
  const board = [...input.boardKeys, ...[...input.onKeys].filter((k) => !input.boardKeys.includes(k))].filter((k) => ok(k) && !seen.has(k) && seen.add(k));
  const pref = input.preferred;
  if (pref) board.sort((a, b) => Number(!pref.has(a)) - Number(!pref.has(b)));
  const more = input.listKeys.filter((k) => ok(k) && !seen.has(k) && seen.add(k));
  return [...board.map((k) => row(k, 'board')), ...more.map((k) => row(k, 'more'))];
}

/** One person's drawer on this meeting, or null when they're neither an active scout nor someone who may teach. */
export async function loadPersonDrawer(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>, personId: number, viewerPersonId: number | null): Promise<PersonDrawer | null> {
  const catalog = await loadAdvancementCatalog();
  const rows = await loadBoardState(sb, meeting, catalog);
  const teach = await loadTeachBoard(sb, meeting, catalog, rows, 'all');
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));
  const scoutName = new Map(rows.map((r) => [r.personId, boardName(r.name)]));
  const words = (key: string) => {
    const w = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, teach.freeformTitles);
    return { title: w?.label ?? key, codeLabel: w?.codeLabel ?? '' };
  };
  const teachers = (key: string) =>
    (teach.match.teachers.get(key) ?? []).map((t) => {
      const p = teach.people.get(t.personId);
      return p ? teacherName(p, 'admin') : (scoutName.get(t.personId) ?? `Person ${t.personId}`);
    });
  const boardKeys = [...new Set([...teach.demand.keys(), ...teach.match.offered, ...teach.supply.topicTeachers.filter((t) => !teach.supply.notComing.has(t.personId)).map((t) => t.key)])];

  const scoutRow = rows.find((r) => r.personId === personId);
  if (scoutRow) {
    const scout = (await loadBoardScouts(sb, [personId]))[0];
    const sbBoard = await loadScoutBoard(sb, meeting, scout, catalog, { viewerPersonId, freeform: teach.freeform });
    const list = allRows(sbBoard.pickList).filter((r) => !r.outing);
    const next = sbBoard.pickList.groups.find((g) => g.next);
    const picks = sbBoard.picks.filter((p) => !p.later);
    const next2 = nextRankOf(scout.currentRank, catalog.ranks);
    return {
      kind: 'scout',
      personId,
      name: boardName(scout.name),
      sub: next2 ? `Working on ${rankName.get(next2) ?? next2}` : 'Scout',
      intent: scoutRow.intent,
      shown: effectiveIntent(scoutRow.intent, sbBoard.picks),
      picked: picks.length,
      max: MAX_PICKS,
      options: drawerOptions({
        boardKeys,
        listKeys: (next?.rows ?? []).filter((r) => !r.outing).map((r) => r.key),
        onKeys: new Set(picks.map((p) => p.key)),
        allowed: new Set(list.map((r) => r.key)),
        words,
        teachers
      })
    };
  }

  const p = teach.people.get(personId);
  if (!p || p.eligible === false) return null;
  const mine = teach.supply.topicTeachers.filter((t) => t.personId === personId).map((t) => t.key);
  const intent = teach.intents.get(personId) ?? null;
  return {
    kind: 'adult',
    personId,
    name: teacherName(p, 'admin'),
    sub: p.kind === 'junior' ? 'Junior Leader' : p.skills.size || p.counselorFor.size ? 'Adult · can teach' : 'Adult',
    intent,
    shown: teacherIntent(intent, mine.length),
    teaching: mine.length,
    options: drawerOptions({
      boardKeys,
      listKeys: [],
      onKeys: new Set(mine),
      preferred: new Set(boardKeys.filter((k) => assessTeacher(p, k, teach.ctx).qualified)),
      words,
      teachers
    })
  };
}
