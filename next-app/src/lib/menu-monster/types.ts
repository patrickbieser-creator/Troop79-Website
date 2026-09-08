/**
 * Menu Monster — domain types (Plans/Menu-Monster.md).
 *
 * The catalog shapes are what the engine computes over, mapped from the mm_*
 * rows in lib/supabase/types.ts by lib/menu-monster/catalog.ts. The Plan is
 * what the scout edits (persisted to localStorage, never the DB this phase);
 * ShoppingLine and Totals are DERIVED — never stored.
 */

export type UnitKind = 'volume' | 'weight' | 'count';

/** Counts show whole numbers; volume shows fractions; weight one decimal. */
export interface Unit {
  /** 'cup' | 'slice' | 'gram' … or 'count' for a per-ingredient noun (banana). */
  key: string;
  one: string;
  many: string;
  kind: UnitKind;
}

export type RestrictionKey = 'gf' | 'nut' | 'dairy' | 'veg';

export interface Restriction {
  key: RestrictionKey;
  label: string;
  hint: string;
}

/** Store aisle grouping — also the shopping-list sort order (see SECTION_ORDER). */
export type Section = 'produce' | 'dairy' | 'meat' | 'bakery' | 'dry';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert';

export type FoodGroup = 'grain' | 'protein' | 'fruit' | 'veg' | 'dairy';

export interface Ingredient {
  id: string;
  name: string;
  /** The recipe unit — package yields are stored in this unit (Option C). */
  unit: Unit;
  section: Section;
  /** Patrol-box item: counts toward Used, never toward Spent. */
  staple: boolean;
  /** Restriction keys this ingredient conflicts with. Used only to WARN. */
  avoid: RestrictionKey[];
  /** Set on the leader tools' authoring load only; the public load excludes retired rows. */
  retiredAt?: string | null;
}

/** "1 {from} = {factor} {to}" for one ingredient — bridges unit families. */
export interface Conversion {
  /** mm_conversions.id — carried so the leader tools can delete a row; absent on fixtures. */
  id?: number;
  ingredientId: string;
  from: string;
  to: string;
  factor: number;
  label: string | null;
}

export interface Package {
  id: string;
  ingredientId: string;
  name: string;
  store: string | null;
  price: number;
  /** In the ingredient's recipe unit. null = unusable until someone types it. */
  yield: number | null;
  /** Why it's unusable — the unit the label is in ('gallon'). */
  yieldUnitLabel: string | null;
  /** What one purchased unit is called: 'pack' | 'bag' | 'box' | 'dozen' | 'each' … */
  noun: string;
  soldSize: number | null;
  soldUnit: string | null;
  note: string | null;
  /** 'YYYY-MM-DD' the price was last confirmed. */
  asOf: string | null;
  /** Set on the leader tools' authoring load only; the public load excludes retired rows. */
  retiredAt?: string | null;
}

export type ServesRule = 'everyone' | 'except' | 'only';

export interface RecipeLine {
  ingredientId: string;
  qtyPerPerson: number;
  /** null = the ingredient's recipe unit; otherwise any key conv() can bridge. */
  unitKey: string | null;
  servesRule: ServesRule;
  /** Named for 'except' / 'only'; null for 'everyone'. */
  servesRestriction: RestrictionKey | null;
}

export type RecipeStatus = 'draft' | 'published' | 'retired';

/** A recipe is a menu item. Diet variants are per-line serves rules, not duplicate recipes. */
export interface Recipe {
  id: string;
  name: string;
  status: RecipeStatus;
  mealFit: MealSlot[];
  foodGroups: FoodGroup[];
  camp: boolean;
  trail: boolean;
  method: string | null;
  stepsMd: string | null;
  sortOrder: number;
  lines: RecipeLine[];
}

export interface Catalog {
  ingredients: Ingredient[];
  packages: Package[];
  conversions: Conversion[];
  recipes: Recipe[];
}

/** Where a shopping line comes from. Anything but 'buy' counts in Used, never Spent. */
export type LineSource = 'buy' | 'pantry' | 'home';

/** What the scout edits. Persisted to localStorage; everything else is derived. */
export interface Plan {
  meal: MealSlot;
  /** Scouts and adults together, 2–16. */
  headcount: number;
  /** Counts, never names. */
  restrictions: Record<RestrictionKey, number>;
  recipeIds: string[];
  /** ingredientId → packageId the scout picked instead of the recommendation. */
  packageChoice: Record<string, string>;
  /** ingredientId → a hand-typed purchase quantity, valid only for that package. */
  qtyOverride: Record<string, { packageId: string; qty: number }>;
  lineSource: Record<string, { source: LineSource; note: string }>;
  budgetPerPerson: number;
  /** 'YYYY-MM-DD' — a calendar day. */
  date: string;
  patrol: string;
}

export type LineStatus = 'ok' | 'short' | 'unpriced' | 'staple' | 'bring';

/** One recipe's contribution to a shopping line ("for Pancakes (everyone except gluten-free, 9)"). */
export interface LineSourceRef {
  recipe: Recipe;
  line: RecipeLine;
  /** In the ingredient's recipe unit. */
  amount: number;
  people: number;
}

export interface ShoppingLine {
  ing: Ingredient;
  /** Total needed in the recipe unit (count units already rounded up). */
  need: number;
  sources: LineSourceRef[];
  /** Every package for this ingredient, usable or not. */
  all: Package[];
  /** Packages with a yield — the only ones that can be priced. */
  usable: Package[];
  /** Lowest spend that covers the need (tie → less leftover); null when nothing is usable. */
  rec: Package | null;
  /** The package in effect: the scout's choice if still usable, else rec. */
  pkg: Package | null;
  /** Packages needed to cover the need with pkg. */
  autoQty: number;
  /** Packages actually being bought (autoQty unless overridden). */
  qty: number;
  overridden: boolean;
  spent: number;
  used: number;
  /** Leftover in the recipe unit; 0 when short. */
  leftQty: number;
  leftMoney: number;
  /** How far short in the recipe unit; 0 unless status === 'short'. */
  shortQty: number;
  status: LineStatus;
  source: LineSource;
  note: string;
}

export interface Totals {
  spent: number;
  used: number;
  left: number;
  /** Used value of patrol-box staples — counted nowhere else. */
  stapleUsed: number;
  /** Used value of pantry/home lines — counted nowhere else. */
  bringUsed: number;
  /** Ingredient names for the "Bringing, not buying" table. */
  bring: string[];
  /** Ingredient names with no usable package — excluded from every total. */
  unpriced: string[];
  /** Ingredient names where qty × yield < need. */
  short: string[];
  perSpent: number;
  perUsed: number;
  perLeft: number;
}

/** A selected recipe feeds a restricted person something they avoid, with no swap line. */
export interface RestrictionWarning {
  recipe: Recipe;
  restriction: Restriction;
  count: number;
  ingredients: string[];
}
