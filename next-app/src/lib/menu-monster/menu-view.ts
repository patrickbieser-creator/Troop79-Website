/**
 * Scout Workspace menu — what the Plan tab and My menus SHOW (Plans/
 * Menu-Monster-Scout-Workspace.md, Phase 1 slice 4). Pure: no DB, no session.
 *
 * Costs are derived on every render from the live catalog by the same engine
 * the planner uses — a meal is its composed Plan, so "what the meal costs" is
 * totalsOf(buildLines(plan)).spent and nothing here re-prices anything. The
 * menu-wide merged list (two egg meals buy one flat) is slice 5; until then
 * the menu total is the sum of its meals.
 */

import type { Catalog, MealSlot, RestrictionKey } from './types';
import { buildLines, totalsOf } from './engine';
import { MAX_MENU_DAYS, addDays, composePlan, mealCatalog, type Menu, type MenuMeal } from './menus';
import { MEALS } from './units';
import { fmtDateFull, fmtDay } from '@/lib/format-date';

/** A calendar entry a menu can be linked to. endDate is never null: a
 *  single-day entry reports its own date. */
export interface Outing {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  category: string;
}

/** Days an outing spans, both ends counted, capped at what a menu can hold. */
export function outingDayCount(o: Outing): number {
  const ms = Date.parse(`${o.endDate}T00:00:00Z`) - Date.parse(`${o.startDate}T00:00:00Z`);
  const n = Math.round(ms / 86_400_000) + 1;
  return Number.isFinite(n) ? Math.min(MAX_MENU_DAYS, Math.max(1, n)) : 1;
}

/** 'Day 2 · Sun, Oct 11' once the menu has a first date, else 'Day 2'. */
export function dayLabel(startDate: string | null, day: number): string {
  const n = `Day ${day + 1}`;
  return startDate ? `${n} · ${fmtDay(addDays(startDate, day))}` : n;
}

/** The four diets in the order Patrick approved for every dialer line and note. */
export const DIET_ORDER: readonly RestrictionKey[] = ['gf', 'veg', 'nut', 'dairy'];

/** 'Saturday breakfast' once the menu has a first date, else 'Day 2 breakfast'. */
export function mealTitle(startDate: string | null, day: number, slot: MealSlot): string {
  const slotName = (MEALS.find((m) => m.key === slot)?.label ?? slot).toLowerCase();
  const lead = startDate ? fmtDateFull(addDays(startDate, day)).split(',')[0] : `Day ${day + 1}`;
  return `${lead} ${slotName}`;
}

/** What the register charges for one meal at its own headcount, with the meal's recipe edits applied. */
export function mealCost(menu: Menu, meal: MenuMeal, catalog: Catalog): number {
  const plan = composePlan(menu, meal);
  return totalsOf(buildLines(plan, mealCatalog(catalog, meal)), plan).spent;
}

/**
 * Each recipe's share of the meal's cost: every priced line's spend split by
 * how much of it each recipe uses. Shared packages (two recipes, one carton of
 * eggs) are split, never counted twice, so the shares add up to mealCost().
 * Same exclusions as totalsOf: staples, bring-from-home and unpriced lines
 * cost nothing here.
 */
export function recipeShares(menu: Menu, meal: MenuMeal, catalog: Catalog): Record<string, number> {
  const plan = composePlan(menu, meal);
  const shares: Record<string, number> = Object.fromEntries(meal.recipeIds.map((id) => [id, 0]));
  for (const l of buildLines(plan, mealCatalog(catalog, meal))) {
    if (l.status === 'staple' || l.status === 'bring' || l.status === 'unpriced' || !(l.need > 0)) continue;
    for (const s of l.sources) shares[s.recipe.id] = (shares[s.recipe.id] ?? 0) + (l.spent * s.amount) / l.need;
  }
  return shares;
}

export interface MenuCost {
  total: number;
  /** Total over every plate served — people summed across meals that have items. */
  perPersonMeal: number;
  byMeal: Record<string, number>;
}

export function menuCost(menu: Menu, catalog: Catalog): MenuCost {
  const byMeal: Record<string, number> = {};
  let total = 0;
  let plates = 0;
  for (const meal of menu.meals) {
    const cost = mealCost(menu, meal, catalog);
    byMeal[meal.id] = cost;
    if (meal.recipeIds.length === 0) continue;
    total += cost;
    plates += meal.headcount ?? menu.headcount;
  }
  return { total, perPersonMeal: plates > 0 ? total / plates : 0, byMeal };
}
