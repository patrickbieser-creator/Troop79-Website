import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import { buildSnapshot } from '../src/lib/menu-monster/menu-snapshot';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Outing } from '../src/lib/menu-monster/menu-view';

/**
 * Leader read-only view: the Plan tab, meal page and Shopping tab rendered with
 * `readOnly`. Values show as text; nothing edits, saves, or leaves a guard
 * behind; the rows still open to show details. The save action is a spy that
 * must never be called.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saveMenuAction = vi.fn();
const createMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a),
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';
import { MealEditor } from '../src/app/(public)/library/menu-monster/menus/_components/meal-editor';
import { ShoppingTab } from '../src/app/(public)/library/menu-monster/menus/_components/shopping-tab';

const OUTINGS: Outing[] = [{ id: 7, title: 'Fall Camporee', startDate: '2026-10-09', endDate: '2026-10-11', category: 'Campout / Overnight' }];
const VERSION = '2026-10-02T12:00:00.000Z';

const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: 7,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  freeItems: [],
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B014'], recipeEdits: {} },
    { id: 'm2', day: 1, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }
  ],
  ...over
});

const plan = () => <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={OUTINGS} readOnly plannedBy="Sam K." />;
const meal = () => <MealEditor catalog={CATALOG} menuId="menu-1" menu={menu()} mealId="m1" updatedAt={VERSION} readOnly plannedBy="Sam K." />;
const shopping = () => (
  <ShoppingTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} snapshot={buildSnapshot(menu(), CATALOG)} readOnly plannedBy="Sam K." />
);

const noEditing = () => {
  expect(screen.queryByRole('button', { name: /^(Save|Saved|Saving|Discard)/ })).toBeNull();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  expect(screen.queryAllByRole('button', { name: /^More for/ })).toHaveLength(0);
};

beforeEach(() => vi.clearAllMocks());

describe('Plan tab, read-only', () => {
  it('Leader_SeesNoEditingControls_OnThePlanTab', () => {
    render(plan());
    noEditing();
    expect(screen.queryByRole('button', { name: /Add a (day|meal)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('Leader_SeesWhoPlannedItAndReadOnly_OnTheTitleLine', () => {
    render(plan());
    expect(screen.getByText('Planned by Sam K. · Read-only')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Camporee food' })).toBeTruthy();
  });

  it('Leader_SeesPeopleAndDietsAsText_OnThePlanTab', () => {
    render(plan());
    expect(screen.getByText(/People: 8 · Gluten-free: 1/)).toBeTruthy();
  });

  it('Leader_SeesContextAndOutingAsText_OnThePlanTab', () => {
    render(plan());
    expect(screen.getByText('Camp · Fall Camporee')).toBeTruthy();
  });

  it('Leader_OpensAMeal_FromItsRowLink', () => {
    render(plan());
    expect(screen.getByRole('link', { name: 'Breakfast' }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/meals/m1');
  });
});

describe('Meal page, read-only', () => {
  it('Leader_SeesNoEditingControls_OnTheMealPage', () => {
    render(meal());
    noEditing();
    expect(screen.queryByRole('button', { name: /Reset to|Undo/ })).toBeNull();
  });

  it('Leader_SeesPlannedByAndPeopleAsText_OnTheMealPage', () => {
    render(meal());
    expect(screen.getByText('Planned by Sam K. · Read-only')).toBeTruthy();
    expect(screen.getByText(/People: 8/)).toBeTruthy();
  });

  it('Leader_OpensARecipesIngredients_AsPlainRows', async () => {
    render(meal());
    await userEvent.setup().click(screen.getAllByRole('button', { expanded: false })[0]);
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(2);
    noEditing();
    expect(screen.queryByRole('button', { name: /Add an ingredient/ })).toBeNull();
  });

  it('Leader_NeverSaves_OnTheMealPage', () => {
    render(meal());
    expect(saveMenuAction).not.toHaveBeenCalled();
  });
});

describe('Shopping tab, read-only', () => {
  it('Leader_SeesNoEditingControls_OnTheShoppingTab', () => {
    render(shopping());
    noEditing();
    expect(screen.queryByRole('button', { name: 'Update prices' })).toBeNull();
  });

  it('Leader_SeesPlannedBy_OnTheShoppingTab', () => {
    render(shopping());
    expect(screen.getByText('Planned by Sam K. · Read-only')).toBeTruthy();
  });

  it('Leader_OpensARowToSeeDetailsWithoutChoices_OnTheShoppingTab', async () => {
    render(shopping());
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { expanded: false })[0]);
    expect(screen.getByText(/^Needs /)).toBeTruthy();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(1); // only the Total to buy switch
    expect(screen.queryByRole('button', { name: 'Buying it' })).toBeNull();
    noEditing();
  });
});
