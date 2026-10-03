/**
 * The Ingredients tab of the Menu Monster hub: the troop's price book as a scout
 * browses it — narrowed by name and by store section, each ingredient with the
 * packages it is sold in, cheapest first. Pure.
 */

import type { Catalog, Ingredient, Package, Section } from './types';

export interface IngredientEntry {
  ingredient: Ingredient;
  packages: Package[];
  /** The cheapest package's price, or null when none is sold. */
  from: number | null;
}

export function browseIngredients(catalog: Catalog, query: string, section: Section | null): IngredientEntry[] {
  const q = query.trim().toLowerCase();
  return catalog.ingredients
    .filter((i) => (!q || i.name.toLowerCase().includes(q)) && (!section || i.section === section))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ingredient) => {
      const packages = catalog.packages.filter((p) => p.ingredientId === ingredient.id).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
      return { ingredient, packages, from: packages.length ? packages[0].price : null };
    });
}
