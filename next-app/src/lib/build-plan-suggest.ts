/**
 * Build a Plan B5, Suggestions mode (Plans/Build-A-Plan.md): the engine's payload (lib/meeting-suggest) shaped for the
 * mode's three lenses and its campout footer, plus the filters. PURE and client-safe; the page builds it once per
 * engine run (cached), and every lens switch, filter and tick after that is client state over it.
 *
 *   Group Sessions  one card per board key (a cohort split by patrol is one card with its groups), with the scouts by
 *                   name, how many need it, the best teacher and the other qualified ones.
 *   By Scout        each scout's next ≤3 requirements (the engine's own pick, merit badges included for older scouts).
 *   Teaching        the teaching roster: who can teach what, and the sessions they could take this meeting (best first).
 *   Needs another  items a meeting doesn't hold, under each class they need (Campout, Aquatics, Expert visit…;
 *   setting        lib/requirement-class), with the scouts who need them; never added from here. (Data name: campout.)
 *
 * A plan item is a topic key, so an item is either on the plan or not: one scout's requirement whose key is already
 * a session's just reads On plan. Names are the board's ("Dan K").
 */
import type { MeetingPlanPayload, NoSuggestionReason, PlanSession } from '@/lib/meeting-plan-types';
import { boardName } from '@/lib/meeting-board-shared';

export type Lens = 'sessions' | 'scouts' | 'teaching';
export const LENS_LABEL: Record<Lens, string> = { sessions: 'Group Sessions', scouts: 'By Scout', teaching: 'Teaching' };

/** Anything Add can put on the plan: its key, its labels, and the ranks it is for (the rank filter). */
export interface SuggestItem {
  key: string;
  /** 'Tenderfoot 4a', 'First Aid 2'. */
  codeLabel: string;
  title: string;
  kind: 'rank' | 'mb';
  eagle: boolean;
  /** The rank a rank requirement belongs to; for a merit badge, the ranks its scouts are working toward. */
  ranks: string[];
}

export interface SuggestTeacherRef {
  name: string;
  /** 'counselor', 'Star scout'; null for an adult teaching by skill. */
  note: string | null;
}

export interface SuggestCard extends SuggestItem {
  /** The requirement's rank; null for a merit badge. */
  rankId: string | null;
  need: number;
  /** One group, or the patrol split (A, B…) when more than 8 need it. */
  groups: { part: string | null; scouts: string[] }[];
  best: SuggestTeacherRef | null;
  others: SuggestTeacherRef[];
  skillName: string | null;
  adultOnly: boolean;
  youthTeachable: boolean;
}

export interface SuggestScout {
  id: string;
  name: string;
  patrol: string | null;
  rankLabel: string;
  nextRankId: string | null;
  items: SuggestItem[];
  /** B9: why a scout with no items has none, worded (noSuggestionText); null when they have some. */
  reason?: string | null;
}

export interface SuggestTeacher {
  id: string;
  /** The person a Teaching chip sets as teacher; null for a non-person source (Summer Camp), which gets no control. */
  personId: number | null;
  name: string;
  /** An adult's role ('ASM'), a scout's rank. */
  meta: string | null;
  scout: boolean;
  skills: string[];
  /** The sessions they could take this meeting, their biggest first. */
  keys: string[];
}

export interface CampoutItem {
  codeLabel: string;
  title: string;
  scouts: string[];
  ranks: string[];
  /** The class tags a meeting lacks: the headings it goes under. Empty on a snapshot from before classes. */
  classes: string[];
}

/** A Needs another setting heading: a class code and name, or OTHER_SETTING for items from before classes. */
export const OTHER_SETTING = { code: '', name: 'Campout or outing' };

export interface SuggestionsData {
  /** The ranks in play, in rank order (the rank filter's choices). */
  ranks: { id: string; label: string }[];
  cards: SuggestCard[];
  scouts: SuggestScout[];
  teachers: SuggestTeacher[];
  campout: CampoutItem[];
  /** The headings Needs another setting can show, in class order. */
  settings: { code: string; name: string }[];
}

export interface SuggestFilter {
  rank: string | null;
  mbOnly: boolean;
  /** Off: items already on the plan are hidden; on (default): shown, dimmed. */
  showOnPlan: boolean;
}

export const DEFAULT_FILTER: SuggestFilter = { rank: null, mbOnly: false, showOnPlan: true };

type RankRow = { id: string; display_name: string; sort_order: number };

/** A teacher key that is a person id gets the board's name; a non-person source (Summer Camp) keeps its own. */
const teacherName = (code: string, name: string) => (/^\d+$/.test(code) ? boardName(name) : name);

