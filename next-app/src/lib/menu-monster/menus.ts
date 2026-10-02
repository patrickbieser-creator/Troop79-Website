/**
 * Scout Workspace menus (Plans/Menu-Monster-Scout-Workspace.md, Phase 1).
 *
 * A menu is a verified scout's saved set of meals — days × slots — with one
 * headcount, one set of diet counts and one budget for the whole menu. Each
 * meal is the anonymous planner's Plan minus the people: composePlan() puts
 * the menu's people back in, so every engine function (buildLines, totalsOf,
 * restrictionWarnings) works on a menu meal unchanged.
 *
 * Pure: no DB, no session. sanitizeMenu() is the one gate every write passes
 * through — whatever the client sends is folded onto the planner's own rules
 * (restorePlan per meal, diets clamped to the headcount), so a stored menu
 * can never hold what the planner couldn't.
 */

import type { Catalog, MealSlot, Plan, RestrictionKey } from './types';
import { MEALS, RESTRICTIONS } from './units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT, restorePlan } from './engine';
import { centralToday } from '@/lib/dates';

export type MenuContext = 'home' | 'camp' | 'trail';

export const MENU_CONTEXTS: readonly { key: MenuContext; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'camp', label: 'Camp' },
  { key: 'trail', label: 'Trail' }
];

/** Matches the mm_menus CHECKs (the DB caps the array at 60; the app at 30). */
export const MAX_MENU_MEALS = 30;
export const MAX_MENU_DAYS = 14;
export const MAX_MENU_NAME = 120;
export const DEFAULT_MENU_BUDGET = 4;

/** One meal on a menu: a day index (0 = the menu's first day), a slot, and
 *  the planner's per-meal choices. headcount null = the menu's headcount. */
export interface MenuMeal {
  id: string;
  day: number;
  slot: MealSlot;
  headcount: number | null;
  recipeIds: Plan['recipeIds'];
  packageChoice: Plan['packageChoice'];
  qtyOverride: Plan['qtyOverride'];
  lineSource: Plan['lineSource'];
}

/** What the scout edits; owner, timestamps and the priced snapshot are the server's. */
export interface Menu {
  name: string;
  context: MenuContext;
  calendarEntryId: number | null;
  /** 'YYYY-MM-DD' for day labels when no outing is linked. */
  startDate: string | null;
  headcount: number;
  restrictions: Record<RestrictionKey, number>;
  budgetPerPersonMeal: number;
  meals: MenuMeal[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const clampInt = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Null when the name is fine; otherwise the message the name field shows. */
export function menuNameError(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Give your menu a name so you can find it later.';
  if (t.length > MAX_MENU_NAME) return `Keep the name under ${MAX_MENU_NAME} characters.`;
  return null;
}

/** Diet counts, each clamped to 0..headcount (counts, never names). */
function sanitizeRestrictions(raw: unknown, headcount: number): Record<RestrictionKey, number> {
  const out = {} as Record<RestrictionKey, number>;
  for (const r of RESTRICTIONS) out[r.key] = isRecord(raw) ? clampInt(raw[r.key], 0, headcount, 0) : 0;
  return out;
}

/**
 * Any client payload → a Menu. Never throws. Meals with an unknown slot, a
 * repeated day × slot, or past the cap are dropped; each surviving meal goes
 * through restorePlan(), which drops recipes that don't fit the slot and
 * packages that no longer exist.
 */
export function sanitizeMenu(raw: unknown, catalog: Catalog): Menu {
  const r = isRecord(raw) ? raw : {};
  const headcount = clampInt(r.headcount, MIN_HEADCOUNT, MAX_HEADCOUNT, 8);
  const restrictions = sanitizeRestrictions(r.restrictions, headcount);
  const budget = Number(r.budgetPerPersonMeal);
  const budgetPerPersonMeal = Number.isFinite(budget) && budget >= 0 ? Math.round(budget * 100) / 100 : DEFAULT_MENU_BUDGET;
  const entry = Number(r.calendarEntryId);

  const seen = new Set<string>();
  const meals: MenuMeal[] = [];
  for (const m of Array.isArray(r.meals) ? r.meals : []) {
    if (meals.length >= MAX_MENU_MEALS || !isRecord(m)) continue;
    const slot = MEALS.find((x) => x.key === m.slot)?.key;
    if (!slot) continue;
    const day = clampInt(m.day, 0, MAX_MENU_DAYS - 1, 0);
    if (seen.has(`${day}:${slot}`)) continue;
    seen.add(`${day}:${slot}`);
    const plan = restorePlan({ ...m, meal: slot, headcount, restrictions }, catalog);
    meals.push({
      id: typeof m.id === 'string' && m.id.trim() ? m.id.slice(0, 64) : globalThis.crypto.randomUUID(),
      day,
      slot,
      headcount: m.headcount == null ? null : clampInt(m.headcount, MIN_HEADCOUNT, MAX_HEADCOUNT, headcount),
      recipeIds: plan.recipeIds,
      packageChoice: plan.packageChoice,
      qtyOverride: plan.qtyOverride,
      lineSource: plan.lineSource
    });
  }

  return {
    name: typeof r.name === 'string' ? r.name.trim().slice(0, MAX_MENU_NAME) : '',
    context: MENU_CONTEXTS.find((c) => c.key === r.context)?.key ?? 'camp',
    calendarEntryId: Number.isInteger(entry) && entry > 0 ? entry : null,
    startDate: isDate(r.startDate) ? r.startDate : null,
    headcount,
    restrictions,
    budgetPerPersonMeal,
    meals
  };
}

/** The menu's first day + n, as 'YYYY-MM-DD' (UTC arithmetic on a calendar date). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** One menu meal as the planner's Plan: the menu's people, diets and budget,
 *  the meal's own headcount when it has one. */
export function composePlan(menu: Menu, meal: MenuMeal): Plan {
  return {
    meal: meal.slot,
    headcount: meal.headcount ?? menu.headcount,
    restrictions: { ...menu.restrictions },
    recipeIds: [...meal.recipeIds],
    packageChoice: { ...meal.packageChoice },
    qtyOverride: { ...meal.qtyOverride },
    lineSource: { ...meal.lineSource },
    budgetPerPerson: menu.budgetPerPersonMeal,
    date: addDays(menu.startDate ?? centralToday(), meal.day),
    patrol: ''
  };
}
