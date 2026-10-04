/**
 * Menu Monster — catalog loader (rows → domain objects).
 *
 * Takes a SupabaseClient rather than creating one, so the same query runs
 * from the shelf page (createAdminClient, via lib/menu-monster/data.ts) AND
 * from Vitest against local Postgres (tests/helpers/admin-client.ts) — the
 * D-049 pattern: integration-test the real query, don't mock the DB.
 *
 * Published and retired recipes leave the server (retired ones only so a menu
 * keeps what it holds — pickers filter them), plus the owner's own drafts;
 * retired ingredients and packages are excluded at the query.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type {
  MmBrandRow,
  MmConversionRow,
  MmIngredientRow,
  MmPackageRow,
  MmRecipeLineRow,
  MmRecipeRow,
  MmRecipeVariationRow,
  MmVariationLineRow
} from '@/lib/supabase/types';
import type {
  Brand,
  Catalog,
  Conversion,
  FoodGroup,
  Ingredient,
  MealSlot,
  Package,
  Recipe,
  RecipeLine,
  RestrictionKey,
  Variation,
  VariationLine
} from './types';

export interface CatalogRows {
  ingredients: MmIngredientRow[];
  conversions: MmConversionRow[];
  packages: MmPackageRow[];
  recipes: MmRecipeRow[];
  lines: MmRecipeLineRow[];
  variations?: MmRecipeVariationRow[];
  variationLines?: MmVariationLineRow[];
  brands?: MmBrandRow[];
}

/** Recipe columns every load reads; never the author's person id on a public load. */
const RECIPE_COLUMNS = 'id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, created_at, updated_at, attribution_label, equipment, brand_suggestions';

export interface CatalogLoadOptions {
  /** The verified scout whose own drafts join the catalog (their menus, their library). */
  ownerPersonId?: number | null;
}

/**
 * The menu-side catalog: published recipes, RETIRED ones too (a menu that holds
 * a recipe keeps it after a leader retires it — pickers filter with isPickable),
 * and the owner's own drafts. Nobody else's draft ever leaves the server.
 */