export function suggestionsData(payload: MeetingPlanPayload, rankRows: readonly RankRow[]): SuggestionsData {
  const ranks = [...rankRows].sort((a, b) => a.sort_order - b.sort_order);
  const order = new Map(ranks.map((r, i) => [r.id, i]));
  const label = new Map(ranks.map((r) => [r.id, r.display_name]));
  const nextRank = (current: string | null): string | null => {
    if (!current) return ranks[0]?.id ?? null;
    const i = order.get(current);
    return i == null ? null : (ranks[i + 1]?.id ?? null);
  };
  const byLength = [...ranks].sort((a, b) => b.id.length - a.id.length);
  const rankOfKey = (key: string) => byLength.find((r) => key.startsWith(`${r.id}-`))?.id ?? null;
  const inOrder = (ids: Iterable<string | null>) => [...new Set([...ids].filter((x): x is string => x != null))].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));

  // ── Group Sessions: one card per key ──────────────────────────────────────────────────────────────────────
  const ref = (t: PlanSession): SuggestTeacherRef[] => [
    ...t.adultTeachers.map((a) => ({ name: teacherName(a.code, a.name), note: null })),
    ...t.counselors.map((c) => ({ name: teacherName(c.code, c.name), note: 'counselor' })),
    ...t.scoutTeachers.map((s) => ({ name: boardName(s.name), note: `${s.rankLabel} scout` }))
  ];
  const cards = new Map<string, SuggestCard & { scoutRanks: (string | null)[] }>();
  const sessionKey = new Map<number, { key: string; size: number }>();
  for (const s of payload.sessions) {
    if (!s.key) continue;
    sessionKey.set(s.id, { key: s.key, size: s.scouts.length });
    const names = s.scouts.map((x) => boardName(x.name));
    const have = cards.get(s.key);
    if (have) {
      have.need += s.scouts.length;
      have.groups.push({ part: s.groupPart, scouts: names });
      have.scoutRanks.push(...s.scouts.map((x) => nextRank(x.rankId)));
      continue;
    }
    const teachers = ref(s);
    const rankId = s.kind === 'rank' ? rankOfKey(s.key) : null;
    cards.set(s.key, {
      key: s.key,
      codeLabel: s.codeLabel,
      title: s.title,
      kind: s.kind,
      eagle: s.eagle,
      ranks: [],
      rankId,
      need: s.scouts.length,
      groups: [{ part: s.groupPart, scouts: names }],
      best: teachers[0] ?? null,
      others: teachers.slice(1),
      skillName: s.skillName,
      adultOnly: s.adultOnly,
      youthTeachable: s.youthTeachable,
      scoutRanks: s.scouts.map((x) => nextRank(x.rankId))
    });
  }
  const cardList: SuggestCard[] = [...cards.values()].map(({ scoutRanks, ...c }) => ({ ...c, ranks: c.rankId ? [c.rankId] : inOrder(scoutRanks) }));

  // ── By Scout ──────────────────────────────────────────────────────────────────────────────────────────────
  const scouts: SuggestScout[] = payload.byScout.map((row) => {
    const next = nextRank(row.scout.rankId);
    return {
      id: row.scout.id,
      name: boardName(row.scout.name),
      patrol: row.scout.patrol,
      rankLabel: row.scout.rankLabel,
      nextRankId: next,
      reason: row.suggestions.length ? null : noSuggestionText(row.reason ?? null, row.reasonRankId ? (label.get(row.reasonRankId) ?? row.reasonRankId) : null),
      items: row.suggestions.flatMap((x) => {
        if (!x.key) return [];
        const rankId = x.kind === 'rank' ? rankOfKey(x.key) : null;
        const codeLabel = rankId ? `${label.get(rankId) ?? rankId} ${x.key.slice(rankId.length + 1)}` : x.codeLabel;
        return [{ key: x.key, codeLabel, title: x.label, kind: x.kind, eagle: x.eagle, ranks: rankId ? [rankId] : inOrder([next]) }];
      })
    };
  });

  // ── Teaching ──────────────────────────────────────────────────────────────────────────────────────────────
  const keysOf = (ids: readonly number[]) => {
    const all = ids.flatMap((id) => {
      const k = sessionKey.get(id);
      return k ? [k] : [];
    });
    const size = new Map<string, number>();
    for (const k of all) size.set(k.key, (size.get(k.key) ?? 0) + k.size);
    return [...size.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  };
  const teachers: SuggestTeacher[] = [
    ...payload.rosterAdults.map((a) => ({ id: `a:${a.code}`, personId: /^\d+$/.test(a.code) ? Number(a.code) : null, name: teacherName(a.code, a.name), meta: a.role, scout: false, skills: a.skills, keys: keysOf(a.sessionIds) })),
    ...payload.rosterScoutInstructors.map((s) => ({ id: `s:${s.id}`, personId: s.personId ?? null, name: boardName(s.name), meta: s.rankLabel, scout: true, skills: s.skills, keys: keysOf(s.sessionIds) }))
  ];

  // ── Needs another setting ─────────────────────────────────────────────────────────────────────────────────
  const campout = new Map<string, CampoutItem & { scoutRanks: (string | null)[] }>();
  for (const s of scouts) {
    const row = payload.byScout.find((r) => r.scout.id === s.id);
    for (const o of row?.needsOuting ?? []) {
      const k = `${o.codeLabel}|${o.label}`;
      const have = campout.get(k) ?? { codeLabel: o.codeLabel, title: o.label, scouts: [], ranks: [], scoutRanks: [], classes: o.classes ?? [] };
      have.scouts.push(s.name);
      have.scoutRanks.push(s.nextRankId);
      campout.set(k, have);
    }
  }
  const campoutList = [...campout.values()].map(({ scoutRanks, ...c }) => ({ ...c, ranks: inOrder(scoutRanks) }));

  const inPlay = inOrder([...cardList.flatMap((c) => c.ranks), ...scouts.map((s) => s.nextRankId), ...campoutList.flatMap((c) => c.ranks)]);
  return {
    ranks: inPlay.map((id) => ({ id, label: label.get(id) ?? id })),
    cards: cardList,
    scouts,
    teachers,
    campout: campoutList,
    settings: [...(payload.requirementClasses ?? []), OTHER_SETTING]
  };
}

