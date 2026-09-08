/**
 * Menu Monster — catalog loader (rows → domain objects).
 *
 * Takes a SupabaseClient rather than creating one, so the same query runs
 * from the shelf page (createAdminClient, via lib/menu-monster/data.ts) AND
 * from Vitest against local Postgres (tests/helpers/admin-client.ts) — the
 * D-049 pattern: integration-test the real query, don't mock the DB.
 *
 * Only `status = 'published'` recipes leave the server; retired ingredients
 * and packages are excluded at the query.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type {
  MmConversionRow,
  MmIngredientRow,
  MmPackageRow,
  MmRecipeLineRow,
  MmRecipeRow
} from '@/lib/supabase/types';
import type {
  Catalog,
  Conversion,
  FoodGroup,
  Ingredient,
  MealSlot,
  Package,
  Recipe,
  RecipeLine,
  RestrictionKey
} from './types';

export interface CatalogRows {
  ingredients: MmIngredientRow[];
  conversions: MmConversionRow[];
  packages: MmPackageRow[];
  recipes: MmRecipeRow[];
  lines: MmRecipeLineRow[];
}

export async function loadCatalogWith(supabase: SupabaseClient): Promise<Catalog> {
  const [ingredients, conversions, packages, recipes, lines] = await Promise.all([
    fetchAllRows<MmIngredientRow>((from, to) =>
      supabase
        .from('mm_ingredients')
        .select('id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid, created_at, retired_at')
        .is('retired_at', null)
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
          'id, ingredient_id, name, store, price, yield, yield_unit_label, noun, sold_size, sold_unit, note, as_of, created_at, retired_at'
        )
        .is('retired_at', null)
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeRow>((from, to) =>
      supabase
        .from('mm_recipes')
        .select('id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, created_at, updated_at')
        .eq('status', 'published')
        .order('sort_order')
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeLineRow>((from, to) =>
      supabase
        .from('mm_recipe_lines')
        .select('id, recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restriction')
        .order('recipe_id')
        .order('position')
        .range(from, to)
    )
  ]);
  return mapCatalog({ ingredients, conversions, packages, recipes, lines });
}

/** Pure row → domain mapping; exported so fixtures can build a Catalog from rows. */
export function mapCatalog(rows: CatalogRows): Catalog {
  const ingredients = rows.ingredients.map(toIngredient);
  const known = new Set(ingredients.map((i) => i.id));

  const conversions: Conversion[] = rows.conversions
    .filter((c) => known.has(c.ingredient_id))
    .map((c) => ({
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
      yield: p.yield == null ? null : Number(p.yield),
      yieldUnitLabel: p.yield_unit_label,
      noun: p.noun || 'pack',
      soldSize: p.sold_size == null ? null : Number(p.sold_size),
      soldUnit: p.sold_unit,
      note: p.note,
      asOf: p.as_of,
      retiredAt: p.retired_at
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
      servesRestriction: l.serves_rule === 'everyone' ? null : l.serves_restriction
    });
    linesByRecipe.set(l.recipe_id, list);
  }

  // No status filter here: the PUBLIC query asks for published only, and the
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
      lines: linesByRecipe.get(r.id) ?? []
    }));

  return { ingredients, packages, conversions, recipes };
}

function toIngredient(row: MmIngredientRow): Ingredient {
  return {
    id: row.id,
    name: row.name,
    unit: { key: row.unit_key, one: row.unit_one, many: row.unit_many, kind: row.unit_kind },
    section: row.section,
    staple: row.staple,
    avoid: row.avoid as RestrictionKey[],
    retiredAt: row.retired_at
  };
}

/**
 * The leader tools' load: every recipe whatever its status, and retired
 * ingredients/packages included (flagged by retiredAt) so a retired package
 * still shows under its ingredient and a retired recipe can be restored.
 * Same mapper as the public load — one row → domain rule (D-049).
 */
export async function loadAuthoringCatalogWith(supabase: SupabaseClient): Promise<Catalog> {
  const [ingredients, conversions, packages, recipes, lines] = await Promise.all([
    fetchAllRows<MmIngredientRow>((from, to) =>
      supabase
        .from('mm_ingredients')
        .select('id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid, created_at, retired_at')
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
          'id, ingredient_id, name, store, price, yield, yield_unit_label, noun, sold_size, sold_unit, note, as_of, created_at, retired_at'
        )
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeRow>((from, to) =>
      supabase
        .from('mm_recipes')
        .select('id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, created_at, updated_at')
        .order('sort_order')
        .order('name')
        .range(from, to)
    ),
    fetchAllRows<MmRecipeLineRow>((from, to) =>
      supabase
        .from('mm_recipe_lines')
        .select('id, recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restriction')
        .order('recipe_id')
        .order('position')
        .range(from, to)
    )
  ]);
  return mapCatalog({ ingredients, conversions, packages, recipes, lines });
}
