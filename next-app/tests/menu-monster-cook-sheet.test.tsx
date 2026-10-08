import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { CATALOG, ROWS } from './helpers/menu-monster-fixture';
import { mapCatalog } from '../src/lib/menu-monster/catalog';
import type { Menu } from '../src/lib/menu-monster/menus';
import { CookSheet } from '../src/app/(public)/library/menu-monster/menus/_components/cook-sheet';

/**
 * The printable cook sheet (Patrick, 2026-10-08: "Print out the meal plan for an event including the meals,
 * gear, recipe steps, etc. Reasonably compact. Fewer pages — multiple columns."): one menu, every day and meal,
 * each food's ingredients at the meal's headcount, its steps (once), the meal's gear and diet notes. No prices.
 */

const STEPS = 'Lay the slices in a cold skillet.\nTurn until crisp.';
const withBacon = (c = CATALOG) => ({
  ...c,
  recipes: c.recipes.map((r) => (r.id === 'B003' ? { ...r, stepsMd: STEPS, equipment: ['Camp stove', 'Skillet × 2', 'Long tongs'] } : r))
});

const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  patrol: 'Eagle',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [
    // Stored out of order on purpose: the sheet orders by day, then by slot.
    { id: 'm3', day: 1, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} },
    { id: 'm2', day: 0, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} },
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B014'], recipeEdits: { B014: [{ op: 'leave_out', ingredientId: 'oatmeal' }] } }
  ],
  ...over
});

const sheet = (m: Menu = menu(), catalog = withBacon(), plannedBy: string | null = 'the Eagle patrol') =>
  render(<CookSheet menu={m} catalog={catalog} plannedBy={plannedBy} />);
const headings = (level: number) => Array.from(document.querySelectorAll(`h${level}`)).map((h) => h.textContent);
const mealBlock = (title: RegExp) => {
  const h = Array.from(document.querySelectorAll('h3')).find((el) => title.test(el.textContent ?? ''));
  return within(h?.parentElement as HTMLElement);
};

describe('CookSheet', () => {
  it('CookSheet_PrintsEveryDayAndMeal_InOrder', () => {
    sheet();
    expect(headings(1)).toEqual(['Camporee food']);
    expect(headings(2)).toEqual(['Day 1', 'Day 2']);
    expect(headings(3)).toEqual(['Breakfast · 8 people', 'Lunch · 8 people', 'Breakfast · 8 people']);
  });

  it('TheHeader_PrintsPatrolPlannerDatesPeopleAndDiets', () => {
    sheet(menu({ startDate: '2026-10-09' }));
    const meta = document.querySelector('[data-cook-meta]')?.textContent ?? '';
    expect(meta).toContain('Eagle');
    expect(meta).toContain('the Eagle patrol');
    expect(meta).toContain('Fri, Oct 9 – Sat, Oct 10');
    expect(meta).toContain('8 people');
    expect(meta).toContain('2 gluten-free');
    expect(meta).not.toContain('nut-free');
  });

  it('AFood_ListsIngredients_AtTheMealsTotalAmounts', () => {
    const at = (headcount: number | null) => {
      const m = menu();
      m.meals[2] = { ...m.meals[2], headcount };
      const { unmount } = sheet(m);
      const text = mealBlock(/^Breakfast/).getByRole('table', { name: 'Bacon ingredients' }).textContent;
      unmount();
      return text;
    };
    expect(at(8)).toContain('24 slices');
    expect(at(16)).toContain('48 slices');
  });

  it('AFood_PrintsItsSteps_Numbered', () => {
    sheet();
    const first = mealBlock(/^Breakfast/);
    const items = first.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Lay the slices in a cold skillet.', 'Turn until crisp.']);
    expect(first.getAllByRole('list')[0].tagName).toBe('OL');
  });

  it('ARepeatedRecipe_PrintsStepsOnce_AndPointsBack', () => {
    sheet();
    expect(document.body.textContent?.split('Lay the slices').length).toBe(2);
    expect(document.body.textContent).toContain('Steps: see Day 1 · Breakfast');
  });

  it('AMeal_PrintsItsGear_OnOneLine', () => {
    sheet();
    const gear = Array.from(document.querySelectorAll('[data-cook-gear]')).map((el) => el.textContent);
    expect(gear[0]).toBe('Gear: Camp stove · Long tongs · Skillet × 2');
    expect(gear).toHaveLength(2);
  });

  it('AMeal_WithDietPeople_PrintsTheDietLine_AndALeftOutMarker', () => {
    sheet();
    const first = mealBlock(/^Breakfast/);
    expect(first.getByText('Diets: 2 gluten-free')).toBeTruthy();
    expect(first.getByRole('table', { name: 'Oatmeal ingredients' }).textContent).toContain('left out');
  });

  it('AMeal_WithAnUnsafeFood_PrintsAWarningLine', () => {
    sheet();
    expect(mealBlock(/^Lunch/).getByText(/^⚠ 2 gluten-free: Sandwiches has /)).toBeTruthy();
  });

  it('TheSheet_ShowsNoPrices', () => {
    sheet();
    expect(document.body.textContent).not.toContain('$');
  });

  it('AChosenBrand_PrintsBesideItsIngredient', () => {
    const catalog = withBacon(mapCatalog({ ...ROWS, brands: [{ id: 'br-kirk', ingredient_id: 'bacon', name: 'Kirkland Hickory', avoid: null, retired_at: null }] }));
    const m = menu();
    m.shopping = { ...m.shopping, brands: { bacon: [{ brandId: 'br-kirk', qty: null }] } };
    sheet(m, catalog);
    expect(mealBlock(/^Breakfast/).getByRole('table', { name: 'Bacon ingredients' }).textContent).toContain('Bacon · Kirkland Hickory');
  });

  it('AFoodTheViewerCannotSee_PrintsAPlaceholder', () => {
    sheet(menu({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['ZZZ'], recipeEdits: {} }] }));
    expect(document.body.textContent).toContain('A recipe that isn’t available');
  });
});
