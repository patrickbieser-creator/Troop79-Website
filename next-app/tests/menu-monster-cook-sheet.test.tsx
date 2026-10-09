import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { CATALOG, ROWS } from './helpers/menu-monster-fixture';
import { mapCatalog } from '../src/lib/menu-monster/catalog';
import type { Menu } from '../src/lib/menu-monster/menus';
import { CookSheet } from '../src/app/(public)/library/menu-monster/menus/_components/cook-sheet';

/**
 * The printable cook sheet (Patrick, 2026-10-08: "Print out the meal plan for an event including the meals,
 * gear, recipe steps, etc. Reasonably compact. Fewer pages — multiple columns."): one menu, every day and meal,
 * each food's ingredients BY NAME (no quantities, no brands — "that is all on the shopping list; we just need the
 * big picture"), its steps (once), the meal's gear and diet notes. No prices. A single food is just its name.
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
const mealEl = (title: RegExp) => Array.from(document.querySelectorAll('h3')).find((el) => title.test(el.textContent ?? ''))?.parentElement as HTMLElement;
const mealBlock = (title: RegExp) => within(mealEl(title));

describe('CookSheet', () => {
  it('CookSheet_PrintsEveryDayAndMeal_InOrder', () => {
    sheet();
    expect(headings(1)).toEqual(['Camporee food']);
    expect(headings(2)).toEqual(['Day 1', 'Day 2']);
    expect(headings(3)).toEqual(['Breakfast', 'Lunch', 'Breakfast']);
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

  it('AMeal_RepeatsThePeopleCount_OnlyWhenItsOwnDiffers', () => {
    const m = menu();
    m.meals[1] = { ...m.meals[1], headcount: 12 };
    sheet(m);
    expect(headings(3)).toEqual(['Breakfast', 'Lunch · 12 people', 'Breakfast']);
  });

  it('ARecipe_ListsItsIngredientsByName_WithoutQuantities', () => {
    sheet();
    const list = mealBlock(/^Breakfast/).getByRole('list', { name: 'Oatmeal ingredients' });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items.some((t) => t.startsWith('Instant oatmeal'))).toBe(true);
    expect(items.some((t) => t.startsWith('Gluten-free oatmeal'))).toBe(true);
    expect(items.join(' ')).not.toMatch(/\d/);
  });

  it('ASingleFood_IsJustItsName_NeverTheNameTwice', () => {
    sheet();
    const first = mealBlock(/^Breakfast/);
    expect(first.queryByRole('list', { name: 'Bacon ingredients' })).toBeNull();
    expect(Array.from(mealEl(/^Breakfast/).querySelectorAll('h4')).filter((h) => h.textContent === 'Bacon')).toHaveLength(1);
  });

  it('AFood_PrintsItsSteps_Numbered', () => {
    sheet();
    const steps = mealBlock(/^Breakfast/).getByRole('list', { name: 'How to make Bacon' });
    expect(steps.tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lay the slices in a cold skillet.', 'Turn until crisp.']);
  });

  // Patrick, 2026-10-09: "instructions for each meal are listed at the end of the meal and not after each item" —
  // the big picture (foods, gear) first, then the steps, each group naming its food.
  it('AMeal_PrintsItsSteps_AfterEveryFoodAndTheGear', () => {
    sheet();
    const block = mealEl(/^Breakfast/);
    const steps = within(block).getByRole('list', { name: 'How to make Bacon' });
    const lastFood = within(block).getByRole('list', { name: 'Oatmeal ingredients' });
    const gear = block.querySelector('[data-cook-gear]') as HTMLElement;
    expect(lastFood.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gear.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AMealsSteps_NameTheFoodTheyAreFor', () => {
    sheet();
    const group = mealBlock(/^Breakfast/).getByRole('list', { name: 'How to make Bacon' }).parentElement as HTMLElement;
    expect(group.querySelector('[data-cook-steps-for]')?.textContent).toBe('Bacon');
  });

  it('ARepeatedRecipe_PrintsStepsOnce_AndPointsBack', () => {
    sheet();
    expect(document.body.textContent?.split('Lay the slices').length).toBe(2);
    expect(document.body.textContent).toContain('Bacon: see Day 1 · Breakfast');
  });

  it('AMeal_PrintsItsGear_OnOneLine', () => {
    sheet();
    const gear = Array.from(document.querySelectorAll('[data-cook-gear]')).map((el) => el.textContent ?? '');
    expect(gear).toHaveLength(2);
    expect(gear[0]).toMatch(/^Gear: /);
    for (const item of ['Camp stove', 'Long tongs', 'Skillet × 2']) expect(gear[0]).toContain(item);
    expect(gear[0].split('\n')).toHaveLength(1);
  });

  it('AMeal_WithDietPeople_PrintsTheDietLine_AndALeftOutMarker', () => {
    sheet();
    const first = mealBlock(/^Breakfast/);
    expect(first.getByText('Diets: 2 gluten-free')).toBeTruthy();
    expect(first.getByRole('list', { name: 'Oatmeal ingredients' }).textContent).toContain('left out');
  });

  // Patrick, 2026-10-09: "remove the 'everyone else' … leave the 'gluten-free' etc. notes as is."
  it('ADietLine_KeepsItsDietNote_ButTheRestOfTheTroopsLineSaysNothing', () => {
    sheet();
    const items = mealBlock(/^Breakfast/).getByRole('list', { name: 'Oatmeal ingredients' }).textContent ?? '';
    expect(items).toContain('gluten-free only');
    expect(document.body.textContent).not.toMatch(/everyone else/i);
  });

  it('AMeal_WithAnUnsafeFood_PrintsAWarningLine', () => {
    sheet();
    expect(mealBlock(/^Lunch/).getByText(/^⚠ 2 gluten-free: Sandwiches has /)).toBeTruthy();
  });

  it('TheSheet_ShowsNoPrices_AndNoBrands', () => {
    const catalog = withBacon(mapCatalog({ ...ROWS, brands: [{ id: 'br-kirk', ingredient_id: 'bacon', name: 'Kirkland Hickory', avoid: null, retired_at: null }] }));
    const m = menu();
    m.shopping = { ...m.shopping, brands: { bacon: [{ brandId: 'br-kirk', qty: null }] } };
    sheet(m, catalog);
    expect(document.body.textContent).not.toContain('$');
    expect(document.body.textContent).not.toContain('Kirkland');
  });

  it('AFoodTheViewerCannotSee_PrintsAPlaceholder', () => {
    sheet(menu({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['ZZZ'], recipeEdits: {} }] }));
    expect(document.body.textContent).toContain('A recipe that isn’t available');
  });
});
