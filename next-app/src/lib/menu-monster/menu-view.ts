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

import type { Catalog } from './types';
import { buildLines, totalsOf } from './engine';
import { MAX_MENU_DAYS, addDays, composePlan, type Menu, type MenuMeal } from './menus';
import { fmtDay } from '@/lib/format-date';

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

/** What the register charges for one meal at its own headcount. */
export function mealCost(menu: Menu, meal: MenuMeal, catalog: Catalog): number {
  const plan = composePlan(menu, meal);
  return totalsOf(buildLines(plan, catalog), plan).spent;
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