export async function loadCatalogWith(supabase: SupabaseClient, opts: CatalogLoadOptions = {}): Promise<Catalog> {
  const owner = Number.isSafeInteger(opts.ownerPersonId) && (opts.ownerPersonId as number) > 0 ? (opts.ownerPersonId as number) : null;
  const [ingredients, conversions, packages, recipes, lines] = await Promise.all([
    fetchAllRows<MmIngredientRow>((from, to) =>
      supabase
        .from('mm_ingredients')
        .select('id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid, created_at, retired_at, needs_match_at, submitted_at, shared_at')
        .is('retired_at', null)
        // A scout's typed-in reaches others once a shared recipe reveals it; its author always sees their own.
        .or(owner ? `added_by_person_id.is.null,shared_at.not.is.null,added_by_person_id.eq.${owner}` : 'added_by_person_id.is.null,shared_at.not.is.null')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<MmConversionRow>((from, to) =>
      supabase
        .from('mm_conversions')
        .select('id, ingredient_id, from_unit, to_unit, factor, label')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<MmPackageRow>((from, to) =>
      supabase
        .from('mm_packages')
        .select(
          'id, ingredient_id, name, store, price, anchor_price, yield, yield_unit_label, noun, sold_size, sold_unit, note, as_of, created_at, retired_at, held_at, brand_id, size_label'
        )
        .is('retired_at', null)
        // A scout-added package waiting on a leader stays out of every public
        // planner until it is released — except for the scout who added it, so
        // their own menu still prices (release C); authoring (below) lists it.
        .or(owner ? `held_at.is.null,added_by_person_id.eq.${owner}` : 'held_at.is.null')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeRow>((from, to) =>
      supabase
        .from('mm_recipes')
        // The author's id is read only to mark the owner's own recipes (`mine`); it never leaves this function.
        .select(`${RECIPE_COLUMNS}, author_person_id`)
        .or(owner ? `status.in.(published,retired),and(status.eq.draft,author_person_id.eq.${owner})` : 'status.in.(published,retired)')
        .order('sort_order')
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeLineRow>((from, to) =>
      supabase
        .from('mm_recipe_lines')
        .select('id, recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions')
        .order('recipe_id')
        .order('position')
        .range(from, to)
    )
  ]);
  const [v, aliases, brands, brandAliases] = await Promise.all([
    loadVariationRows(supabase),
    loadAliasesWith(supabase),
    loadBrandRows(supabase, { includeRetired: false }),
    loadBrandAliasesWith(supabase)
  ]);
  const catalog = mapCatalog({ ingredients, conversions, packages, recipes, lines, brands, ...v });
  const mine = new Set(owner == null ? [] : recipes.filter((r) => r.author_person_id === owner).map((r) => r.id));
  return {
    ...catalog,
    recipes: catalog.recipes.map((recipe) => {
      const { authorPersonId, sharedAt, ...r } = recipe;
      void authorPersonId;
      void sharedAt;
      return mine.has(r.id) ? { ...r, mine: true } : r;
    }),
    aliases,
    brandAliases
  };
}

/** Typed-in ingredients a leader matched to the book (Phase 4B): from → { to, factor }. A chain resolves to its end. */
export async function loadAliasesWith(supabase: SupabaseClient): Promise<Record<string, { to: string; factor: number }>> {
  const rows = await fetchAllRows<{ id: string; merged_into_id: string; merge_factor: number }>((from, to) =>
    supabase.from('mm_ingredients').select('id, merged_into_id, merge_factor').not('merged_into_id', 'is', null).order('id').range(from, to)
  );
  const direct = new Map(rows.map((r) => [r.id, { to: r.merged_into_id, factor: Number(r.merge_factor) }]));
  const out: Record<string, { to: string; factor: number }> = {};
  for (const id of direct.keys()) {
    let hop = direct.get(id)!;
    let factor = hop.factor;
    for (let guard = 0; direct.has(hop.to) && guard < 10; guard++) {
      hop = direct.get(hop.to)!;
      factor *= hop.factor;
    }
    out[id] = { to: hop.to, factor };
  }
  return out;
}

/** Pure row → domain mapping; exported so fixtures can build a Catalog from rows. */
export function mapCatalog(rows: CatalogRows): Catalog {
  const ingredients = rows.ingredients.map(toIngredient);
  const known = new Set(ingredients.map((i) => i.id));

  const conversions: Conversion[] = rows.conversions
    .filter((c) => known.has(c.ingredient_id))
    .map((c) => ({
      id: c.id,
      ingredientId: c.ingredient_id,
      from: c.from_unit,
      to: c.to_unit,
      factor: Number(c.factor),
      label: c.label
    }));

  const packages: Package[] = rows.packages
    .filter((p) => known.has(p.ingredient_id))
    .map((p) => ({
      id: p.id,
      ingredientId: p.ingredient_id,
      name: p.name,
      store: p.store,
      price: Number(p.price),
      anchorPrice: Number(p.anchor_price ?? p.price),
      yield: p.yield == null ? null : Number(p.yield),
      yieldUnitLabel: p.yield_unit_label,
      noun: p.noun || 'pack',
      soldSize: p.sold_size == null ? null : Number(p.sold_size),
      soldUnit: p.sold_unit,
      note: p.note,
      asOf: p.as_of,
      retiredAt: p.retired_at,
      ...(p.held_at != null ? { held: true as const } : {}),
      ...(p.brand_id !== undefined ? { brandId: p.brand_id ?? null, sizeLabel: p.size_label ?? null } : {})
    }));

  // Brands of ingredients this load carries. "New" = nobody has priced it yet (no usable live package).
  const priced = new Set(packages.filter((p) => p.brandId && p.yield != null && p.yield > 0 && !p.retiredAt && !p.held).map((p) => p.brandId));
  const brands: Brand[] = (rows.brands ?? [])
    .filter((b) => known.has(b.ingredient_id) && b.merged_into_id == null)
    .map((b) => ({
      id: b.id,
      ingredientId: b.ingredient_id,
      name: b.name,
      avoid: b.avoid == null ? null : (b.avoid as RestrictionKey[]),
      ...(priced.has(b.id) ? {} : { isNew: true }),
      retiredAt: b.retired_at,
      ...(b.added_by_person_id !== undefined ? { addedBy: b.added_by_person_id ?? null, createdAt: b.created_at } : {})
    }));

  // A line whose ingredient was retired is dropped rather than crashing the
  // planner; retiring an ingredient a published recipe still uses is a catalog
  // bug the leader tools will surface. Lines arrive ordered by position.
  const linesByRecipe = new Map<string, RecipeLine[]>();
  for (const l of rows.lines) {
    if (!known.has(l.ingredient_id)) continue;
    const list = linesByRecipe.get(l.recipe_id) ?? [];
    list.push({
      ingredientId: l.ingredient_id,
      qtyPerPerson: Number(l.qty_per_person),
      unitKey: l.unit_key,
      servesRule: l.serves_rule,
      servesRestrictions: l.serves_rule === 'everyone' ? [] : ((l.serves_restrictions ?? []) as RestrictionKey[])
    });
    linesByRecipe.set(l.recipe_id, list);
  }

  // The authoring diffs (Plans/Menu-Monster-Recipe-Variations.md). A
  // variation line whose ingredient was retired is dropped like a recipe line.
  const vLinesByKey = new Map<string, VariationLine[]>();
  for (const vl of rows.variationLines ?? []) {
    if (vl.ingredient_id && !known.has(vl.ingredient_id)) continue;
    const key = `${vl.recipe_id}|${vl.restriction}`;
    const list = vLinesByKey.get(key) ?? [];
    list.push({
      op: vl.op,
      baseIngredientId: vl.base_ingredient_id,
      ingredientId: vl.ingredient_id,
      qtyPerPerson: vl.qty_per_person == null ? null : Number(vl.qty_per_person),
      unitKey: vl.unit_key
    });
    vLinesByKey.set(key, list);
  }
  const variationsByRecipe = new Map<string, Variation[]>();
  for (const v of rows.variations ?? []) {
    const list = variationsByRecipe.get(v.recipe_id) ?? [];
    list.push({
      restriction: v.restriction as RestrictionKey,
      state: v.state,
      note: v.note,
      lines: vLinesByKey.get(`${v.recipe_id}|${v.restriction}`) ?? []
    });
    variationsByRecipe.set(v.recipe_id, list);
  }

  // No status filter here: the PUBLIC query asks for published + retired (+ the owner's drafts), and the
  // leader tools' query asks for everything. Which statuses arrive is the
  // caller's decision, made once, in its query (tech-lead, 2026-09-08).
  const recipes: Recipe[] = rows.recipes
    .map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      mealFit: r.meal_fit as MealSlot[],
      foodGroups: r.food_groups as FoodGroup[],
      camp: r.camp,
      trail: r.trail,
      method: r.method,
      stepsMd: r.steps_md,
      sortOrder: r.sort_order,
      lines: linesByRecipe.get(r.id) ?? [],
      variations: variationsByRecipe.get(r.id) ?? [],
      credit: r.attribution_label ?? null,
      equipment: r.equipment ?? [],
      ...(r.brand_suggestions && Object.keys(r.brand_suggestions).length > 0 ? { brandSuggestions: r.brand_suggestions } : {}),
      ...(r.author_person_id !== undefined ? { authorPersonId: r.author_person_id, sharedAt: r.shared_at ?? null } : {})
    }));

  return { ingredients, packages, conversions, recipes, ...(rows.brands ? { brands } : {}) };
}

/** mm_brands for a load: live ones for menus; every one (retired flagged) for the leader tools. */
async function loadBrandRows(supabase: SupabaseClient, opts: { includeRetired: boolean }): Promise<MmBrandRow[]> {
  // Who typed a brand, and when, is for the leader tools only: a menu-side catalog reaches the browser (qa-lead).
  if (opts.includeRetired) {
    return fetchAllRows<MmBrandRow>((from, to) =>
      supabase
        .from('mm_brands')
        .select('id, ingredient_id, name, avoid, added_by_person_id, created_at, retired_at, merged_into_id')
        .is('merged_into_id', null)
        .order('name')
        .order('id')
        .range(from, to)
    );
  }
  return fetchAllRows<MmBrandRow>((from, to) =>
    supabase
      .from('mm_brands')
      .select('id, ingredient_id, name, avoid, retired_at, merged_into_id')
      .is('merged_into_id', null)
      .is('retired_at', null)
      .order('name')
      .order('id')
      .range(from, to)
  );
}

/** Brands a leader merged away → the brand kept (a chain resolves to its end). */
export async function loadBrandAliasesWith(supabase: SupabaseClient): Promise<Record<string, string>> {
  const rows = await fetchAllRows<{ id: string; merged_into_id: string }>((from, to) =>
    supabase.from('mm_brands').select('id, merged_into_id').not('merged_into_id', 'is', null).order('id').range(from, to)
  );
  const direct = new Map(rows.map((r) => [r.id, r.merged_into_id]));
  const out: Record<string, string> = {};
  for (const id of direct.keys()) {
    let to = direct.get(id)!;
    for (let guard = 0; direct.has(to) && guard < 10; guard++) to = direct.get(to)!;
    out[id] = to;
  }
  return out;
}

/** The two variation tables, for both loaders. Paginated like the rest. */
async function loadVariationRows(supabase: SupabaseClient): Promise<{ variations: MmRecipeVariationRow[]; variationLines: MmVariationLineRow[] }> {
  const [variations, variationLines] = await Promise.all([
    fetchAllRows<MmRecipeVariationRow>((from, to) =>
      supabase
        .from('mm_recipe_variations')
        .select('recipe_id, restriction, state, note, updated_at')
        .order('recipe_id')
        .order('restriction')
        .range(from, to)
    ),
    fetchAllRows<MmVariationLineRow>((from, to) =>
      supabase
        .from('mm_variation_lines')
        .select('id, recipe_id, restriction, position, op, base_ingredient_id, ingredient_id, qty_per_person, unit_key')
        .order('recipe_id')
        .order('restriction')
        .order('position')
        .range(from, to)
    )
  ]);
  return { variations, variationLines };
}

function toIngredient(row: MmIngredientRow): Ingredient {
  return {
    id: row.id,
    name: row.name,
    unit: { key: row.unit_key, one: row.unit_one, many: row.unit_many, kind: row.unit_kind },
    section: row.section,
    staple: row.staple,
    avoid: row.avoid as RestrictionKey[],
    retiredAt: row.retired_at,
    ...(row.needs_match_at != null ? { needsMatch: true } : {}),
    ...(row.needs_match_at != null && row.submitted_at != null && row.shared_at == null ? { waiting: true } : {})
  };
}

/**
 * The leader tools' load: every recipe whatever its status (except a scout's
 * unshared draft, which stays private to its author), and retired
 * ingredients/packages included (flagged by retiredAt) so a retired package
 * still shows under its ingredient and a retired recipe can be restored.
 * Same mapper as the public load — one row → domain rule (D-049).
 */
export async function loadAuthoringCatalogWith(supabase: SupabaseClient): Promise<Catalog> {
  const [ingredients, conversions, packages, recipes, lines] = await Promise.all([
    fetchAllRows<MmIngredientRow>((from, to) =>
      supabase
        .from('mm_ingredients')
        .select('id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid, created_at, retired_at, needs_match_at, added_by_person_id, shared_at')
        // Leaders see a scout's typed-in once a shared recipe uses it, never while it is private.
        .or('added_by_person_id.is.null,shared_at.not.is.null')
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmConversionRow>((from, to) =>
      supabase
        .from('mm_conversions')
        .select('id, ingredient_id, from_unit, to_unit, factor, label')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<MmPackageRow>((from, to) =>
      supabase
        .from('mm_packages')
        .select(
          'id, ingredient_id, name, store, price, anchor_price, yield, yield_unit_label, noun, sold_size, sold_unit, note, as_of, created_at, retired_at, brand_id, size_label'
        )
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeRow>((from, to) =>
      supabase
        .from('mm_recipes')
        .select(`${RECIPE_COLUMNS}, author_person_id, shared_at`)
        // A scout's recipe reaches the leader tools once shared — never as a private draft.
        .or('author_person_id.is.null,shared_at.not.is.null')
        .order('sort_order')
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeLineRow>((from, to) =>
      supabase
        .from('mm_recipe_lines')
        .select('id, recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions')
        .order('recipe_id')
        .order('position')
        .range(from, to)
    )
  ]);
  const [v, brands] = await Promise.all([loadVariationRows(supabase), loadBrandRows(supabase, { includeRetired: true })]);
  return mapCatalog({ ingredients, conversions, packages, recipes, lines, brands, ...v });
}
