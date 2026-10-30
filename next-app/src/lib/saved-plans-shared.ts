/**
 * Saved meeting plans (Patrick, 2026-10-29), client-safe: the shape of a saved plan's criteria, a name's rules, and the
 * load list's search, merit badge filter, date sort and words. A saved plan is CRITERIA only: the focus sets (each with
 * its set id, title and items, so a focus edited for one meeting, or whose set was deleted, still comes back), the
 * requirements a planner added on top, and the night's merit badges. Never scouts, teachers, roles or answers.
 */

export interface SavedCriteria {
  focus: { setId: number | null; title: string; items: string[] }[];
  /** Planner-added requirements (seeded singles), as board keys. */
  singles: string[];
  /** The night's merit badges added directly (meeting_night_badges). */
  badges: string[];
}

export interface SavedPlan {
  id: number;
  name: string;
  /** 'YYYY-MM-DD'. */
  planDate: string;
  criteria: SavedCriteria;
  updatedAt: string;
  createdBy: string | null;
}

export const SAVED_PLAN_NAME_MAX = 80;

/** A plan's name, tidied, or null when blank or too long. */
export function cleanPlanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  return name && name.length <= SAVED_PLAN_NAME_MAX ? name : null;
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** The merit badges a plan includes: its night badges and any badge a requirement key belongs to (the longest id). */
export function planBadges(c: SavedCriteria, badgeIds: readonly string[]): string[] {
  const byLength = [...badgeIds].sort((a, b) => b.length - a.length);
  const out = new Set(c.badges);
  for (const key of [...c.singles, ...c.focus.flatMap((f) => f.items)]) {
    const id = byLength.find((b) => key.startsWith(`${b}-`));
    if (id) out.add(id);
  }
  return [...out];
}

export interface PlanFilter {
  q: string;
  mbId: string | null;
  sort: 'newest' | 'oldest';
}

/** The load list: matching names, then the badge filter, sorted by the plan's date. */
export function filterPlans(plans: readonly SavedPlan[], f: PlanFilter, badgeIds: readonly string[]): SavedPlan[] {
  const term = f.q.trim().toLowerCase();
  return plans
    .filter((p) => (!term || p.name.toLowerCase().includes(term)) && (!f.mbId || planBadges(p.criteria, badgeIds).includes(f.mbId)))
    .sort((a, b) => (f.sort === 'newest' ? b.planDate.localeCompare(a.planDate) : a.planDate.localeCompare(b.planDate)) || a.name.localeCompare(b.name));
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** '1 focus set · 2 merit badges · 1 added requirement'. */
export function planSummary(c: SavedCriteria): string {
  const bits = [c.focus.length ? count(c.focus.length, 'focus set') : '', c.badges.length ? count(c.badges.length, 'merit badge') : '', c.singles.length ? count(c.singles.length, 'added requirement') : ''].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Nothing saved';
}

/** What loading `saved` would take off the meeting, in words: focus sets, directly added badges, planner-added classes. */
export function removedByLoad(
  current: {
    focus: readonly { key: string; setId: number | null; name: string }[];
    badges: readonly { mbId: string; name: string; direct: boolean }[];
    extras: readonly { key: string; title: string; origin: string }[];
  },
  saved: SavedCriteria
): string[] {
  const keepSets = new Set(saved.focus.map((f) => f.setId).filter((x): x is number => x != null));
  const keepBadges = new Set(saved.badges);
  const keepSingles = new Set(saved.singles);
  return [
    ...current.focus.filter((f) => f.setId == null || !keepSets.has(f.setId)).map((f) => f.name),
    ...current.badges.filter((b) => b.direct && !keepBadges.has(b.mbId)).map((b) => `${b.name} merit badge`),
    ...current.extras.filter((x) => x.origin === 'planner' && !keepSingles.has(x.key)).map((x) => x.title)
  ];
}
