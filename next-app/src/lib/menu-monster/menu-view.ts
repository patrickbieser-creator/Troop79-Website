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
import { MEALS, RESTRICTION_BY_KEY } from './units';
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

/**
 * The foods in a meal that have no price yet, by the recipe that needs each (an item with none is absent).
 * They cost nothing in mealCost() and recipeShares(), so the Plan tab says so beside the figure instead of
 * letting a $0.00 read as free. A food someone is bringing from home is not "unpriced": nobody is buying it.
 */
export function mealUnpriced(menu: Menu, meal: MenuMeal, catalog: Catalog): Record<string, string[]> {
  return Object.fromEntries(Object.entries(mealUnpricedItems(menu, meal, catalog)).map(([rid, items]) => [rid, items.map((i) => i.name)]));
}

/** The same foods as mealUnpriced(), with each item's id: the "No price yet" badge links to that item's Shopping row. */
export function mealUnpricedItems(menu: Menu, meal: MenuMeal, catalog: Catalog): Record<string, { id: string; name: string }[]> {
  const plan = composePlan(menu, meal);
  const out: Record<string, { id: string; name: string }[]> = {};
  for (const l of buildLines(plan, mealCatalog(catalog, meal))) {
    if (l.status !== 'unpriced' || !(l.need > 0)) continue;
    for (const s of l.sources) (out[s.recipe.id] ??= []).push({ id: l.ing.id, name: l.ing.name });
  }
  return out;
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
  const alone = { packageChoice: menu.shopping.packageChoice, qtyOverride: {}, lineSource: menu.shopping.lineSource, brands: composePlan(menu, { id: '', day: 0, slot: 'breakfast', headcount: null, recipeIds: [], recipeEdits: {} }).brands };

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

/** A menu on an outing, as the outing's list names it. */
export interface OutingMenuRef {
  id: string;
  /** "Screaming Eagles", or the menu's name when it names no patrol. */
  label: string;
  menu: Menu;
}

/** A merged line plus how much of it each menu needs (recipe unit, before count units round up). */
export interface OutingLine extends ShoppingLine {
  byMenu: { menuId: string; label: string; amount: number }[];
}

export interface OutingList {
  lines: OutingLine[];
  totals: Totals;
  /** People served, summed over every meal of every menu. */
  plates: number;
  /** What each menu shopping on its own would spend, added up. */
  separately: number;
  /** separately − totals.spent when positive, else 0: what shopping together saves. */
  saving: number;
}

/**
 * One shopping list for an outing (Patrick, 2026-10-03: "the troop shops together, all at once"): every
 * meal of every menu gathered by ingredient, THEN priced once — so two patrols that each need half a gallon
 * of milk buy one gallon. The brands are the union of what the menus chose for the ingredient (each brand
 * once, sharing the need); a line is bought unless every menu that needs it brings it from somewhere else —
 * so when one patrol brings bacon from home and another buys it, the list buys for both (a little over,
 * never short). Counts are what the recipes need: a count a scout changed on one menu's Shopping tab, or a
 * count set on a brand, is that menu's own and is not carried here — and `separately` leaves them out too,
 * so the saving compares like with like.
 */
export function buildOutingList(menus: readonly OutingMenuRef[], catalog: Catalog): OutingList {
  const merged = new Map<string, Need>();
  const byMenu = new Map<string, { menuId: string; label: string; amount: number }[]>();
  const brands: NonNullable<Menu['shopping']['brands']> = {};
  const sources = new Map<string, Set<string>>();
  const notes = new Map<string, string>();
  const packageChoice: Menu['shopping']['packageChoice'] = {};
  let plates = 0;
  let separately = 0;
  for (const ref of menus) {
    const own = new Map<string, number>();
    for (const meal of ref.menu.meals) {
      if (meal.recipeIds.length === 0) continue;
      const plan = composePlan(ref.menu, meal);
      plates += plan.headcount;
      for (const [id, n] of gatherNeeds(plan, mealCatalog(catalog, meal))) {
        const into = merged.get(id) ?? { ing: n.ing, need: 0, sources: [] };
        into.need += n.need;
        into.sources.push(...n.sources);
        merged.set(id, into);
        own.set(id, (own.get(id) ?? 0) + n.need);
      }
    }
    const picks = Object.fromEntries(Object.entries(ref.menu.shopping.brands ?? {}).map(([id, list]) => [id, list.map((x) => ({ ...x, qty: null }))]));
    separately += buildMenuList({ ...ref.menu, shopping: { ...ref.menu.shopping, qtyOverride: {}, brands: picks } }, catalog).totals.spent;
    for (const [id, amount] of own) {
      byMenu.set(id, [...(byMenu.get(id) ?? []), { menuId: ref.id, label: ref.label, amount }]);
      const src = ref.menu.shopping.lineSource[id];
      sources.set(id, (sources.get(id) ?? new Set()).add(src?.source ?? 'default'));
      if (src?.note && !notes.has(id)) notes.set(id, src.note);
      for (const pick of ref.menu.shopping.brands?.[id] ?? []) {
        if (!(brands[id] ?? []).some((x) => x.brandId === pick.brandId)) brands[id] = [...(brands[id] ?? []), { brandId: pick.brandId, qty: null }];
      }
      const chosen = ref.menu.shopping.packageChoice[id];
      if (chosen && !(id in packageChoice)) packageChoice[id] = chosen;
    }
  }
  // One answer per ingredient: the menus agree on a source, or it is bought.
  const lineSource: Menu['shopping']['lineSource'] = {};
  for (const [id, set] of sources) {
    if (set.size !== 1) {
      if (set.has('buy')) lineSource[id] = { source: 'buy', note: '' };
      continue;
    }
    const only = [...set][0];
    if (only === 'buy' || only === 'home' || only === 'pantry') lineSource[id] = { source: only, note: only === 'buy' ? '' : (notes.get(id) ?? '') };
  }
  const lines = priceNeeds(merged, { packageChoice, qtyOverride: {}, lineSource, brands }, catalog).map((l) => ({ ...l, byMenu: byMenu.get(l.ing.id) ?? [] }));
  const totals = totalsOf(lines, { headcount: plates });
  const gap = Math.round((separately - totals.spent) * 100) / 100;
  return { lines, totals, plates, separately, saving: gap > 0 ? gap : 0 };
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
  /** Foods with no price yet, per meal (names, once each); a meal with none is absent. */
  unpricedByMeal: Record<string, string[]>;
  /** The same for the whole menu: what the total leaves out. */
  unpriced: string[];
}

/** The menu's total is the merged list's (shopping once), not the sum of its
 *  meals; byMeal is each meal on its own, as the meal page shows it. */
export function menuCost(menu: Menu, catalog: Catalog): MenuCost {
  const byMeal: Record<string, number> = {};
  const unpricedByMeal: Record<string, string[]> = {};
  for (const meal of menu.meals) {
    byMeal[meal.id] = mealCost(menu, meal, catalog);
    const names = [...new Set(Object.values(mealUnpriced(menu, meal, catalog)).flat())];
    if (names.length > 0) unpricedByMeal[meal.id] = names;
  }
  const list = buildMenuList(menu, catalog);
  return { total: list.totals.spent, perPersonMeal: list.perPersonMeal, byMeal, unpricedByMeal, unpriced: list.totals.unpriced };
}

/**
 * "Check the label" (Patrick + Brad, 2026-10-03): only where it could matter for a diet the menu counts. The
 * ingredient, or one of its brands, is flagged for that diet AND the line does not name priced, known brands
 * (any brand will do, or a chosen brand is new); or the ingredient itself is one no leader has reviewed yet.
 */
export function needsLabelCheck(l: ShoppingLine, restrictions: Record<RestrictionKey, number>, catalog: Pick<Catalog, 'brands'>): boolean {
  const diets = (Object.keys(restrictions) as RestrictionKey[]).filter((k) => (restrictions[k] || 0) > 0);
  if (diets.length === 0 || l.status === 'staple') return false;
  if (l.ing.needsMatch) return true;
  const brands = (catalog.brands ?? []).filter((b) => b.ingredientId === l.ing.id && !b.retiredAt);
  const matters = diets.some((d) => l.ing.avoid.includes(d) || brands.some((b) => b.avoid != null && b.avoid.includes(d)) || brands.some((b) => b.avoid != null && l.ing.avoid.includes(d)));
  if (!matters) return false;
  if (!l.parts || l.parts.length === 0) return brands.length > 0;
  return l.parts.some((x) => x.brand.isNew);
}

/** A shopping line the scout changed from what the plan produced: a count, a source, or (staples) buying it. */
export function lineUpdated(l: ShoppingLine): boolean {
  if (l.overridden) return true;
  if (l.ing.staple) return l.status !== 'staple';
  return l.source !== 'buy';
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

/* ---- Planner progress: the step strip's ticks and the summary rail's "N to fix" ---- */

/** The planner's steps, in the order a patrol works them: gear is packed days before the shopping trip. */
export type StepKey = 'eating' | 'meals' | 'gear' | 'shopping';

/** Where a "to fix" row leads: a step, and optionally the meal (#meal-<id>) or ingredient (?item=<id>) inside it. */
export interface FixTarget {
  step: StepKey;
  mealId?: string;
  ingredientId?: string;
}

export interface FixItem {
  text: string;
  /** How many things the row stands for ("3 meals empty" is 3). */
  count: number;
  target: FixTarget;
  /** Every ingredient / meal behind the row, in the order the row's target is the first. */
  ingredientIds?: string[];
  mealIds?: string[];
}

export interface StepProgress {
  done: boolean;
  fixes: FixItem[];
}

export interface PlanProgress {
  steps: Record<StepKey, StepProgress>;
  headcount: number;
  /** Diets above zero, in the approved order. */
  diets: { key: RestrictionKey; label: string; count: number }[];
  total: number;
  perPersonMeal: number;
  budget: number;
  /** Some meal has a food, so the cost figures mean something. */
  hasCost: boolean;
  /** Things to fix, summed over every step. */
  toFix: number;
  /** Every fix, in step order. */
  fixes: FixItem[];
}

const STEP_ORDER: readonly StepKey[] = ['eating', 'meals', 'gear', 'shopping'];

/**
 * What is left to do on a menu (pure; the same answer for a saved menu or an unsaved draft). Headcount is only
 * ever what was entered by hand — "0 people" is a thing to fix, never something to fill in (Patrick, 2026-10-06).
 * `extras.list` lets a caller that already built the menu's shopping list hand it in instead of building it twice.
 */
export function planProgress(menu: Menu, catalog: Catalog, extras?: { list?: MenuList }): PlanProgress {
  const list = extras?.list ?? buildMenuList(menu, catalog);
  const slotRank = (slot: MealSlot) => MEALS.findIndex((m) => m.key === slot);

  const eating: FixItem[] = [];
  if (!menu.name.trim()) eating.push({ text: 'Name the menu', count: 1, target: { step: 'eating' } });
  if (!(menu.headcount > 0)) eating.push({ text: 'Set how many are eating', count: 1, target: { step: 'eating' } });

  const meals: FixItem[] = [];
  if (menu.meals.length === 0) meals.push({ text: 'Add a meal', count: 1, target: { step: 'meals' } });
  const empty = menu.meals.filter((m) => m.recipeIds.length === 0).sort((a, b) => a.day - b.day || slotRank(a.slot) - slotRank(b.slot));
  if (empty.length > 0) {
    meals.push({ text: `${empty.length} ${empty.length === 1 ? 'meal' : 'meals'} empty`, count: empty.length, target: { step: 'meals', mealId: empty[0].id }, mealIds: empty.map((m) => m.id) });
  }

  const unpriced = list.lines.filter((l) => l.status === 'unpriced' && l.need > 0).map((l) => l.ing.id);
  const shopping: FixItem[] = unpriced.length > 0 ? [{ text: `${unpriced.length} not priced`, count: unpriced.length, target: { step: 'shopping', ingredientId: unpriced[0] }, ingredientIds: unpriced }] : [];

  const steps: Record<StepKey, StepProgress> = {
    eating: { done: eating.length === 0, fixes: eating },
    meals: { done: meals.length === 0, fixes: meals },
    gear: { done: true, fixes: [] },
    shopping: { done: shopping.length === 0, fixes: shopping }
  };
  const fixes = STEP_ORDER.flatMap((k) => steps[k].fixes);
  return {
    steps,
    headcount: menu.headcount,
    diets: DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0).map((k) => ({ key: k, label: RESTRICTION_BY_KEY[k].label, count: menu.restrictions[k] })),
    total: list.totals.spent,
    perPersonMeal: list.perPersonMeal,
    budget: menu.budgetPerPersonMeal,
    hasCost: menu.meals.some((m) => m.recipeIds.length > 0),
    toFix: fixes.reduce((n, f) => n + f.count, 0),
    fixes
  };
}

/** The outing's last day is behind us (a menu with no date is never "over"): What we bought joins the steps. */
export function outingOver(menu: Menu, today: string): boolean {
  if (!menu.startDate) return false;
  return addDays(menu.startDate, Math.max(1, menu.dayCount) - 1) < today;
}
