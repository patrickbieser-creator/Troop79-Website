/**
 * Planner III Suggestions (prototypes/meeting-plan-III/README.md, "Screen: Suggestions"; restored from Build a Plan's
 * Suggestions mode, B5/B9 of Plans/Completed/Build-A-Plan.md): the engine's payload (lib/meeting-suggest) shaped for the
 * screen's three views and its footers, plus the filters. PURE and client-safe; the page builds it once per engine run
 * (cached), and every view switch, filter and tick after that is client state over it.
 *
 *   Group sessions  one card per requirement two or more scouts need, under its III group (the requirement's rank:
 *                   Scout, Tenderfoot, Second Class, First Class; a merit badge's is the Merit badge group), with the
 *                   scouts as rank-coloured chips, the best teacher and the other qualified ones.
 *   Solo needs      what only one scout needs.
 *   By scout        each scout's next ≤3 requirements (the engine's own pick, merit badges for older scouts); one with
 *                   none says why in words.
 *   Teaching        who can teach what, and the requirements they could take this meeting (best first).
 *   Needs another   items a meeting can't hold, under each class they need (lib/requirement-class); never added.
 *   setting
 *
 * What is "on the plan" depends on the meeting the toolbar is For (PlanState): a topic on that meeting's plan, or a
 * requirement inside its focus sets (This week's groups hold those). Names are the board's ("Dan K").
 */
import type { MeetingPlanPayload, NoSuggestionReason, PlanSession } from '@/lib/meeting-plan-types';
import { boardName } from '@/lib/meeting-board-shared';
import { badgeGroupKey, rankGroupKey } from '@/lib/focus-plan';

export type Lens = 'sessions' | 'scouts' | 'teaching';
export const LENS_LABEL: Record<Lens, string> = { sessions: 'Group sessions', scouts: 'By scout', teaching: 'Teaching' };

/** The III groups, in This week's order: a rank id, or 'mb' for the Merit badge group. */
export const GROUPS: { id: string; label: string }[] = [
  { id: 'scout', label: 'Scout' },
  { id: 'tenderfoot', label: 'Tenderfoot' },
  { id: 'second-class', label: 'Second Class' },
  { id: 'first-class', label: 'First Class' },
  { id: 'mb', label: 'Merit badge' }
];
/** Ranks whose scouts are in the Merit badge group (First Class and up). */
const MB_GROUP_RANKS = new Set(['first-class', 'star', 'life', 'eagle']);

/** A scout as a chip: their name and the rank they hold (its colour). */
export interface SuggestPerson {
  name: string;
  rankId: string | null;
  rankLabel: string;
}

/** Anything Add can put on the plan. */
export interface SuggestItem {
  key: string;
  /** 'Tenderfoot 4a', 'First Aid 2'. */
  codeLabel: string;
  title: string;
  kind: 'rank' | 'mb';
  eagle: boolean;
  /** Its III group: the requirement's rank id, or 'mb'. */
  group: string;
  /** A merit badge requirement's badge (its group slot is 'fr:mb:<id>'); null for a rank requirement. */
  mbId: string | null;
}

export interface SuggestTeacherRef {
  name: string;
  /** 'counselor', 'Star scout'; null for an adult teaching by skill. */
  note: string | null;
}

export interface SuggestCard extends SuggestItem {
  need: number;
  scouts: SuggestPerson[];
  best: SuggestTeacherRef | null;
  others: SuggestTeacherRef[];
  skillName: string | null;
  adultOnly: boolean;
  youthTeachable: boolean;
}

export interface SuggestScout {
  id: string;
  name: string;
  rankId: string | null;
  rankLabel: string;
  patrol: string | null;
  /** The group they work in: their next rank, or 'mb' from First Class up. */
  group: string;
  items: SuggestItem[];
  /** Why a scout with no items has none, worded; null when they have some. */
  reason: string | null;
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
  /** The requirements they could take this meeting, their biggest first. */
  keys: string[];
}

export interface CampoutItem {
  codeLabel: string;
  title: string;
  scouts: string[];
  /** The groups of the scouts who need it (the group filter). */
  groups: string[];
  /** The class tags a meeting lacks: the headings it goes under. */
  classes: string[];
}

/** A Needs another setting heading for items with no class (from before classes). */
export const OTHER_SETTING = { code: '', name: 'Campout or outing' };

export interface SuggestionsData {
  cards: SuggestCard[];
  scouts: SuggestScout[];
  teachers: SuggestTeacher[];
  campout: CampoutItem[];
  /** The headings Needs another setting can show, in class order. */
  settings: { code: string; name: string }[];
}

