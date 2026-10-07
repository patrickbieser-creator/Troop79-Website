/**
 * Menu Monster leader tools — the Food & recipes list (Patrick, 2026-10-05: "more like the Price book — a
 * screen wide list with useful columns of data with an editor that opens").
 *
 * One row per menu item, A to Z, with what a leader scans for: kind, meals, what each person gets, diets,
 * cost and status. A single food opens under its row; a recipe's editor is too long for that and has its own
 * page — so the filters travel in the URL and the way back lands on the same list. A plain module: the table (client) and the recipe page (server) both read it.
 */
import { authoringIssues, authoringOf, blockingIssues, isSingleFood, type RecipeAuthoring } from './authoring';
import { buildLines, totalsOf } from './engine';
import { MEALS, RESTRICTIONS, lineUnit, parseQty, qtyText } from './units';
import { variationView, type BaseLine, type VariationView } from './variations';
import type { Catalog, Ingredient, MealSlot, Plan, Recipe, RestrictionKey } from './types';

export type Pill = 'Needs fixes' | 'Draft' | 'Published' | 'Retired';

/** The list's kind tabs. Retired items show under All (last, muted) and Retired only. */
export type ListKind = 'all' | 'recipes' | 'foods' | 'ingredients' | 'fixes' | 'retired';
const KINDS: readonly ListKind[] = ['all', 'recipes', 'foods', 'ingredients', 'fixes', 'retired'];

export interface FoodFilter {
  kind: ListKind;
  meal: MealSlot | '';
  q: string;
}
export const NO_FILTER: FoodFilter = { kind: 'all', meal: '', q: '' };

/** What one person's share costs, from the cheapest current prices. */
export type RowCost = { kind: 'priced'; perPerson: number } | { kind: 'unpriced' } | { kind: 'none' };

export interface FoodRow {
  recipe: Recipe;
  pill: Pill;
  /** One ingredient line for everyone: Cookies, Bacon. Opens in the list; a recipe opens its own page. */
  food: boolean;
  /** A food with a diet swap ("vegetarians get veggie bacon instead") — still a food, said in the list. */
  swaps: boolean;
  /** "3 slices" for a single food; "4 ingredients" for a recipe. */
  eachGets: string;
  /** The variations a leader has added, in the usual diet order. */
  diets: { key: RestrictionKey; view: VariationView }[];
  /** Diets with a flagged ingredient and no variation yet. */
  toLook: number;
  cost: RowCost;
  /** The names of the ingredients on its lines, so a search for hot cocoa finds the recipe that uses it. */
  ingredientNames: string[];
}

/** A Price book food with no menu item of its own (hot cocoa is only an ingredient in a recipe): a row of its own in the list. */
export interface IngredientRow {
  ingredient: Ingredient;
}
export type ListRow = FoodRow | IngredientRow;
export const isIngredientRow = (r: ListRow): r is IngredientRow => 'ingredient' in r;

/** The base as numbers, for the state rules (unparseable amounts count as 0). */
export const numericBase = (a: RecipeAuthoring): BaseLine[] =>
  a.base.map((b) => ({ ingredientId: b.ingredientId, qtyPerPerson: parseQty(b.amount) || 0, unitKey: b.unitKey, ...(b.scale === 'meal' ? { scale: 'meal' as const } : {}) }));

export function viewFor(a: RecipeAuthoring, r: RestrictionKey, catalog: Catalog): VariationView {
  return variationView(numericBase(a), a.variations.find((v) => v.restriction === r), r, catalog);
}

export function pillOf(a: RecipeAuthoring, catalog: Catalog): Pill {
  if (a.status === 'retired') return 'Retired';
  if (blockingIssues(authoringIssues(a, catalog)).length > 0) return 'Needs fixes';
  return a.status === 'published' ? 'Published' : 'Draft';
}

/** Sized for ten so a count food rounds the way a patrol's would; "used", so a half-empty package costs nothing here. */
const COST_HEADCOUNT = 10;

function costOf(recipe: Recipe, catalog: Catalog): RowCost {
  if (recipe.lines.length === 0) return { kind: 'none' };
  const plan: Plan = {
    meal: recipe.mealFit[0] ?? 'breakfast',
    headcount: COST_HEADCOUNT,
    restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
    recipeIds: [recipe.id],
    packageChoice: {},
    qtyOverride: {},
    lineSource: {},
    budgetPerPerson: 0,
    date: '',
    patrol: ''
  };
  // Costed whatever its status: a draft's price is worth seeing before it is published.
  const totals = totalsOf(buildLines(plan, { ...catalog, recipes: [{ ...recipe, status: 'published' }] }), plan);
  if (totals.unpriced.length > 0) return { kind: 'unpriced' };
  return totals.used > 0 ? { kind: 'priced', perPerson: totals.perUsed } : { kind: 'none' };
}

function eachGetsOf(recipe: Recipe, food: boolean, catalog: Catalog): string {
  if (!food) return recipe.lines.length === 0 ? 'No ingredients yet' : recipe.lines.length === 1 ? '1 ingredient' : `${recipe.lines.length} ingredients`;
  const line = recipe.lines[0];
  const ing = catalog.ingredients.find((i) => i.id === line.ingredientId);
  return ing ? qtyText(line.qtyPerPerson, lineUnit(line.unitKey, ing), true) : '';
}

