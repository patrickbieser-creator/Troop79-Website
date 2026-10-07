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
const saveActualsAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a),
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a),
  saveActualsAction: (...a: unknown[]) => saveActualsAction(...a)
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';
import { PeopleTab } from '../src/app/(public)/library/menu-monster/menus/_components/people-tab';
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
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B014'], recipeEdits: {} },
    { id: 'm2', day: 1, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }
  ],
  ...over
});

const plan = () => <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={OUTINGS} readOnly plannedBy="Sam K." />;
/** A meal open inline on the read-only Plan tab (meals inline, 2026-10-03). */
const people = () => <PeopleTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={OUTINGS} readOnly plannedBy="Sam K." />;
const meal = (m: Menu = menu()) => <PlanTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} outings={OUTINGS} readOnly plannedBy="Sam K." openMeal="m1" />;
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

  it('Leader_SeesPeopleAndDietsAsText_OnTheWhosEatingStep', () => {
    render(people());
    expect([screen.getByText('People: 8'), screen.getByText('of whom Gluten-free: 1')]).toBeTruthy();
  });

  it('Leader_SeesContextAndOutingAsText_OnTheWhosEatingStep', () => {
    render(people());
    expect(screen.getByText('Camp · Fall Camporee')).toBeTruthy();
  });

  it('Leader_SeesNoWhosEatingValues_OnTheMealsStep', () => {
    render(plan());
    expect(screen.queryByText(/People: 8/)).toBeNull();
  });

  it('Leader_OpensAMeal_Inline_FromItsName', async () => {
    render(plan());
    await userEvent.setup().click(screen.getByRole('button', { name: /^Breakfast/ }));
    expect(screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' })).toBeTruthy();
    noEditing();
  });
});

describe('A meal open inline, read-only', () => {
  it('Leader_SeesNoEditingControls_OnTheMealPage', () => {
    render(meal());
    noEditing();
    expect(screen.queryByRole('button', { name: /Reset to|Undo/ })).toBeNull();
  });

  it('Leader_SeesPlannedByAndPeopleAsText_OnTheMealPage', () => {
    render(meal());
    expect(screen.getByText('Planned by Sam K. · Read-only')).toBeTruthy();
    expect(screen.getAllByText(/^8 people$/).length).toBeGreaterThan(0);
  });

  it('Leader_OpensARecipesIngredients_AsPlainRows', async () => {
    render(meal());
    await userEvent.setup().click(screen.getByRole('button', { name: /^Bacon/ }));
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
    // A row's name, not "the first collapsed button": the totals card now has a disclosure ahead of the list.
    await user.click(screen.getByRole('button', { name: /^Bacon/ }));
    expect(screen.getByText(/^Needs /)).toBeTruthy();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(1); // only the Total to buy switch
    expect(screen.queryByRole('button', { name: 'Buying it' })).toBeNull();
    noEditing();
  });
});

describe('A meal open inline, read-only: the scouts own edits', () => {
  const edited = () =>
    menu({
      meals: [
        { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: { B003: [{ op: 'leave_out', ingredientId: 'bacon' }] } },
        { id: 'm2', day: 1, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }
      ]
    });

  it('Leader_SeesLeftOutOnTheRow_TheScoutDropped', async () => {
    render(meal(edited()));
    await userEvent.setup().click(screen.getByRole('button', { name: /^Bacon/ }));
    expect(screen.getByText('Left out')).toBeTruthy();
  });
});

describe('Shopping tab, read-only: where a line comes from', () => {
  const sourced = (lineSource: Menu['shopping']['lineSource']) => (
    <ShoppingTab
      catalog={CATALOG}
      menuId="menu-1"
      menu={menu({ shopping: { packageChoice: {}, qtyOverride: {}, lineSource } })}
      updatedAt={VERSION}
      snapshot={null}
      readOnly
      plannedBy="Sam K."
    />
  );
  const openBacon = async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: /^Bacon/ }));
  };

  it('Leader_SeesBuyingIt_WhenTheLineIsBought', async () => {
    render(sourced({}));
    await openBacon();
    expect(screen.getByText('Where it comes from: Buying it')).toBeTruthy();
  });

  it('Leader_SeesFromHomeAndTheNote_WhenTheScoutBringsIt', async () => {
    render(sourced({ bacon: { source: 'home', note: 'Mom has some' } }));
    await openBacon();
    expect(screen.getByText('Where it comes from: Bringing from home · Mom has some')).toBeTruthy();
  });

  it('Leader_SeesTroopPantry_WhenTheLineComesFromThePantry', async () => {
    render(sourced({ bacon: { source: 'pantry', note: '' } }));
    await openBacon();
    expect(screen.getByText('Where it comes from: From the troop store room')).toBeTruthy();
  });
});
