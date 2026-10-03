/**
 * Scout recipes (Plans/Menu-Monster-Scout-Workspace.md, Phase 4). Pure rules:
 * the S-<8 hex> id, which recipes a picker offers, the text every scout-written
 * string passes before it reaches the database (public once shared — the RPC
 * checks it again with mm_scout_text_ok), the cleaned draft the save RPC
 * receives, what sharing needs, and the frozen credit.
 */

import { publicScoutName } from '@/lib/scout-name';
import type { Catalog, FoodGroup, MealSlot, Recipe } from './types';
import { FOOD_GROUPS, MEALS, supportedUnits } from './units';
import { overlayNewIngredients, sanitizeNewIngredients, type NewIngredient } from './scout-ingredients';
import { applyRecipeEdits, type EditOp } from './menus';

const SCOUT_ID = /^S-[0-9a-f]{8}$/;

export const MAX_SCOUT_RECIPE_NAME = 60;
export const MAX_SCOUT_STEPS = 30;
export const MAX_SCOUT_STEP = 300;
export const MAX_SCOUT_LINES = 40;
export const MAX_SCOUT_RECIPES = 25;
/** mm_save_scout_recipe's limit on the joined steps text. */
export const MAX_SCOUT_STEPS_TEXT = 4000;
const MAX_CREDIT = 40;
const MAX_QTY = 1000;

/** True for a scout-written recipe's id. */
export const isScoutRecipeId = (id: unknown): id is string => typeof id === 'string' && SCOUT_ID.test(id);

/** A fresh scout recipe id. */
export function newScoutRecipeId(rand: () => number = Math.random): string {
  let hex = '';
  for (let i = 0; i < 8; i++) hex += Math.floor(rand() * 16).toString(16);
  return `S-${hex}`;
}

/** Whether a picker may offer the recipe. Retired recipes stay in the catalog so menus keep them, but are never offered. */
export const isPickable = (r: Pick<Recipe, 'status'>) => r.status !== 'retired';