/** Every menu item as a list row, A to Z with retired last (a leader looks a food up by its name). */
export function buildFoodRows(catalog: Catalog): FoodRow[] {
  return catalog.recipes
    .map((recipe) => {
      const a = authoringOf(recipe);
      const food = isSingleFood(a);
      const views = RESTRICTIONS.map((r) => ({ key: r.key, added: a.variations.some((v) => v.restriction === r.key), view: viewFor(a, r.key, catalog) }));
      return {
        recipe,
        pill: pillOf(a, catalog),
        food,
        swaps: food && a.variations.some((v) => v.lines.length > 0),
        eachGets: eachGetsOf(recipe, food, catalog),
        diets: views.filter((v) => v.added).map(({ key, view }) => ({ key, view })),
        toLook: views.filter((v) => !v.added && v.view === 'needs_look').length,
        cost: costOf(recipe, catalog),
        ingredientNames: recipe.lines.map((l) => catalog.ingredients.find((i) => i.id === l.ingredientId)?.name).filter((n): n is string => !!n)
      };
    })
    .sort((x, y) => Number(x.pill === 'Retired') - Number(y.pill === 'Retired') || x.recipe.name.localeCompare(y.recipe.name));
}

export function inKind(row: FoodRow, kind: ListKind): boolean {
  if (kind === 'all') return true;
  if (kind === 'ingredients') return false;
  if (kind === 'retired') return row.pill === 'Retired';
  if (kind === 'fixes') return row.pill === 'Needs fixes';
  return row.pill !== 'Retired' && (kind === 'foods') === row.food;
}

/** The rows a filter shows. `keepId` stays listed whatever the filter: an open editor never vanishes mid-edit. */
export function filterFoodRows(rows: readonly FoodRow[], filter: FoodFilter, keepId?: string | null): FoodRow[] {
  const term = filter.q.trim().toLowerCase();
  return rows.filter(
    (x) =>
      x.recipe.id === keepId ||
      (inKind(x, filter.kind) && (filter.meal === '' || x.recipe.mealFit.includes(filter.meal)) && (term === '' || x.recipe.name.toLowerCase().includes(term) || x.ingredientNames.some((n) => n.toLowerCase().includes(term))))
  );
}

/** When a search found the item only through an ingredient on its lines, that ingredient (lower case, for "has hot cocoa"); else null. */
export function viaIngredient(row: FoodRow, q: string): string | null {
  const term = q.trim().toLowerCase();
  if (term === '' || row.recipe.name.toLowerCase().includes(term)) return null;
  return row.ingredientNames.find((n) => n.toLowerCase().includes(term))?.toLowerCase() ?? null;
}

/** Price book foods with no menu item (live or retired — a retired one is listed as itself), A to Z. Typed-ins waiting on a leader are not the book's yet. */
export function buildIngredientRows(catalog: Catalog): IngredientRow[] {
  const tied = new Set(catalog.recipes.map((r) => r.foodIngredientId).filter((id): id is string => !!id));
  return catalog.ingredients
    .filter((i) => !i.retiredAt && !i.needsMatch && !i.waiting && !i.id.startsWith('x-') && !tied.has(i.id))
    .map((ingredient) => ({ ingredient }))
    .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
}

/** What the list shows: items and ingredient rows merged A to Z, retired items last. The kind and search filters apply to both. */
export function listRows(items: readonly FoodRow[], ingredients: readonly IngredientRow[], filter: FoodFilter, keepId?: string | null): ListRow[] {
  const term = filter.q.trim().toLowerCase();
  const foods = (kind: ListKind) => kind === 'all' || kind === 'ingredients';
  const ings = foods(filter.kind) && filter.meal === '' ? ingredients.filter((i) => term === '' || i.ingredient.name.toLowerCase().includes(term)) : [];
  const shown = filterFoodRows(items, filter, keepId);
  const active = [...shown.filter((x) => x.pill !== 'Retired'), ...ings].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return [...active, ...shown.filter((x) => x.pill === 'Retired')];
}
const nameOf = (r: ListRow): string => (isIngredientRow(r) ? r.ingredient.name : r.recipe.name);

/* ── Links: the filter travels with the leader ────────────────────────────── */

const BASE = '/admin/library/menu-monster';

function filterParams(filter: FoodFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (filter.kind !== 'all') p.set('kind', filter.kind);
  if (filter.meal !== '') p.set('meal', filter.meal);
  if (filter.q.trim() !== '') p.set('q', filter.q.trim());
  return p;
}

export function parseFoodFilter(sp: { kind?: string; meal?: string; q?: string }): FoodFilter {
  return {
    kind: KINDS.includes(sp.kind as ListKind) ? (sp.kind as ListKind) : 'all',
    meal: MEALS.some((m) => m.key === sp.meal) ? (sp.meal as MealSlot) : '',
    q: (sp.q ?? '').trim()
  };
}

/** The Food & recipes tab, filtered, with one single food open under its row when `openId` is given. */
export function foodListHref(filter: FoodFilter, openId?: string | null): string {
  const p = filterParams(filter);
  const q = p.toString();
  return `${BASE}?tab=recipes${openId ? `&recipe=${encodeURIComponent(openId)}` : ''}${q ? `&${q}` : ''}`;
}

/** A recipe's own page ('new' for a blank one), remembering the list it was opened from. */
export function recipeHref(id: string, filter: FoodFilter): string {
  const q = filterParams(filter).toString();
  return `${BASE}/recipes/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
}