/**
 * B9: the engine's reason code as the By Scout lens words it. A snapshot from before B9 (no code) says nothing.
 */
export function noSuggestionText(reason: NoSuggestionReason | null, rankLabel: string | null): string | null {
  switch (reason) {
    case 'bor-next':
      return rankLabel ? `Ready for the ${rankLabel} board of review` : 'Ready for a board of review';
    case 'no-mb':
      return 'No merit badge in progress';
    case 'smc-waiting':
      return `Nothing to plan: Scoutmaster conference waits for 95% of ${rankLabel ?? 'the rank'}`;
    case 'not-plannable':
      return 'Only time-based, Scout spirit or other-setting items left';
    case 'finished':
      return 'Finished everything plannable';
    default:
      return null;
  }
}

/**
 * B9, By Scout: whether a scout's row shows under the filters. A scout with items shows when any item does; one with
 * none (their reason line) shows unless merit badges only, or another next rank, is chosen.
 */
export function scoutRowShown(sc: Pick<SuggestScout, 'items' | 'nextRankId'>, shownItems: number, f: SuggestFilter): boolean {
  if (sc.items.length) return shownItems > 0;
  if (f.mbOnly) return false;
  return f.rank == null || sc.nextRankId === f.rank;
}

/** B9, Group Sessions' "Solo needs": a requirement only one scout needs (it never made a session of two). */
export interface SoloNeed {
  item: SuggestItem;
  scout: string;
}

/** Every scout's selection whose key has no session card, in the order By Scout lists them. */
export function soloNeeds(d: Pick<SuggestionsData, 'cards' | 'scouts'>): SoloNeed[] {
  const carded = new Set(d.cards.map((c) => c.key));
  const seen = new Set<string>();
  const out: SoloNeed[] = [];
  for (const sc of d.scouts) {
    for (const item of sc.items) {
      if (carded.has(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
      out.push({ item, scout: sc.name });
    }
  }
  return out;
}

/** Whether a card (or any item) shows under the filters. */
export function cardShown(item: Pick<SuggestItem, 'kind' | 'ranks'>, onPlan: boolean, f: SuggestFilter): boolean {
  if (onPlan && !f.showOnPlan) return false;
  if (f.mbOnly && item.kind !== 'mb') return false;
  return f.rank == null || item.ranks.includes(f.rank);
}

/** A scout's items that show under the filters. */
export function scoutItemsShown<T extends Pick<SuggestItem, 'key' | 'kind' | 'ranks'>>(items: readonly T[], onPlan: ReadonlySet<string>, f: SuggestFilter): T[] {
  return items.filter((i) => cardShown(i, onPlan.has(i.key), f));
}

/** A teacher's session keys that show under the filters (each key's kind and ranks from its card). */
export function teacherKeysShown(keys: readonly string[], byKey: ReadonlyMap<string, Pick<SuggestItem, 'kind' | 'ranks'>>, onPlan: ReadonlySet<string>, f: SuggestFilter): string[] {
  return keys.filter((k) => {
    const item = byKey.get(k);
    return item != null && cardShown(item, onPlan.has(k), f);
  });
}

/** The items under one Needs another setting heading (an item with two tags is under both). */
export function settingItems<T extends Pick<CampoutItem, 'classes'>>(items: readonly T[], code: string): T[] {
  return items.filter((i) => (code === OTHER_SETTING.code ? i.classes.length === 0 : i.classes.includes(code)));
}

/** A campout item shows unless merit badges only, or another rank, is chosen. */
export function campoutShown(item: Pick<CampoutItem, 'ranks'>, f: SuggestFilter): boolean {
  if (f.mbOnly) return false;
  return f.rank == null || item.ranks.includes(f.rank);
}

/** The most keys one Add action carries (meeting_seed_many's own cap). */
export const ADD_MAX = 20;

/** "Add N to the plan" sends at most ADD_MAX keys per action, in order. */
export function addChunks<T>(items: readonly T[], size = ADD_MAX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every addable item by key (cards first, so a session's labels win over one scout's). */
export function itemsByKey(d: SuggestionsData): Map<string, SuggestItem> {
  const m = new Map<string, SuggestItem>();
  for (const c of d.cards) m.set(c.key, c);
  for (const s of d.scouts) for (const i of s.items) if (!m.has(i.key)) m.set(i.key, i);
  return m;
}
