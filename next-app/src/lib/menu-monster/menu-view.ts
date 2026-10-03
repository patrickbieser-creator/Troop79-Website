/**
 * Scout Workspace menu — what the Plan tab and My menus SHOW (Plans/
 * Menu-Monster-Scout-Workspace.md, Phase 1 slice 4). Pure: no DB, no session.
 *
 * Costs are derived on every render from the live catalog by the same engine
 * the planner uses — a meal is its composed Plan, so "what the meal costs" is
 * totalsOf(buildLines(plan)).spent and nothing here re-prices anything.
 *
 * The menu-wide shopping list lives here too (buildMenuList): every meal's
 * needs are gathered by the engine, merged by ingredient, and only THEN priced
 * by the engine's own priceNeeds, so two egg meals buy one flat. It sits beside
 * menuCost rather than in engine.ts because it reads menus.ts (composePlan,
 * mealCatalog), which already imports the engine.
 */

import type { Catalog, MealSlot, RestrictionKey, ShoppingLine, Totals } from './types';
import { buildLines, gatherNeeds, priceNeeds, totalsOf, type Need } from './engine';
import { MAX_MENU_DAYS, addDays, composePlan, mealCatalog, type Menu, type MenuMeal } from './menus';
import { MEALS } from './units';
import { fmtDateFull, fmtDay } from '@/lib/format-date';
import { money } from '@/lib/event-money';

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

/** A merged shopping line plus which meals use it (menu order) and how much
 *  each needs, in the ingredient's recipe unit, before count units round up. */
export interface MenuLine extends ShoppingLine {
  usedBy: { mealId: string; amount: number }[];
}

export interface MenuList {
  lines: MenuLine[];
  totals: Totals;
  /** People served, summed over every meal that has items. */
  plates: number;
  /** totals.spent over plates. */
  perPersonMeal: number;
  /** What shopping each meal on its own would cost, under the same package and bring-from-home choices. */
  separately: number;
  /** separately − totals.spent when positive (cents-rounded), else 0. */
  saving: number;
}

/**
 * The menu's shopping list: each meal composed (its own headcount, the menu's
 * diets) with its recipe edits applied, its needs merged by ingredient, then
 * priced once with the menu's package / quantity / bring-from-home choices.
 */
export function buildMenuList(menu: Menu, catalog: Catalog): MenuList {
  const merged = new Map<string, Need>();
  const usedBy = new Map<string, { mealId: string; amount: number }[]>();
  let plates = 0;
  let separately = 0;
  const alone = { packageChoice: menu.shopping.packageChoice, qtyOverride: {}, lineSource: menu.shopping.lineSource };

  for (const meal of menu.meals) {
    if (meal.recipeIds.length === 0) continue;
    const plan = composePlan(menu, meal);
    const needs = gatherNeeds(plan, mealCatalog(catalog, meal));
    plates += plan.headcount;
    separately += totalsOf(priceNeeds(needs, alone, catalog), plan).spent;
    for (const [id, n] of needs) {
      const into = merged.get(id) ?? { ing: n.ing, need: 0, sources: [] };
      into.need += n.need;
      into.sources.push(...n.sources);
      merged.set(id, into);
      usedBy.set(id, [...(usedBy.get(id) ?? []), { mealId: meal.id, amount: n.need }]);
    }
  }

  const lines = priceNeeds(merged, menu.shopping, catalog).map((l) => ({ ...l, usedBy: usedBy.get(l.ing.id) ?? [] }));
  const totals = totalsOf(lines, { headcount: plates });
  const gap = Math.round((separately - totals.spent) * 100) / 100;
  return { lines, totals, plates, perPersonMeal: plates > 0 ? totals.spent / plates : 0, separately, saving: gap > 0 ? gap : 0 };
}

/**
 * The Shopping tab's Spent / Used / Leftover panel (the old planner's totals,
 * for the whole menu): the merged list's totals, each also per person over the
 * plates served. Nothing is re-priced here.
 */
export interface ShoppingPanel {
  plates: number;
  spent: number;
  used: number;
  left: number;
  perSpent: number;
  perUsed: number;
  perLeft: number;
  /** Sublines the old panel carried: staples, bring-from-home, unpriced, short. */
  notes: string[];
}

export function shoppingPanel(list: MenuList): ShoppingPanel {
  const { totals: t, plates } = list;
  const per = (n: number) => (plates > 0 ? n / plates : 0);
  const notes: string[] = [];
  if (t.stapleUsed > 0) notes.push(`Plus about ${money(t.stapleUsed)} of patrol-box staples (in Used, not bought).`);
  if (t.bring.length) notes.push(`Bringing, not buying: ${t.bring.join(', ')} (about ${money(t.bringUsed)} in Used, not Spent).`);
  if (t.unpriced.length) notes.push(`Not in the totals: ${t.unpriced.join(', ')} (no price yet).`);
  if (t.short.length) notes.push(`⚠ Short on ${t.short.join(', ')} — fix before printing.`);
  return { plates, spent: t.spent, used: t.used, left: t.left, perSpent: per(t.spent), perUsed: per(t.used), perLeft: per(t.left), notes };
}

export interface MenuCost {
  total: number;
  /** Total over every plate served — people summed across meals that have items. */
  perPersonMeal: number;
  byMeal: Record<string, number>;
}

/** The menu's total is the merged list's (shopping once), not the sum of its
 *  meals; byMeal is each meal on its own, as the meal page shows it. */
export function menuCost(menu: Menu, catalog: Catalog): MenuCost {
  const byMeal: Record<string, number> = {};
  for (const meal of menu.meals) byMeal[meal.id] = mealCost(menu, meal, catalog);
  const list = buildMenuList(menu, catalog);
  return { total: list.totals.spent, perPersonMeal: list.perPersonMeal, byMeal };
}

/* ---- Budget readout: never colour-only (icon + sentence + role=status) ---- */

const EPS = 1e-9;

export type BudgetState = { tone: 'ok' | 'near' | 'over'; icon: string; msg: string };

export function budgetState(t: Pick<Totals, 'perSpent'>, budget: number): BudgetState {
  if (t.perSpent <= budget + EPS) {
    return { tone: 'ok', icon: '✓', msg: `Under budget by ${money(budget - t.perSpent)} per person` };
  }
  if (t.perSpent <= budget * 1.1) {
    return { tone: 'near', icon: '!', msg: `Close: ${money(t.perSpent - budget)} per person over the target` };
  }
  return { tone: 'over', icon: '✗', msg: `Over budget by ${money(t.perSpent - budget)} per person` };
}
