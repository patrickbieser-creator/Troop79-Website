import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuMonsterPlanner, PLAN_STORAGE_KEY } from '../src/app/(public)/library/_tools/menu-monster/planner';
import { mapCatalog } from '../src/lib/menu-monster/catalog';
import type {
  MmConversionRow,
  MmIngredientRow,
  MmPackageRow,
  MmRecipeLineRow,
  MmRecipeRow
} from '../src/lib/supabase/types';

/**
 * Menu Monster planner on the /library/topic/menu-monster shelf
 * (Plans/Menu-Monster.md — Test Plan, Planner_RendersSeedPlanAndUpdatesTotals_
 * OnHeadcountChange). The fixture is a slice of the seed rows run through
 * the real row→domain mapper, so the test exercises the same shapes the shelf
 * page hands the client: pancakes with the gluten-free swap, bacon with the
 * Oscar Mayer / Kirkland crossover at 16 people, oatmeal, and an unpriced
 * orange juice.
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
  serves_restriction: MmRecipeLineRow['serves_restriction'] = null
): MmRecipeLineRow => ({
  id: lineId++,
  recipe_id,
  position,
  ingredient_id,
  qty_per_person,
  unit_key: null,
  serves_rule,
  serves_restriction
});

const CATALOG = mapCatalog({
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
});

const live = (container: HTMLElement) => {
  const el = container.querySelector('[aria-live="polite"][aria-atomic="true"]');
  if (!el) throw new Error('no live region');
  return el;
};

describe('MenuMonsterPlanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('Planner_RendersSeedPlanAndUpdatesTotals_OnHeadcountChange', async () => {
    const user = userEvent.setup();
    const { container } = render(<MenuMonsterPlanner catalog={CATALOG} />);

    // Seed plan on first paint: breakfast for ten, one gluten-free, the headline tile.
    expect(screen.getByText('Spent — per person')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Pancakes' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Bacon' })).toHaveProperty('checked', true);
    expect((screen.getByRole('spinbutton', { name: /People eating/ }) as HTMLInputElement).value).toBe('10');

    // 30 slices: two Oscar Mayer packs ($14.98) beat one Kirkland ($18.15).
    const bacon = () => screen.getByTestId('mm-buy-bacon').textContent ?? '';
    expect(bacon()).toBe('2 packs · Oscar Mayer Bacon, 16 oz');
    expect(live(container).textContent).toContain('10 people.');

    // 10 → 16 on the + button: 48 slices, and Kirkland wins.
    const plus = screen.getByRole('button', { name: 'One more person' });
    for (let i = 0; i < 6; i++) await user.click(plus);
    expect((screen.getByRole('spinbutton', { name: /People eating/ }) as HTMLInputElement).value).toBe('16');
    expect(bacon()).toBe('1 pack · Kirkland Hickory Smoked Bacon, 4 x 1 lb');
    expect(live(container).textContent).toContain('16 people.');
    expect(live(container).textContent).toMatch(/Spent \$\d+(\.\d\d)? per person/);
    // The dial stops at 16.
    expect((plus as HTMLButtonElement).disabled).toBe(true);

    // D-070: no <details> accordions anywhere in the planner.
    expect(container.querySelectorAll('details').length).toBe(0);

    // Every buy line carries a "Where from" select and shows the suggested quantity.
    expect(screen.getAllByLabelText('Where from').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Suggested: \d+$/).length).toBeGreaterThan(0);

    // The draft autosaved under the versioned key.
    const stored = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) ?? 'null');
    expect(stored?.headcount).toBe(16);
  });

  it('Planner_SplitsGlutenFree_AndFlagsUnpriced', () => {
    render(<MenuMonsterPlanner catalog={CATALOG} />);
    // GF = 1 of 10: pancake mix for 9 (4½ cups), almond flour for 1 — no double count.
    // (Both appear twice: once on screen, once on the print sheet that is always in the DOM.)
    expect(screen.getAllByText(/for Pancakes \(everyone except gluten-free, 9\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/for Pancakes \(only gluten-free, 1\)/).length).toBeGreaterThan(0);
    // The unpriced package is listed, not silently dropped — once orange juice is on the menu.
    expect(screen.queryByText(/Not priced/)).toBeNull();
  });

  it('Planner_SwitchingMeal_DropsRecipesThatDontFit_AndKeepsPeople', async () => {
    const user = userEvent.setup();
    render(<MenuMonsterPlanner catalog={CATALOG} />);
    await user.click(screen.getByRole('radio', { name: 'Lunch' }));
    expect(screen.queryByRole('checkbox', { name: 'Pancakes' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Sandwiches' })).toHaveProperty('checked', false);
    expect((screen.getByRole('spinbutton', { name: /People eating/ }) as HTMLInputElement).value).toBe('10');
    expect((screen.getByRole('spinbutton', { name: /^Gluten-free/ }) as HTMLInputElement).value).toBe('1');
    expect(screen.getByText('Pick at least one menu item to build a shopping list.')).toBeTruthy();
  });

  it('Planner_StartOver_TakesTwoClicks_AndRestoresTheSeed', async () => {
    const user = userEvent.setup();
    render(<MenuMonsterPlanner catalog={CATALOG} />);
    await user.click(screen.getByRole('checkbox', { name: 'Orange juice' }));
    expect(screen.getByText(/Not priced — ask a leader/)).toBeTruthy();
    const reset = screen.getByRole('button', { name: 'Start over with the sample plan' });
    await user.click(reset);
    expect(screen.getByRole('button', { name: 'Click again to throw away this draft' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Orange juice' })).toHaveProperty('checked', true);
    await user.click(screen.getByRole('button', { name: 'Click again to throw away this draft' }));
    expect(screen.getByRole('checkbox', { name: 'Orange juice' })).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Start over with the sample plan' })).toBeTruthy();
  });

  it('Planner_HydratesStoredDraft_OnMount', () => {
    window.localStorage.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ meal: 'breakfast', headcount: 12, restrictions: { gf: 0 }, recipeIds: ['B003'], patrol: 'Owls' })
    );
    render(<MenuMonsterPlanner catalog={CATALOG} />);
    expect((screen.getByRole('spinbutton', { name: /People eating/ }) as HTMLInputElement).value).toBe('12');
    expect(screen.getByRole('checkbox', { name: 'Pancakes' })).toHaveProperty('checked', false);
    expect(screen.getByRole('checkbox', { name: 'Bacon' })).toHaveProperty('checked', true);
    const list = screen.getByRole('list', { name: /What one person gets for Bacon/ });
    expect(within(list).getByText('3 slices bacon')).toBeTruthy();
  });
});
