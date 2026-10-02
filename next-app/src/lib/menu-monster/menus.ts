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

import type { Catalog, MealSlot, Plan, Recipe, RecipeLine, RestrictionKey } from './types';
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
/** A new menu starts with two days. */
export const DEFAULT_MENU_DAYS = 2;

/**
 * A menu-local change to one recipe on one meal (Phase 2 writes them; Phase 1
 * only reserves and applies them). They mirror mm_variation_lines' diff ops and
 * target a recipe line by its ingredient. Quantities are per person, in the
 * ingredient's own recipe unit for swap / add, and in the line's own unit for
 * amount. The shared recipe is never touched.
 */
export type EditOp =
  | { op: 'amount'; ingredientId: string; qtyPerPerson: number }
  | { op: 'swap'; ingredientId: string; to: string; qtyPerPerson: number }
  | { op: 'leave_out'; ingredientId: string }
  | { op: 'add'; ingredientId: string; qtyPerPerson: number };

/** recipeId → that recipe's ops on this meal. Stored inside meals jsonb. */
export type RecipeEdits = Record<string, EditOp[]>;

/**
 * How the menu-wide shopping list is bought (slice 5): the package picked in
 * place of the recommendation, a hand-typed quantity, and what the troop
 * brings instead of buying. One set for the whole menu — the list merges every
 * meal's needs, so a choice about eggs is about ALL the eggs. Same shapes (and
 * the same engine rules) as the planner's Plan fields.
 */
export interface MenuShopping {
  packageChoice: Plan['packageChoice'];
  qtyOverride: Plan['qtyOverride'];
  lineSource: Plan['lineSource'];
}

export const emptyShopping = (): MenuShopping => ({ packageChoice: {}, qtyOverride: {}, lineSource: {} });

/** One meal on a menu: a day index (0 = the menu's first day), a slot, and
 *  the recipes on the plate. headcount null = the menu's headcount. */
export interface MenuMeal {
  id: string;
  day: number;
  slot: MealSlot;
  headcount: number | null;
  recipeIds: Plan['recipeIds'];
  /** Menu-local recipe changes; {} until Phase 2's editing UI writes some. */
  recipeEdits: RecipeEdits;
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
  /** Days the menu spans (1..MAX_MENU_DAYS); never fewer than the last meal's day + 1. */
  dayCount: number;
  /** Package / quantity / bring-from-home choices for the merged shopping list. */
  shopping: MenuShopping;
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

/** A day count covering every meal: clamped to 1..MAX_MENU_DAYS, never below last meal's day + 1. */
export function coverDays(dayCount: unknown, meals: readonly { day: number }[]): number {
  const lastDay = meals.reduce((m, x) => Math.max(m, x.day), -1);
  return Math.min(MAX_MENU_DAYS, Math.max(clampInt(dayCount, 1, MAX_MENU_DAYS, DEFAULT_MENU_DAYS), lastDay + 1));
}

/** Diet counts, each clamped to 0..headcount (counts, never names). */
function sanitizeRestrictions(raw: unknown, headcount: number): Record<RestrictionKey, number> {
  const out = {} as Record<RestrictionKey, number>;
  for (const r of RESTRICTIONS) out[r.key] = isRecord(raw) ? clampInt(raw[r.key], 0, headcount, 0) : 0;
  return out;
}

/** Safety cap per recipe; dedupe by ingredient already keeps real lists far below it. */
export const MAX_EDIT_OPS = 60;
const MAX_EDIT_QTY = 1000;

/**
 * Client recipeEdits → ops that are safe to apply: only recipes that are on the
 * meal, only ingredients the catalog knows, only quantities > 0. One op per
 * ingredient (the last wins; an add is its own slot), unknown shapes dropped.
 */
function sanitizeRecipeEdits(raw: unknown, recipeIds: readonly string[], catalog: Catalog): RecipeEdits {
  const out: RecipeEdits = {};
  if (!isRecord(raw)) return out;
  const ING = new Set(catalog.ingredients.map((i) => i.id));
  const qty = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) && n > 0 ? Math.min(MAX_EDIT_QTY, Math.round(n * 10000) / 10000) : null;
  };
  const known = (v: unknown): v is string => typeof v === 'string' && ING.has(v);

  for (const rid of recipeIds) {
    const list = raw[rid];
    if (!Array.isArray(list)) continue;
    const ops: EditOp[] = [];
    const slotOf = new Map<string, number>(); // `${isAdd}:${ingredientId}` -> index in ops
    for (const o of list) {
      if (ops.length >= MAX_EDIT_OPS || !isRecord(o) || !known(o.ingredientId)) continue;
      let op: EditOp | null = null;
      const q = qty(o.qtyPerPerson);
      if (o.op === 'leave_out') op = { op: 'leave_out', ingredientId: o.ingredientId };
      else if (o.op === 'amount' && q != null) op = { op: 'amount', ingredientId: o.ingredientId, qtyPerPerson: q };
      else if (o.op === 'swap' && q != null && known(o.to)) op = { op: 'swap', ingredientId: o.ingredientId, to: o.to, qtyPerPerson: q };
      else if (o.op === 'add' && q != null) op = { op: 'add', ingredientId: o.ingredientId, qtyPerPerson: q };
      if (!op) continue;
      const key = `${op.op === 'add'}:${op.ingredientId}`;
      const at = slotOf.get(key);
      if (at != null) ops[at] = op;
      else {
        slotOf.set(key, ops.length);
        ops.push(op);
      }
    }
    if (ops.length > 0) out[rid] = ops;
  }
  return out;
}

