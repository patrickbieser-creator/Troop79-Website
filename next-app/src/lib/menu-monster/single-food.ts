/**
 * "Add a food on the fly from a meal" (Patrick, 2026-10-06: a scout planning a Friday snack typed
 * Kool-Aid and the price book had none). Pure rules for the one-step add:
 *
 *   - what is REQUIRED to save — a name and a Kind of food (the store section) — and the words for
 *     each missing piece (the form marks the field in place and prints "Can't save yet: …");
 *   - cleaning the payload the server action receives (sanitizeSingleFood): a typed-in ingredient
 *     with its package optional, how much each person gets, and the meal slot;
 *   - the scout recipe that holds it — one line, the food's name, fitting the slot — as the draft the
 *     recipe save takes (singleFoodDraft) and as the Recipe the planner shows at once (singleFoodRecipe,
 *     overlayNewRecipes) until the next load brings the real one in the catalog.
 *
 * The food is the scout's private typed-in until a leader keeps or matches it (the admin Needs
 * attention tab); an unpriced one shows "No price yet" in the planner.
 */

import type { Catalog, MealSlot, Recipe, Section } from './types';
import { MEALS, SECTION_ORDER, famFactor } from './units';
import { cleanScoutText } from './scout-text';
import { isNewKey, sanitizeNewIngredients, recipeUnitFor, type NewIngredient } from './scout-ingredients';
import type { ScoutRecipeDraft } from './scout-recipes';

export const MAX_EACH_PERSON = 1000;

/** Which part of the form a missing piece belongs to. */
export type FoodField = 'name' | 'section';

export interface FoodProblem {
  field: FoodField;
  /** The note under the field; also the reason after "Can't save yet:". */
  reason: string;
}

/** What is missing from the two required pieces, in form order. Empty = the food can be saved. */
export function foodProblems(input: { name: string; section: Section | '' }): FoodProblem[] {
  const out: FoodProblem[] = [];
  if (!cleanScoutText(input.name, 60)) out.push({ field: 'name', reason: 'give it a name' });
  if (!SECTION_ORDER.some((k) => k === input.section)) out.push({ field: 'section', reason: 'pick what kind of food it is' });
  return out;
}

/** The scout's menu item for a food on the fly. `eachPerson` is per person; `unit` null = the food's own unit. */
export interface SingleFood {
  /** The new typed-in (its key is new:<8 hex>); null when `existingIngredientId` names a food the book already has. */
  ingredient: NewIngredient | null;
  existingIngredientId: string | null;
  eachPerson: number;
  unit: string | null;
  mealSlot: MealSlot;
}

export type SingleFoodResult = { ok: true; food: SingleFood } | { ok: false; error: string; existingIngredientId?: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Any payload → a food the action can save, or what is wrong in words. */
export function sanitizeSingleFood(raw: unknown, catalog: Catalog): SingleFoodResult {
  const r = isRecord(raw) ? raw : {};
  const slot = MEALS.find((m) => m.key === r.mealSlot)?.key;
  if (!slot) return { ok: false, error: 'Pick which meal this food is for.' };
  let eachPerson = 1;
  if (r.eachPerson != null && r.eachPerson !== '') {
    eachPerson = Math.round(Number(r.eachPerson) * 1000) / 1000;
    if (!(eachPerson > 0 && eachPerson <= MAX_EACH_PERSON)) return { ok: false, error: 'How much does each person get? Enter a number above 0.' };
  }

  if (typeof r.existingIngredientId === 'string' && r.existingIngredientId) {
    const ing = catalog.ingredients.find((i) => i.id === r.existingIngredientId && !i.retiredAt);
    if (!ing) return { ok: false, error: 'That food isn’t on the list any more.' };
    return { ok: true, food: { ingredient: null, existingIngredientId: ing.id, eachPerson, unit: lineUnit(r.unit, ing.unit.key), mealSlot: slot } };
  }

  const i = isRecord(r.ingredient) ? r.ingredient : {};
  const problems = foodProblems({ name: String(i.name ?? ''), section: SECTION_ORDER.find((k) => k === i.section) ?? '' });
  if (problems.length > 0) return { ok: false, error: `Can’t save yet: ${problems.map((p) => p.reason).join(', ')}.` };
  const name = cleanScoutText(i.name, 60);
  const have = catalog.ingredients.find((x) => x.name.toLowerCase() === name.toLowerCase() && !x.needsMatch);
  if (have) return { ok: false, error: `“${name}” is already on the list. Add that one instead.`, existingIngredientId: have.id };
  if (!isNewKey(i.key)) return { ok: false, error: 'Check the name and the price, then try again.' };
  const [clean] = sanitizeNewIngredients([i], catalog);
  if (!clean) return { ok: false, error: 'Check the name, the package size and the price, then try again.' };
  return { ok: true, food: { ingredient: clean, existingIngredientId: null, eachPerson, unit: lineUnit(r.unit, recipeUnitFor(clean.kind, clean.one, clean.many).key), mealSlot: slot } };
}

/** A line unit the food's own unit can bridge to; anything else = the food's own unit (null). */
function lineUnit(raw: unknown, own: string): string | null {
  return typeof raw === 'string' && raw && raw !== own && famFactor(raw, own) != null ? raw : null;
}

/** The recipe draft the recipe save takes: named for the food, fitting the slot, one line, no steps. */
export function singleFoodDraft(name: string, slot: MealSlot, ingredientId: string, eachPerson: number, unitKey: string | null): ScoutRecipeDraft {
  return {
    id: null,
    name,
    mealFit: [slot],
    foodGroups: [],
    steps: [],
    lines: [{ ingredientId, qtyPerPerson: eachPerson, unitKey }],
    originRecipeId: null,
    newIngredients: [],
    equipment: []
  };
}

/** The menu item as the planner holds it the moment it is saved (the next load brings the real row). */
export function singleFoodRecipe(id: string, name: string, slot: MealSlot, ingredientId: string, eachPerson: number, unitKey: string | null): Recipe {
  return {
    id,
    name,
    status: 'draft',
    mealFit: [slot],
    foodGroups: [],
    camp: true,
    trail: false,
    method: null,
    stepsMd: null,
    sortOrder: 1000,
    lines: [{ ingredientId, qtyPerPerson: eachPerson, unitKey, servesRule: 'everyone', servesRestrictions: [] }],
    mine: true
  };
}

/** The catalog plus recipes made on this page; one the catalog already has is skipped. Pure. */
export function overlayNewRecipes(catalog: Catalog, list: readonly Recipe[]): Catalog {
  const have = new Set(catalog.recipes.map((r) => r.id));
  const fresh = list.filter((r) => !have.has(r.id));
  return fresh.length === 0 ? catalog : { ...catalog, recipes: [...catalog.recipes, ...fresh] };
}