const CONTROL = /[\u0000-\u001F\u007F]/g;
const LINK = /(https?:\/\/|www\.)\S*/gi;
/** Zero-width and bidi-override characters: hidden or spoofed text (mm_scout_text_ok refuses them too). */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Scout text as it may be stored and shown: no control characters, no links, single spaces, within `max`. */
export function cleanScoutText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(LINK, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

export interface ScoutRecipeLine {
  ingredientId: string;
  qtyPerPerson: number;
  /** null = the ingredient's own recipe unit. */
  unitKey: string | null;
}

/** What the editor sends and the save RPC receives, cleaned. */
export interface ScoutRecipeDraft {
  /** null = a new recipe (the action assigns an id). */
  id: string | null;
  name: string;
  mealFit: MealSlot[];
  foodGroups: FoodGroup[];
  steps: string[];
  lines: ScoutRecipeLine[];
  /** The troop recipe this one started from ("Share this version", 4C). */
  originRecipeId: string | null;
  /** Typed-in ingredients not saved yet (Phase 4B); lines name them by their new: key. */
  newIngredients: NewIngredient[];
  /** Gear you'll need (4C). */
  equipment: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = <K extends string>(raw: unknown, allowed: readonly K[]): K[] =>
  Array.isArray(raw) ? allowed.filter((k) => raw.includes(k)) : [];

/** Any payload → a draft the RPC will accept (unknown meals, groups, ingredients and units dropped; one line per ingredient). */
export function sanitizeScoutRecipe(raw: unknown, base: Catalog): ScoutRecipeDraft {
  const r = isRecord(raw) ? raw : {};
  const typed = sanitizeNewIngredients(r.newIngredients, base);
  const catalog = overlayNewIngredients(base, typed);
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const lines: ScoutRecipeLine[] = [];
  for (const l of Array.isArray(r.lines) ? r.lines : []) {
    if (lines.length >= MAX_SCOUT_LINES) break;
    if (!isRecord(l) || typeof l.ingredientId !== 'string') continue;
    const ing = ING.get(l.ingredientId);
    const qty = Number(l.qtyPerPerson);
    if (!ing || seen.has(ing.id) || !Number.isFinite(qty) || qty <= 0) continue;
    seen.add(ing.id);
    const unitKey = typeof l.unitKey === 'string' && l.unitKey !== ing.unit.key && supportedUnits(ing, catalog.conversions).includes(l.unitKey) ? l.unitKey : null;
    lines.push({ ingredientId: ing.id, qtyPerPerson: Math.min(MAX_QTY, Math.round(qty * 1000) / 1000), unitKey });
  }
  const steps: string[] = [];
  let used = 0;
  for (const s of (Array.isArray(r.steps) ? r.steps : []).map((x) => cleanScoutText(x, MAX_SCOUT_STEP)).filter(Boolean)) {
    if (steps.length >= MAX_SCOUT_STEPS || used + s.length + 1 > MAX_SCOUT_STEPS_TEXT) break;
    steps.push(s);
    used += s.length + 1;
  }
  return {
    id: isScoutRecipeId(r.id) ? r.id : null,
    name: cleanScoutText(r.name, MAX_SCOUT_RECIPE_NAME),
    mealFit: pick(r.mealFit, MEALS.map((m) => m.key)),
    foodGroups: pick(r.foodGroups, FOOD_GROUPS.map((g) => g.key)),
    steps,
    lines,
    originRecipeId: typeof r.originRecipeId === 'string' && r.originRecipeId.length <= 64 ? r.originRecipeId : null,
    // Only the typed-ins a line still uses go to the database.
    newIngredients: typed.filter((n) => seen.has(n.key)),
    equipment: cleanGear(r.equipment)
  };
}

/** Steps are stored one per line in steps_md and always shown as plain text. */
export const stepsToText = (steps: readonly string[]) => steps.join('\n');
export const stepsFromText = (text: string | null | undefined) => (text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

/** What stops a draft from being shared (empty = ready). A save needs only a name. */
export function shareProblems(d: Pick<ScoutRecipeDraft, 'name' | 'mealFit' | 'lines'>): string[] {
  const out: string[] = [];
  if (!d.name) out.push('Give your recipe a name.');
  if (d.mealFit.length === 0) out.push('Pick at least one meal it’s good for.');
  if (d.lines.length === 0) out.push('Add at least one ingredient.');
  return out;
}

/** The frozen "Sam K." credit, from `people` (never scouts/leaders), as stored. */
export function creditFor(person: { first_name: string | null; last_name: string | null }): string {
  return cleanScoutText(publicScoutName({ first_name: person.first_name ?? '', last_name: person.last_name ?? '' }), MAX_CREDIT);
}

/* ---- Gear and "Share this version" (Phase 4C) ------------------------------ */

export const MAX_GEAR = 20;
const MAX_GEAR_ITEM = 40;

/** What the recipe editor offers under "Often used". */
export const GEAR_SUGGESTIONS = ['Camp stove', 'Dutch oven', 'Skillet', 'Pot', 'Spatula', 'Tongs', 'Cutting board', 'Cooler', 'Aluminum foil'] as const;

/** Gear as stored: cleaned like any scout text, one of each (ignoring case), at most 20. */
export function cleanGear(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(raw) ? raw : []) {
    const t = cleanScoutText(g, MAX_GEAR_ITEM);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_GEAR) break;
  }
  return out;
}

/** "Gear you'll need" for a menu: every recipe's gear across its meals, one of each (ignoring case), first spelling wins. */
export function menuGear(menu: { meals: readonly { recipeIds: readonly string[] }[] }, catalog: Catalog): string[] {
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  return cleanGear(menu.meals.flatMap((m) => m.recipeIds.flatMap((id) => byId.get(id)?.equipment ?? [])));
}

/**
 * The editor's starting point for "Share this version as a new recipe": the
 * recipe as this meal's edits left it. Lines only for one diet are left out (a
 * scout recipe's lines feed everyone); the troop's steps, meals, food groups and
 * gear come along, and the troop recipe is remembered as its origin.
 */
export function versionDraft(recipe: Recipe, ops: readonly EditOp[]): Omit<ScoutRecipeDraft, 'id'> & { equipment: string[] } {
  const seen = new Set<string>();
  const lines: ScoutRecipeLine[] = [];
  for (const l of applyRecipeEdits(recipe, [...ops])) {
    if (l.servesRule === 'only' || seen.has(l.ingredientId) || !(l.qtyPerPerson > 0)) continue;
    seen.add(l.ingredientId);
    lines.push({ ingredientId: l.ingredientId, qtyPerPerson: l.qtyPerPerson, unitKey: l.unitKey });
  }
  return {
    name: cleanScoutText(`${recipe.name} (my version)`, MAX_SCOUT_RECIPE_NAME),
    mealFit: [...recipe.mealFit],
    foodGroups: [...recipe.foodGroups],
    steps: stepsFromText(recipe.stepsMd).map((s) => cleanScoutText(s, MAX_SCOUT_STEP)).filter(Boolean).slice(0, MAX_SCOUT_STEPS),
    lines: lines.slice(0, MAX_SCOUT_LINES),
    originRecipeId: recipe.id,
    newIngredients: [],
    equipment: cleanGear(recipe.equipment ?? [])
  };
}
