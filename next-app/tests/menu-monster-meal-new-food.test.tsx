import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';

/**
 * "Add a food on the fly from a meal" (Patrick, 2026-10-06, Kool-Aid): when the search finds nothing the
 * list offers "Add “x” as a new food…", which opens MealNewFood inline under the search — a tinted dialog
 * that needs a name and a Kind of food and nothing else. An incomplete click marks the field in place and
 * says "Can’t save yet: …" (the save-button standard); a name the price book has offers the existing food.
 * The server action is a stub (menu-monster-menu-actions / -db tests cover it).
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const addFoodToMealAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: vi.fn(),
  addMenuIngredientAction: vi.fn(),
  addFoodToMealAction: (...a: unknown[]) => addFoodToMealAction(...a)
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';

const menu = (): Menu => ({
  name: 'Friday snack',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} },
    { id: 'm2', day: 0, slot: 'lunch', headcount: null, recipeIds: [], recipeEdits: {} }
  ]
});

const editor = (props: { readOnly?: boolean; menuId?: string | null } = {}) => (
  <PlanTab catalog={CATALOG} menuId={props.menuId === undefined ? 'menu-1' : props.menuId} menu={menu()} updatedAt="2026-10-02T12:00:00.000Z" outings={[]} openMeal="m2" readOnly={props.readOnly} />
);
const meal = () => within(document.getElementById('mm-meal-m2') as HTMLElement);
const search = () => meal().getByRole('combobox');
const ADD = 'Add “Kool-Aid” as a new food…';

async function openPanel(user: ReturnType<typeof userEvent.setup>, typed = 'Kool-Aid') {
  await user.click(search());
  await user.type(search(), typed);
  await user.click(screen.getByRole('option', { name: `Add “${typed}” as a new food…` }));
  return screen.getByRole('dialog', { name: /as a new food$|already on the list$/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  addFoodToMealAction.mockResolvedValue({ ok: true, ingredientId: 'x-0000beef', recipeId: 'S-0000beef', name: 'Kool-Aid' });
});

describe('the no-match option', () => {
  it('Search_OffersAddingAsANewFood_WhenNothingMatches', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(search());
    await user.type(search(), 'Kool-Aid');
    expect(screen.getByRole('option', { name: ADD })).toBeTruthy();
  });

  it('Search_DoesNotOfferIt_BeforeAnythingIsTyped', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(search());
    expect(screen.queryByRole('option', { name: /as a new food/ })).toBeNull();
  });

  it('Search_ArrowDown_ReachesTheOption_ThenBrowse', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(search());
    await user.type(search(), 'Kool-Aid{ArrowDown}{Enter}');
    expect(screen.getByRole('dialog', { name: /as a new food$/ })).toBeTruthy();
  });

  it('Search_DoesNotOfferIt_ToAMenuKeptOnThisComputer', async () => {
    const user = userEvent.setup();
    render(editor({ menuId: null }));
    await user.click(search());
    await user.type(search(), 'Kool-Aid');
    expect(screen.queryByRole('option', { name: ADD })).toBeNull();
  });

  it('ReadOnlyViewer_HasNoSearchAtAll', () => {
    render(editor({ readOnly: true }));
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('the inline panel', () => {
  it('Panel_IsANonModalDialog_NamedForTheFood', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    expect([dialog.getAttribute('aria-modal'), within(dialog).getByRole('heading').textContent]).toEqual(['false', 'Add “Kool-Aid” as a new food']);
  });

  it('Panel_PrefillsTheName_AndPicksNoKindOfFood', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    expect([(within(dialog).getByLabelText('Name') as HTMLInputElement).value, (within(dialog).getByLabelText('Kind of food') as HTMLSelectElement).value]).toEqual(['Kool-Aid', '']);
  });

  it('KindOfFood_OffersEverySectionIncludingBeverages', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    const labels = Array.from((within(dialog).getByLabelText('Kind of food') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(['Pick one…', 'Meat', 'Dairy & eggs', 'Beverages', 'Produce', 'Bakery', 'Dry goods & pantry']);
  });

  it('Panel_ShowsTheOptionalDetails_OpenOnADesktop', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    expect(within(dialog).getByRole('button', { name: 'More, if you know it' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('Cancel_ClosesThePanel_AndSavesNothing', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect([screen.queryByRole('dialog', { name: /as a new food$/ }), addFoodToMealAction.mock.calls.length]).toEqual([null, 0]);
  });
});

describe('Add food', () => {
  it('MissingKind_SavesNothing_AndSaysWhy', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    expect(addFoodToMealAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Can’t save yet: pick what kind of food it is/)).toBeTruthy();
  });

  it('MissingKind_MarksTheFieldInPlace', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    const select = within(dialog).getByLabelText('Kind of food');
    expect([select.getAttribute('aria-invalid'), within(dialog).getByText('Pick what kind of food it is.')]).toEqual(['true', expect.anything()]);
  });

  it('AddFood_IsNeverGreyed_ForAnIncompleteForm', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    expect((within(dialog).getByRole('button', { name: 'Add food' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('MarkClears_OncePickedAndSaved', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    expect(within(dialog).getByLabelText('Kind of food').getAttribute('aria-invalid')).toBeNull();
  });

  it('PriceWithoutSize_IsRefused_InPlace', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    await user.type(within(dialog).getByLabelText('Estimated price'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    expect(addFoodToMealAction).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('One package holds').getAttribute('aria-invalid')).toBe('true');
  });

  it('Success_SendsTheBasics_WithNoPackage', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    expect(addFoodToMealAction.mock.calls[0][0]).toMatchObject({
      ingredient: { name: 'Kool-Aid', section: 'beverage', kind: 'count', size: 0, price: 0 },
      eachPerson: 1,
      mealSlot: 'lunch'
    });
  });

  it('Success_SendsThePackage_WhenKnown', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    await user.type(within(dialog).getByLabelText('One package holds'), '8');
    await user.type(within(dialog).getByLabelText('Estimated price'), '$3.50');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    expect(addFoodToMealAction.mock.calls[0][0]).toMatchObject({ ingredient: { size: 8, price: 3.5 } });
  });

  it('Success_PutsTheFoodOnTheMeal_AtOnce_WithNoPriceYet', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    const list = await screen.findByRole('list', { name: 'Recipes in Day 1 lunch' });
    const row = within(list).getByRole('button', { name: /^Kool-Aid/ }).closest('li') as HTMLElement;
    expect(within(row).getByText('No price yet')).toBeTruthy();
  });

  it('Success_AnnouncesIt_AndClosesThePanel', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    const status = await screen.findByText(/Kool-Aid added to this meal as your new food — a leader will check it later\. Set how much each person needs if it isn’t right\./);
    expect([status.getAttribute('role'), screen.queryByRole('dialog', { name: /as a new food$/ })]).toEqual(['status', null]);
  });

  it('Refusal_ShowsTheReason_AndKeepsThePanelOpen', async () => {
    const user = userEvent.setup();
    addFoodToMealAction.mockResolvedValue({ ok: false, error: 'You have 10 new ingredients waiting for a leader to check them.' });
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    expect(await within(dialog).findByText(/10 new ingredients waiting/)).toBeTruthy();
  });
});

describe('a name the price book already has', () => {
  it('Panel_SaysItIsAlreadyOnTheList_AndAddsTheExistingOne', async () => {
    const user = userEvent.setup();
    render(editor());
    // Orange juice is a breakfast recipe, so lunch's search finds nothing and offers a new one.
    const dialog = await openPanel(user, 'Orange juice');
    expect(within(dialog).getByRole('heading').textContent).toBe('Orange juice is already on the list');
    await user.click(within(dialog).getByRole('button', { name: 'Add Orange juice to this meal' }));
    expect(addFoodToMealAction).not.toHaveBeenCalled();
    const list = screen.getByRole('list', { name: 'Recipes in Day 1 lunch' });
    expect(within(list).getByRole('button', { name: /^Orange juice/ })).toBeTruthy();
  });

  it('ATypedNameThatMatchesAfterwards_SwitchesToTheExistingFood', async () => {
    const user = userEvent.setup();
    render(editor());
    const dialog = await openPanel(user);
    await user.selectOptions(within(dialog).getByLabelText('Kind of food'), 'beverage');
    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'orange JUICE');
    await user.click(within(dialog).getByRole('button', { name: 'Add food' }));
    expect(addFoodToMealAction).not.toHaveBeenCalled();
    expect(screen.getByText('Orange juice is already on the list')).toBeTruthy();
  });
});
