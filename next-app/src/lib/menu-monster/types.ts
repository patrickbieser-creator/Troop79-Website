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
export type Section = 'produce' | 'dairy' | 'beverage' | 'meat' | 'bakery' | 'dry';

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
  /** A scout typed it in and no leader has matched it yet (Phase 4B): unverified diets and price. */
  needsMatch?: boolean;
  /** Its author asked for it to join the price book and no leader has decided yet; only its author's catalog carries it. */
  waiting?: boolean;
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
  /** The last price a leader set or approved; scout reports are banded against it (price-band.ts). */
  anchorPrice: number;
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
  /** A scout-added package waiting for a leader (release C); only its scout's catalog carries it. */
  held?: true;
  /** The brand it is a size of; null / absent = no brand. */
  brandId?: string | null;
  /** "12 oz", "family size (18 oz)" — the size without the brand. */
  sizeLabel?: string | null;
}

/**
 * A brand or varietal of an ingredient (Chips Ahoy, Fuji, Whole, Thick cut) — release 3 of
 * Plans/Menu-Monster-Brands-Gear.md. Packages are sizes of a brand at a store. A menu may ask for an
 * ingredient with any brand, or name one or several.
 */
export interface Brand {
  id: string;
  ingredientId: string;
  name: string;
  /** This brand's own diet flags when a leader set them; null = the ingredient's. */
  avoid: RestrictionKey[] | null;
  /** Nobody has priced it yet (no usable package): costs are estimated from the cheapest known. */
  isNew?: boolean;
  /** Leader tools only. */
  retiredAt?: string | null;
  addedBy?: number | null;
  createdAt?: string;
}

/** One brand a menu chose for an ingredient. qty = packages of it; null = the engine's share. */
export interface BrandPick {
  brandId: string;
  qty: number | null;
}
/** ingredientId → the brands chosen for the whole menu; absent / empty = any brand. */
export type BrandPicks = Record<string, BrandPick[]>;

export type ServesRule = 'everyone' | 'except' | 'only';

/** What a line's amount is for: 'person' (the default) = each person it feeds; 'meal' = the meal as a whole, once
 *  (4 cups of oil however many are eating). Absent = 'person'. */
export type LineScale = 'person' | 'meal';

export interface RecipeLine {
  ingredientId: string;
  qtyPerPerson: number;
  /** null = the ingredient's recipe unit; otherwise any key conv() can bridge. */
  unitKey: string | null;
  /** Absent = 'person'. 'meal' = qtyPerPerson is the amount for the whole meal row (see LineScale). */
  scale?: LineScale;
  servesRule: ServesRule;
  /** The restrictions the rule names, in RESTRICTIONS order; empty for
   *  'everyone'. A list (2026-09-08, Plans/Menu-Monster-Recipe-Variations.md
   *  decision 2): a base line left out for dairy-free AND swapped for
   *  vegetarians is ONE line "everyone except dairy-free or vegetarian". */
  servesRestrictions: RestrictionKey[];
}

export type RecipeStatus = 'draft' | 'published' | 'retired';

/** What a leader records per (recipe, restriction). "Not reviewed" and
 *  "nothing needed because no ingredient is flagged" are the ABSENCE of a
 *  row — see variations.ts variationView(). */
export type VariationState = 'nothing' | 'substituted' | 'unsuitable';

export type VariationOp = 'swap' | 'leave_out' | 'add';

/** One change to the base recipe for one restriction. */
export interface VariationLine {
  op: VariationOp;
  /** swap / leave_out: which base line, by its ingredient (base lines are unique per ingredient). */
  baseIngredientId: string | null;
  /** swap / add: what goes in. */
  ingredientId: string | null;
  qtyPerPerson: number | null;
  unitKey: string | null;
}

export interface Variation {
  restriction: RestrictionKey;
  state: VariationState;
  note: string | null;
  lines: VariationLine[];
}

/** A recipe is a menu item: a base line list (`lines` holds the COMPILED
 *  serves-rule lines the engine reads) plus the per-restriction diffs that
 *  produced them (`variations`, the authoring source). */
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
  /** Absent on fixtures that predate variations; treated as none. */
  variations?: Variation[];
  /** A shared scout recipe's frozen credit, "Sam K." (Phase 4); null/absent for the troop's own. */
  credit?: string | null;
  /** Gear the recipe needs (Phase 4C rolls it up per menu). */
  equipment?: string[];
  /** ingredientId → the brand the recipe suggests (release 6). Chosen on a menu when the recipe is added and
   *  the menu has no brand for that ingredient yet; the planner can change it. Absent = none. */
  brandSuggestions?: Record<string, string>;
  /** Set = this menu item IS that food, served by itself (Plans/Menu-Monster-Single-Food-Entry.md): one line on
   *  it, the food's name, retired with it. The database keeps it true and clears it when it stops holding. A
   *  one-ingredient DISH under its own name ("Eggs - Hard-boiled") has none. */
  foodIngredientId?: string | null;
  /** The signed-in person loading the catalog wrote it (never set on a public load). */
  mine?: boolean;
  /** Leader tools only: when a scout shared it, and who wrote it. */
  sharedAt?: string | null;
  authorPersonId?: number | null;
}

export interface Catalog {
  ingredients: Ingredient[];
  packages: Package[];
  conversions: Conversion[];
  recipes: Recipe[];
  /** Typed-in ingredients a leader matched away (Phase 4B): from id → the book ingredient and
   *  `factor` (1 from-unit = factor to-units). Menus resolve these on read; absent = none. */
  aliases?: Record<string, { to: string; factor: number }>;
  /** Live brands (the leader tools' load also carries retired ones, flagged). Absent on old fixtures = none. */
  brands?: Brand[];
  /** A brand a leader merged away → the brand kept. Menus resolve these on read. */
  brandAliases?: Record<string, string>;
}

/** Where a shopping line comes from. Anything but 'buy' counts in Used, never Spent. */
export type LineSource = 'buy' | 'pantry' | 'home';

/** What the scout edits. Persisted to localStorage; everything else is derived. */
export interface Plan {
  meal: MealSlot;
  /** Scouts and adults together, 2–50 (MIN/MAX_HEADCOUNT). */
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
  /** The brands chosen per ingredient (a menu's; the old one-meal planner has none). */
  brands?: BrandPicks;
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
  /** Set when the menu chose brands for this ingredient: one part per brand, in the order chosen. */
  parts?: LinePart[];
  /** The cost is a guess: any brand will do (and brands exist to choose from), or a chosen brand has no price yet. */
  estimated?: boolean;
}

/** One chosen brand's share of a shopping line. */
export interface LinePart {
  brand: Brand;
  /** The package priced: the brand's own, or the cheapest known when the brand has none yet. */
  pkg: Package;
  qty: number;
  autoQty: number;
  spent: number;
  /** No priced package of this brand yet. */
  estimated: boolean;
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

/** 'allergen': a selected recipe feeds a restricted person something they
 *  avoid, with no swap line (gluten and nuts only). 'unsuitable': a leader
 *  marked the recipe Not suitable for a restriction that has a count. */
export interface RestrictionWarning {
  kind: 'allergen' | 'unsuitable';
  recipe: Recipe;
  restriction: Restriction;
  count: number;
  ingredients: string[];
  /** The same ingredients by id (parallel to `ingredients`), so the warning can offer a swap for them. */
  ingredientIds: string[];
}