/**
 * A recipe's lines after a menu's ops: amount re-quantifies a line, swap
 * replaces its ingredient (and quantity, in the new ingredient's own unit),
 * leave_out drops it, add appends a line for everyone. Ops target lines by
 * ingredient and apply to every line of it (the serves-rule variants of one
 * base line move together); an op whose ingredient the recipe lacks is ignored.
 * Pure; never mutates the recipe.
 */
export function applyRecipeEdits(recipe: Pick<Recipe, 'lines'>, ops: readonly EditOp[]): RecipeLine[] {
  if (ops.length === 0) return recipe.lines;
  const target = new Map<string, Exclude<EditOp, { op: 'add' }>>();
  for (const o of ops) if (o.op !== 'add') target.set(o.ingredientId, o);

  const out: RecipeLine[] = [];
  for (const line of recipe.lines) {
    const o = target.get(line.ingredientId);
    if (!o) out.push(line);
    else if (o.op === 'amount') out.push({ ...line, qtyPerPerson: o.qtyPerPerson });
    else if (o.op === 'swap') out.push({ ...line, ingredientId: o.to, qtyPerPerson: o.qtyPerPerson, unitKey: null });
  }
  for (const o of ops) {
    if (o.op === 'add') out.push({ ingredientId: o.ingredientId, qtyPerPerson: o.qtyPerPerson, unitKey: null, servesRule: 'everyone', servesRestrictions: [] });
  }
  return out;
}

/** The catalog as THIS meal sees it: its recipes carry the meal's edits. The
 *  same object back when the meal has none, so the common case costs nothing. */
export function mealCatalog(catalog: Catalog, meal: MenuMeal): Catalog {
  const edits: RecipeEdits = meal.recipeEdits ?? {}; // meals stored before recipeEdits existed
  const edited = (r: Recipe) => (edits[r.id]?.length ?? 0) > 0;
  if (!catalog.recipes.some(edited)) return catalog;
  return { ...catalog, recipes: catalog.recipes.map((r) => (edited(r) ? { ...r, lines: applyRecipeEdits(r, edits[r.id]) } : r)) };
}


/**
 * The menu's shopping choices from whatever was stored: the menu's own
 * `shopping` first, then the per-meal packageChoice / qtyOverride / lineSource
 * that menus saved before slice 5 carry — per ingredient the first non-empty
 * value wins, so a choice the scout made on the menu is never overridden by an
 * old meal's. Shape-only (no catalog): sanitizeMenu validates the result.
 */
export function foldShopping(own: unknown, meals: unknown): MenuShopping {
  const out = emptyShopping();
  const sources: unknown[] = [own, ...(Array.isArray(meals) ? meals : [])];
  for (const src of sources) {
    if (!isRecord(src)) continue;
    for (const key of ['packageChoice', 'qtyOverride', 'lineSource'] as const) {
      const part = src[key];
      if (!isRecord(part)) continue;
      const dest = out[key] as Record<string, unknown>;
      for (const [ing, v] of Object.entries(part)) if (!(ing in dest)) dest[ing] = v;
    }
  }
  return out;
}

/** Folded choices → ones the catalog can still honour (restorePlan's rules per field, ingredients that exist). */
function sanitizeShopping(folded: MenuShopping, catalog: Catalog): MenuShopping {
  const plan = restorePlan({ ...folded, meal: 'breakfast' }, catalog);
  const ING = new Set(catalog.ingredients.map((i) => i.id));
  const known = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([ing]) => ING.has(ing))) as Record<string, T>;
  return { packageChoice: known(plan.packageChoice), qtyOverride: known(plan.qtyOverride), lineSource: known(plan.lineSource) };
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
      recipeEdits: sanitizeRecipeEdits(m.recipeEdits, plan.recipeIds, catalog)
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
    dayCount: coverDays(r.dayCount, meals),
    shopping: sanitizeShopping(foldShopping(r.shopping, r.meals), catalog),
    meals
  };
}

/** The menu's first day + n, as 'YYYY-MM-DD' (UTC arithmetic on a calendar date). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** One menu meal as the planner's Plan: the menu's people, diets and budget,
 *  the meal's own headcount when it has one. Package choices are the menu's,
 *  not the meal's (see MenuShopping), so a meal on its own prices at the
 *  recommended packages. */
export function composePlan(menu: Menu, meal: MenuMeal): Plan {
  return {
    meal: meal.slot,
    headcount: meal.headcount ?? menu.headcount,
    restrictions: { ...menu.restrictions },
    recipeIds: [...meal.recipeIds],
    packageChoice: {},
    qtyOverride: {},
    lineSource: {},
    budgetPerPerson: menu.budgetPerPersonMeal,
    date: addDays(menu.startDate ?? centralToday(), meal.day),
    patrol: ''
  };
}
