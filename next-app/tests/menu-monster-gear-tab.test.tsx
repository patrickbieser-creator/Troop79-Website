import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The Gear tab (Plans/Menu-Monster-Brands-Gear.md, release 2): the packing list for the scouts who pull gear
 * while the planners plan. The mock boundary is the gear actions; the roll-up itself is proven in
 * menu-monster-gear.test.ts.
 */
const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const setGearPackedAction = vi.fn();
const setGearExtrasAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/gear-actions', () => ({
  setGearPackedAction: (...a: unknown[]) => setGearPackedAction(...a),
  setGearExtrasAction: (...a: unknown[]) => setGearExtrasAction(...a)
}));

import { GearTab } from '../src/app/(public)/library/menu-monster/menus/_components/gear-tab';
import type { GearItem, MenuGearState } from '../src/lib/menu-monster/gear';
import type { Catalog, Recipe } from '../src/lib/menu-monster/types';
import type { Menu } from '../src/lib/menu-monster/menus';

const recipe = (id: string, name: string, equipment: string[]): Recipe => ({
  id, name, status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0, lines: [], equipment
});
const CATALOG: Catalog = {
  ingredients: [], packages: [], conversions: [],
  recipes: [recipe('pancakes', 'Pancakes', ['Camp stove', 'Griddle', 'Spatula']), recipe('eggs', 'Scrambled eggs', ['Camp stove', 'Skillet × 2', 'Spatula'])]
};
const LIST: GearItem[] = [
  { id: 1, name: 'Troop mess kit', home: 'trailer', perPerson: true, retiredAt: null },
  { id: 2, name: 'Camp stove', home: 'trailer', perPerson: false, retiredAt: null },
  { id: 3, name: 'Griddle', home: 'trailer', perPerson: false, retiredAt: null },
  { id: 4, name: 'Skillet', home: 'trailer', perPerson: false, retiredAt: null },
  { id: 5, name: 'Spatula', home: 'patrol_box', perPerson: false, retiredAt: null },
  { id: 6, name: 'Water jug', home: 'trailer', perPerson: false, retiredAt: null }
];
const MENU: Menu = {
  name: 'Fall Campout', context: 'camp', calendarEntryId: 35, startDate: '2026-10-10', headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} }, actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['pancakes', 'eggs'], recipeEdits: {} }]
};
const NONE: MenuGearState = { extras: [], packed: {} };
const tab = (over: Partial<Parameters<typeof GearTab>[0]> = {}) => (
  <GearTab catalog={CATALOG} menuId="menu-1" menu={MENU} gearList={LIST} state={NONE} canPack canEdit viewerName="Leo B." {...over} />
);
const rowFor = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  setGearPackedAction.mockResolvedValue({ ok: true });
  setGearExtrasAction.mockImplementation(async (_id: string, extras: string[]) => ({ ok: true, extras, dropped: [] }));
});

describe('Gear tab descriptions', () => {
  it('OpenRow_ShowsTheItemsDescription_WhenItHasOne', async () => {
    const list = LIST.map((g) => (g.name === 'Griddle' ? { ...g, description: 'Flat iron, 4th floor shelf' } : g));
    render(tab({ gearList: list }));
    expect(screen.queryByText('Flat iron, 4th floor shelf')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Griddle/ }));
    expect(within(rowFor('Griddle')).getByText('Flat iron, 4th floor shelf')).toBeTruthy();
  });
});

describe('Gear tab meal letters (Patrick, 2026-10-08)', () => {
  const slotsOf = (name: string) => Array.from(rowFor(name).querySelectorAll('[data-slot]')).map((el) => `${el.getAttribute('data-slot')}:${el.textContent}`);

  it('AnItem_ShowsTheLettersOfTheMealsThatUseIt_AndPerPersonGearStaysBlank', () => {
    const menu: Menu = { ...MENU, meals: [...MENU.meals, { id: 'm2', day: 0, slot: 'dinner', headcount: null, recipeIds: ['eggs'], recipeEdits: {} }] };
    render(tab({ menu }));
    expect(slotsOf('Griddle')).toEqual(['breakfast:B', 'lunch:', 'dinner:', 'snack:', 'dessert:']);
    expect(slotsOf('Spatula')).toEqual(['breakfast:B', 'lunch:', 'dinner:D', 'snack:', 'dessert:']);
    expect(within(rowFor('Spatula')).getByText('Used at Breakfast, Dinner')).toBeTruthy();
    expect(slotsOf('Troop mess kit').map((x) => x.split(':')[1]).join('')).toBe('');
  });
});