/** One meeting's plan as the screen reads it: topic keys on it, and the requirements inside its focus sets. Arrays,
 *  so it can travel from the server as JSON. */
export interface PlanState {
  onPlan: string[];
  focus: string[];
}

export interface SuggestFilter {
  /** A GROUPS id, or null for all. */
  group: string | null;
  /** Only requirements in this week's focus. */
  focusOnly: boolean;
  /** Off: items already on the plan are hidden; on (default): shown. */
  showOnPlan: boolean;
}

export const DEFAULT_FILTER: SuggestFilter = { group: null, focusOnly: false, showOnPlan: true };

type RankRow = { id: string; display_name: string; sort_order: number };

/** A teacher key that is a person id gets the board's name; a non-person source (Summer Camp) keeps its own. */
const teacherName = (code: string, name: string) => (/^\d+$/.test(code) ? boardName(name) : name);

/**
 * The payload shaped for every view. `mbOfKey` maps a merit badge requirement's key to its badge ('first-aid-2' →
 * 'first-aid'), for the badge's group slot.
 */
export function suggestionsData(payload: MeetingPlanPayload, rankRows: readonly RankRow[], mbOfKey: Readonly<Record<string, string>> = {}): SuggestionsData {
  const ranks = [...rankRows].sort((a, b) => a.sort_order - b.sort_order);
  const order = new Map(ranks.map((r, i) => [r.id, i]));
  const label = new Map(ranks.map((r) => [r.id, r.display_name]));
  const nextRank = (current: string | null): string | null => {
    if (!current) return ranks[0]?.id ?? null;
    const i = order.get(current);
    return i == null ? null : (ranks[i + 1]?.id ?? null);
  };
  const workingGroup = (current: string | null) => (current && MB_GROUP_RANKS.has(current) ? 'mb' : (nextRank(current) ?? 'mb'));
  const byLength = [...ranks].sort((a, b) => b.id.length - a.id.length);
  const rankOfKey = (key: string) => byLength.find((r) => key.startsWith(`${r.id}-`))?.id ?? null;
  const groupOf = (kind: 'rank' | 'mb', key: string) => (kind === 'mb' ? 'mb' : (rankOfKey(key) ?? 'mb'));
  const mbIdOf = (kind: 'rank' | 'mb', key: string) => (kind === 'mb' ? (mbOfKey[key] ?? null) : null);
  const person = (s: { name: string; rankId: string | null; rankLabel: string }): SuggestPerson => ({ name: boardName(s.name), rankId: s.rankId, rankLabel: s.rankLabel });

  // ── Group sessions: one card per key ──────────────────────────────────────────────────────────────────────
  const ref = (t: PlanSession): SuggestTeacherRef[] => [
    ...t.adultTeachers.map((a) => ({ name: teacherName(a.code, a.name), note: null })),
    ...t.counselors.map((c) => ({ name: teacherName(c.code, c.name), note: 'counselor' })),
    ...t.scoutTeachers.map((s) => ({ name: boardName(s.name), note: `${s.rankLabel} scout` }))
  ];
  const cards = new Map<string, SuggestCard>();
  const sessionKey = new Map<number, { key: string; size: number }>();
  for (const s of payload.sessions) {
    if (!s.key) continue;
    sessionKey.set(s.id, { key: s.key, size: s.scouts.length });
    const have = cards.get(s.key);
    if (have) {
      have.need += s.scouts.length;
      have.scouts.push(...s.scouts.map(person));
      continue;
    }
    const teachers = ref(s);
    cards.set(s.key, {
      key: s.key,
      codeLabel: s.codeLabel,
      title: s.title,
      kind: s.kind,
      eagle: s.eagle,
      group: groupOf(s.kind, s.key),
      mbId: mbIdOf(s.kind, s.key),
      need: s.scouts.length,
      scouts: s.scouts.map(person),
      best: teachers[0] ?? null,
      others: teachers.slice(1),
      skillName: s.skillName,
      adultOnly: s.adultOnly,
      youthTeachable: s.youthTeachable
    });
  }

  // ── By scout ──────────────────────────────────────────────────────────────────────────────────────────────
  const classNames = new Map((payload.requirementClasses ?? []).map((c) => [c.code, c.name]));
  const scouts: SuggestScout[] = payload.byScout.map((row) => {
    const settings = [...new Set(row.needsOuting.flatMap((o) => o.classes ?? []))].map((c) => classNames.get(c) ?? c);
    return {
      id: row.scout.id,
      name: boardName(row.scout.name),
      rankId: row.scout.rankId,
      rankLabel: row.scout.rankLabel,
      patrol: row.scout.patrol,
      group: workingGroup(row.scout.rankId),
      reason: row.suggestions.length ? null : noSuggestionText(row.reason ?? null, row.reasonRankId ? (label.get(row.reasonRankId) ?? row.reasonRankId) : null, settings),
      items: row.suggestions.flatMap((x) => {
        if (!x.key) return [];
        const rankId = x.kind === 'rank' ? rankOfKey(x.key) : null;
        const codeLabel = rankId ? `${label.get(rankId) ?? rankId} ${x.key.slice(rankId.length + 1)}` : x.codeLabel;
        return [{ key: x.key, codeLabel, title: x.label, kind: x.kind, eagle: x.eagle, group: groupOf(x.kind, x.key), mbId: mbIdOf(x.kind, x.key) }];
      })
    };
  });

  // ── Teaching ──────────────────────────────────────────────────────────────────────────────────────────────
  const keysOf = (ids: readonly number[]) => {
    const size = new Map<string, number>();
    for (const id of ids) {
      const k = sessionKey.get(id);
      if (k) size.set(k.key, (size.get(k.key) ?? 0) + k.size);
    }
    return [...size.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  };
  const teachers: SuggestTeacher[] = [
    ...payload.rosterAdults.map((a) => ({ id: `a:${a.code}`, personId: /^\d+$/.test(a.code) ? Number(a.code) : null, name: teacherName(a.code, a.name), meta: a.role, scout: false, skills: a.skills, keys: keysOf(a.sessionIds) })),
    ...payload.rosterScoutInstructors.map((s) => ({ id: `s:${s.id}`, personId: s.personId ?? null, name: boardName(s.name), meta: s.rankLabel, scout: true, skills: s.skills, keys: keysOf(s.sessionIds) }))
  ];

  // ── Needs another setting ─────────────────────────────────────────────────────────────────────────────────
  const campout = new Map<string, CampoutItem>();
  payload.byScout.forEach((row, i) => {
    for (const o of row.needsOuting) {
      const k = `${o.codeLabel}|${o.label}`;
      const have = campout.get(k) ?? { codeLabel: o.codeLabel, title: o.label, scouts: [], groups: [], classes: o.classes ?? [] };
      have.scouts.push(scouts[i].name);
      if (!have.groups.includes(scouts[i].group)) have.groups.push(scouts[i].group);
      campout.set(k, have);
    }
  });

  return {
    cards: [...cards.values()],
    scouts,
    teachers,
    campout: [...campout.values()],
    settings: [...(payload.requirementClasses ?? []), OTHER_SETTING]
  };
}

/** The engine's reason code, worded for By scout. `settings`: the class names of what the scout still needs elsewhere. */
export function noSuggestionText(reason: NoSuggestionReason | null, rankLabel: string | null, settings: readonly string[]): string | null {
  switch (reason) {
    case 'bor-next':
      return rankLabel ? `Ready for the ${rankLabel} board of review` : 'Ready for a board of review';
    case 'no-mb':
      return 'No merit badge in progress or with a counselor';
    case 'smc-waiting':
      return `Nothing to plan: Scoutmaster conference waits for 95% of ${rankLabel ?? 'the rank'}`;
    case 'not-plannable':
      return settings.length ? `Everything left needs another setting: ${settings.join(', ')}` : 'Only time-based or Scout spirit items left';
    case 'finished':
      return 'Nothing left to suggest at a meeting';
    default:
      return null;
  }
}

/** On the meeting's plan: a topic on it, or a requirement in its focus. */
export const onPlanOf = (key: string, plan: PlanState) => plan.onPlan.includes(key) || plan.focus.includes(key);

/** Whether an item shows under the filters. */
export function itemShown(item: Pick<SuggestItem, 'key' | 'group'>, plan: PlanState, f: SuggestFilter): boolean {
  if (f.group != null && item.group !== f.group) return false;
  if (f.focusOnly && !plan.focus.includes(item.key)) return false;
  return f.showOnPlan || !onPlanOf(item.key, plan);
}

/** A scout's items that show under the filters. */
export function scoutItemsShown<T extends Pick<SuggestItem, 'key' | 'group'>>(items: readonly T[], plan: PlanState, f: SuggestFilter): T[] {
  return items.filter((i) => itemShown(i, plan, f));
}

/** By scout: a scout with items shows when any item does; one with none (their reason) shows unless this week's focus
 *  only, or another group, is chosen. */
export function scoutRowShown(sc: Pick<SuggestScout, 'items' | 'group'>, shownItems: number, f: SuggestFilter): boolean {
  if (sc.items.length) return shownItems > 0;
  if (f.focusOnly) return false;
  return f.group == null || sc.group === f.group;
}

/** A teacher's requirement keys that show under the filters. */
export function teacherKeysShown(keys: readonly string[], byKey: ReadonlyMap<string, Pick<SuggestItem, 'key' | 'group'>>, plan: PlanState, f: SuggestFilter): string[] {
  return keys.filter((k) => {
    const item = byKey.get(k);
    return item != null && itemShown(item, plan, f);
  });
}

/** A Needs another setting item shows unless another group is chosen. */
export function campoutShown(item: Pick<CampoutItem, 'groups'>, f: SuggestFilter): boolean {
  return f.group == null || item.groups.includes(f.group);
}

/** The items under one Needs another setting heading (an item with two tags is under both). */
export function settingItems<T extends Pick<CampoutItem, 'classes'>>(items: readonly T[], code: string): T[] {
  return items.filter((i) => (code === OTHER_SETTING.code ? i.classes.length === 0 : i.classes.includes(code)));
}

export const groupLabel = (id: string) => `${GROUPS.find((g) => g.id === id)?.label ?? id} group`;

/** Group sessions: the cards two or more scouts need that pass the filters, under their III group (in This week's
 *  order; a group above First Class after), most-needed first. Empty groups are left out. */
export function sessionGroups(d: Pick<SuggestionsData, 'cards'>, plan: PlanState, f: SuggestFilter): { id: string; label: string; cards: SuggestCard[] }[] {
  const shown = d.cards.filter((c) => c.need >= 2 && itemShown(c, plan, f));
  const ids = [...GROUPS.map((g) => g.id), ...[...new Set(shown.map((c) => c.group))].filter((id) => !GROUPS.some((g) => g.id === id))];
  return ids
    .map((id) => ({ id, label: groupLabel(id), cards: shown.filter((c) => c.group === id).sort((a, b) => b.need - a.need) }))
    .filter((g) => g.cards.length);
}

/** Solo needs: what only one scout needs: a one-scout card, or a scout's selection with no card of two or more. */
export interface SoloNeed {
  item: SuggestItem;
  scout: SuggestPerson;
}

export function soloNeeds(d: Pick<SuggestionsData, 'cards' | 'scouts'>): SoloNeed[] {
  const shared = new Set(d.cards.filter((c) => c.need >= 2).map((c) => c.key));
  const seen = new Set<string>();
  const out: SoloNeed[] = [];
  for (const c of d.cards) {
    if (c.need >= 2 || !c.scouts[0]) continue;
    seen.add(c.key);
    out.push({ item: c, scout: c.scouts[0] });
  }
  for (const sc of d.scouts) {
    for (const item of sc.items) {
      if (shared.has(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
      out.push({ item, scout: { name: sc.name, rankId: sc.rankId, rankLabel: sc.rankLabel } });
    }
  }
  return out;
}

/** Every addable item by key (cards first, so a session's labels win over one scout's). */
export function itemsByKey(d: SuggestionsData): Map<string, SuggestItem> {
  const m = new Map<string, SuggestItem>();
  for (const c of d.cards) m.set(c.key, c);
  for (const s of d.scouts) for (const i of s.items) if (!m.has(i.key)) m.set(i.key, i);
  return m;
}

/**
 * Where a Teaching chip's teacher goes on the meeting: a requirement in the focus is taught in its group's slot
 * (This week's teacher slot); one on the plan as its own class takes its own; one not on the plan is added first.
 */
export function teacherTarget(item: Pick<SuggestItem, 'key' | 'kind' | 'group' | 'mbId'>, plan: PlanState): { key: string; add: boolean } {
  if (plan.focus.includes(item.key)) return { key: item.kind === 'mb' && item.mbId ? badgeGroupKey(item.mbId) : rankGroupKey(item.group), add: false };
  return { key: item.key, add: !plan.onPlan.includes(item.key) };
}

/** The most keys one Add sends (seedMany's batch, as This week's add). */
export const ADD_MAX = 20;

/** "Add N to the plan" sends at most ADD_MAX keys per action, in order. */
export function addChunks<T>(items: readonly T[], size = ADD_MAX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
