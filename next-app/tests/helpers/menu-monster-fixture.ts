import { mapCatalog } from '../../src/lib/menu-monster/catalog';
import type {
  MmConversionRow,
  MmIngredientRow,
  MmPackageRow,
  MmRecipeLineRow,
  MmRecipeRow
} from '../../src/lib/supabase/types';

/**
 * A slice of the seed rows run through the real row→domain mapper — the same
 * catalog the planner test uses (pancakes with the gluten-free swap, bacon,
 * oatmeal, an unpriced orange juice, sandwiches), shared by the scout-workspace
 * component tests so they don't each re-declare it.
 */

const ing = (
  id: string,
  name: string,
  unit: [MmIngredientRow['unit_kind'], string, string, string],
  section: MmIngredientRow['section'],
  extra: Partial<MmIngredientRow> = {}
): MmIngredientRow => ({
  id,
  name,
  unit_kind: unit[0],
  unit_key: unit[1],
  unit_one: unit[2],
  unit_many: unit[3],
  section,
  staple: false,
  avoid: [],
  created_at: '2026-09-07T00:00:00Z',
  retired_at: null,
  ...extra
});

const pkg = (
  id: string,
  ingredient_id: string,
  name: string,
  price: number,
  yield_: number | null,
  noun: string,
  extra: Partial<MmPackageRow> = {}
): MmPackageRow => ({
  id,
  ingredient_id,
  name,
  store: null,
  price,
  yield: yield_,
  yield_unit_label: yield_ == null ? 'gallon' : null,
  noun,
  sold_size: null,
  sold_unit: null,
  note: null,
  as_of: '2026-08-22',
  created_at: '2026-09-07T00:00:00Z',
  retired_at: null,
  ...extra
});

const recipeRow = (id: string, name: string, meal_fit: string[], sort_order: number): MmRecipeRow => ({
  id,
  name,
  status: 'published',
  meal_fit,
  food_groups: [],
  camp: true,
  trail: false,
  method: null,
  steps_md: null,
  sort_order,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z'
});

let lineId = 1;
const line = (
  recipe_id: string,
  position: number,
  ingredient_id: string,
  qty_per_person: number,
  serves_rule: MmRecipeLineRow['serves_rule'] = 'everyone',
  restriction: 'gf' | 'nut' | 'dairy' | 'veg' | null = null
): MmRecipeLineRow => ({
  id: lineId++,
  recipe_id,
  position,
  ingredient_id,
  qty_per_person,
  unit_key: null,
  serves_rule,
  serves_restrictions: restriction ? [restriction] : []
});

const ROWS = {
  ingredients: [
    ing('pancake-mix', 'Pancake mix', ['volume', 'cup', 'cup', 'cups'], 'dry', { avoid: ['gf'] }),
    ing('almond-flour', 'Almond flour', ['volume', 'cup', 'cup', 'cups'], 'dry', { avoid: ['nut'] }),
    ing('bacon', 'Bacon', ['count', 'slice', 'slice', 'slices'], 'meat', { avoid: ['veg'] }),
    ing('eggs', 'Eggs', ['count', 'egg', 'egg', 'eggs'], 'dairy'),
    ing('oatmeal', 'Instant oatmeal', ['count', 'packet', 'packet', 'packets'], 'dry', { avoid: ['gf'] }),
    ing('gf-oatmeal', 'Gluten-free oatmeal', ['count', 'packet', 'packet', 'packets'], 'dry'),
    ing('oj', 'Orange juice', ['volume', 'cup', 'cup', 'cups'], 'dairy'),
    ing('bread', 'Bread', ['count', 'slice', 'slice', 'slices'], 'bakery', { avoid: ['gf'] })
  ],
  conversions: [] as MmConversionRow[],
  packages: [
    pkg('p-mix-10lb', 'pancake-mix', 'Krusteaz Pancake Mix, 10 lb', 15, 36, 'bag', { store: 'Costco' }),
    pkg('p-mix-krus', 'pancake-mix', 'Krusteaz Original, 32 oz', 6.49, 7, 'box'),
    pkg('p-alm-brm', 'almond-flour', 'Bob’s Red Mill Almond Flour, 1 lb', 8, 3, 'bag'),
    pkg('p-bac-kirk', 'bacon', 'Kirkland Hickory Smoked Bacon, 4 x 1 lb', 18.15, 80, 'pack', { store: 'Costco' }),
    pkg('p-bac-om', 'bacon', 'Oscar Mayer Bacon, 16 oz', 7.49, 16, 'pack'),
    pkg('p-egg-store', 'eggs', 'Store Brand White Eggs, dozen', 2.99, 12, 'dozen'),
    pkg('p-oat-q', 'oatmeal', 'Quaker Instant Oatmeal, 10 ct', 5, 10, 'box'),
    pkg('p-gfo-q', 'gf-oatmeal', 'Quaker GF Instant Oatmeal, 8 ct', 9, 8, 'box'),
    pkg('p-oj-gallon', 'oj', 'Orange juice, gallon', 8, null, 'gallon'),
    pkg('p-brd-kro', 'bread', 'Kroger White/Wheat', 1.99, 20, 'loaf')
  ],
  recipes: [
    recipeRow('B001', 'Pancakes', ['breakfast'], 1),
    recipeRow('B003', 'Bacon', ['breakfast'], 2),
    recipeRow('B014', 'Oatmeal', ['breakfast'], 3),
    recipeRow('B023', 'Orange juice', ['breakfast'], 4),
    recipeRow('L001', 'Sandwiches', ['lunch'], 5)
  ],
  lines: [
    line('B001', 1, 'pancake-mix', 0.5, 'except', 'gf'),
    line('B001', 2, 'almond-flour', 1, 'only', 'gf'),
    line('B001', 3, 'eggs', 1, 'only', 'gf'),
    line('B003', 1, 'bacon', 3),
    line('B014', 1, 'oatmeal', 1, 'except', 'gf'),
    line('B014', 2, 'gf-oatmeal', 1, 'only', 'gf'),
    line('B023', 1, 'oj', 1),
    line('L001', 1, 'bread', 2)
  ]
};
export const CATALOG = mapCatalog(ROWS);