describe('Gear tab', () => {
  it('Lists_GroupedByWhereItLives', () => {
    render(tab());
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['4th Floor NWS', 'Patrol box']);
    expect(within(screen.getByRole('list', { name: 'Patrol box' })).getByRole('button', { name: /^Spatula/ })).toBeTruthy();
  });

  it('Count_IsTheMostOneFoodNeeds_AndMessKitsFollowPeople', () => {
    render(tab());
    expect(rowFor('Skillet').textContent).toContain('× 2');
    expect(rowFor('Troop mess kit').textContent).toContain('× 8');
    expect(rowFor('Camp stove').textContent).not.toContain('×');
  });

  it('OpeningARow_SaysWhichMealAndFoodsNeedIt', async () => {
    render(tab());
    await userEvent.setup().click(screen.getByRole('button', { name: /^Spatula/ }));
    expect(within(screen.getByRole('list', { name: 'What needs Spatula' })).getByText('Saturday breakfast: Pancakes, Scrambled eggs')).toBeTruthy();
  });

  it('TwoRows_StayOpenTogether', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Spatula/ }));
    await user.click(screen.getByRole('button', { name: /^Troop mess kit/ }));
    expect([screen.getByRole('list', { name: 'What needs Spatula' }) != null, screen.getByText('One per person.') != null]).toEqual([true, true]);
  });

  it('Ticking_SavesAtOnce_WithTheCount_AndShowsWho', async () => {
    render(tab());
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Skillet packed' }));
    await waitFor(() => expect(setGearPackedAction).toHaveBeenCalledWith('menu-1', 'skillet', 2, true));
    expect(rowFor('Skillet').textContent).toContain('Leo B.');
    expect(screen.getByText('1 of 5 packed')).toBeTruthy();
  });

  it('ATick_ThatFailsToSave_IsUndone_AndSaysWhy', async () => {
    setGearPackedAction.mockResolvedValue({ ok: false, error: 'Sign in as a scout on this outing to tick gear off.' });
    render(tab());
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Skillet packed' }));
    expect(await screen.findByText('Sign in as a scout on this outing to tick gear off.')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Skillet packed' }) as HTMLInputElement).checked).toBe(false);
  });

  it('ATickMadeAtAnotherCount_IsCleared_AndTheRowSaysSo', async () => {
    render(tab({ state: { extras: [], packed: { skillet: { count: 1, by: 'Maya O.', personId: 9, at: '2026-10-03T18:00:00Z' } } } }));
    expect((screen.getByRole('checkbox', { name: 'Skillet packed' }) as HTMLInputElement).checked).toBe(false);
    expect(rowFor('Skillet').textContent).toContain('Now 2, was 1');
    await userEvent.setup().click(screen.getByRole('button', { name: /^Skillet/ }));
    expect(screen.getByText('The plan changed after Maya O. packed it, so the tick was cleared.')).toBeTruthy();
  });

  // Was AddGear_SavesTheMenusExtras (typed "Water jug x 2" and Enter): since 2026-10-05 gear is picked from the
  // troop's list, so there is no typed name and no count here.
  it('AddGear_PicksFromTheMasterList_AndSavesTheMenusExtras', async () => {
    render(tab());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ Gear' }));
    await user.keyboard('wat{Enter}');
    await waitFor(() => expect(setGearExtrasAction).toHaveBeenCalledWith('menu-1', ['Water jug']));
    expect(rowFor('Water jug')).toBeTruthy();
  });

  it('AddGear_OffersOnlyUnusedMasterItems_AToZ_AndNeverACreateRow', async () => {
    const user = userEvent.setup();
    render(tab({ gearList: [...LIST, { id: 7, name: 'Apron', home: 'home', perPerson: false, retiredAt: null }, { id: 8, name: 'Old tarp', home: 'home', perPerson: false, retiredAt: '2026-09-01T00:00:00Z' }] }));
    await user.click(screen.getByRole('button', { name: '+ Gear' }));
    // Everything already on the menu (recipes' gear, the mess kit) is left out; a retired item is never offered.
    expect(within(screen.getByRole('listbox', { name: 'Gear on the list' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Apron', 'Water jug']);
    await user.type(screen.getByRole('combobox', { name: 'Add gear' }), 'ladle');
    expect([screen.queryAllByRole('option').length, screen.queryByText(/^Add “/)]).toEqual([0, null]);
    expect(screen.getByText(/Nothing on the gear list matches “ladle”/)).toBeTruthy();
  });

  it('AddGear_SaysWhatTheServerDropped', async () => {
    setGearExtrasAction.mockResolvedValue({ ok: true, extras: [], dropped: ['Water jug'] });
    render(tab());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ Gear' }));
    await user.keyboard('wat{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('Not on the gear list, so not kept: Water jug.');
  });

  it('AnExtra_CanBeRemoved_ARecipesGearCannot', async () => {
    const user = userEvent.setup();
    render(tab({ state: { extras: ['Water jug'], packed: {} } }));
    await user.click(screen.getByRole('button', { name: /^Spatula/ }));
    expect(screen.queryByRole('button', { name: 'Remove from this menu' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Water jug/ }));
    await user.click(screen.getByRole('button', { name: 'Remove from this menu' }));
    await waitFor(() => expect(setGearExtrasAction).toHaveBeenCalledWith('menu-1', []));
  });

  it('Crew_TicksButCannotAddGear', () => {
    render(tab({ canEdit: false }));
    expect([screen.getAllByRole('checkbox').length > 0, screen.queryByRole('button', { name: '+ Gear' })]).toEqual([true, null]);
  });

  it('AReader_SeesWhoPacked_WithNoTickBoxes', () => {
    render(tab({ canPack: false, canEdit: false, state: { extras: [], packed: { skillet: { count: 2, by: 'Maya O.', personId: 9, at: '2026-10-03T18:00:00Z' } } } }));
    expect([screen.queryAllByRole('checkbox').length, rowFor('Skillet').textContent?.includes('Packed · Maya O.')]).toEqual([0, true]);
  });

  it('ASharedViewer_SeesPacked_WithoutTheScoutsName', () => {
    render(tab({ canPack: false, canEdit: false, state: { extras: [], packed: { skillet: { count: 2, by: '', personId: null, at: '2026-10-03T18:00:00Z' } } } }));
    expect(rowFor('Skillet').textContent).toMatch(/Packed[^×]*×/);
  });

  it('AnEmptyMenu_SaysWhereGearComesFrom', () => {
    render(tab({ menu: { ...MENU, meals: [] } }));
    expect(screen.getByText('Nothing to pack yet. Gear shows up here as food goes on the Plan tab.')).toBeTruthy();
  });
});

describe('Gear tab: gear for a meal (release 2)', () => {
  const WITH_MEAL_GEAR: Menu = { ...MENU, meals: [...MENU.meals, { id: 'm2', day: 0, slot: 'lunch', headcount: null, recipeIds: [], recipeEdits: {}, gear: ['Water jug × 2'] }] };

  it('AMealGearRow_SaysItWasAddedToThatMeal_AndCountsEvenWithNoFoodOnIt', async () => {
    render(tab({ menu: WITH_MEAL_GEAR }));
    expect(rowFor('Water jug').textContent).toContain('× 2');
    await userEvent.setup().click(screen.getByRole('button', { name: /^Water jug/ }));
    expect(within(screen.getByRole('list', { name: 'What needs Water jug' })).getByText('Saturday lunch: Added to this meal')).toBeTruthy();
  });

  it('AMealGearRow_IsNotARemovableMenuExtra', async () => {
    render(tab({ menu: WITH_MEAL_GEAR }));
    await userEvent.setup().click(screen.getByRole('button', { name: /^Water jug/ }));
    expect(screen.queryByRole('button', { name: 'Remove from this menu' })).toBeNull();
  });

  it('TheMealGearItem_IsLeftOutOfTheMenuLevelPicker', async () => {
    const user = userEvent.setup();
    render(tab({ menu: WITH_MEAL_GEAR }));
    await user.click(screen.getByRole('button', { name: '+ Gear' }));
    expect(screen.queryByRole('option', { name: 'Water jug' })).toBeNull();
  });
});

describe('Gear tab honours a meal’s own changes to its foods’ gear', () => {
  const withMeal = (over: object): Menu => ({ ...MENU, meals: [{ ...MENU.meals[0], ...over }] });

  it('DerivedGear_CanBeLeftOut_AndTheGearStepHonoursIt', () => {
    render(tab({ menu: withMeal({ gearOut: ['Griddle'] }) }));
    expect([screen.queryByRole('button', { name: /^Griddle/ }), screen.queryByRole('button', { name: /^Spatula/ }) != null]).toEqual([null, true]);
  });

  it('DerivedGear_CountOverride_ShowsInTheGearStep', () => {
    render(tab({ menu: withMeal({ gear: ['Skillet × 4'] }) }));
    expect(rowFor('Skillet').textContent).toContain('× 4');
  });
});
