import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { MAX_MENU_MEALS, type Menu } from '../src/lib/menu-monster/menus';
import { searchAddTargets } from '../src/lib/menu-monster/menu-search';

/**
 * Scout Workspace IA correction, item 2: what the per-day dashed search offers
 * for a typed query. Slot names offer an empty meal; recipe names offer one
 * result per slot the recipe fits.
 */

const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  freeItems: [],
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }],
  ...over
});

describe('searchAddTargets', () => {
  it('Scout_GetsNothing_WhenTheQueryIsBlank', () => {
    expect(searchAddTargets(CATALOG, menu(), 0, '  ')).toEqual([]);
  });

  it('Scout_GetsAnEmptyMealOffer_WhenTypingASlotNameTheDayLacks', () => {
    const [first] = searchAddTargets(CATALOG, menu(), 0, 'lun');
    expect(first).toMatchObject({ kind: 'slot', slot: 'lunch', label: 'Plan lunch — pick recipes on the meal page' });
  });

  it('Scout_GetsNoSlotOffer_WhenTheDayAlreadyHasThatMeal', () => {
    const slots = searchAddTargets(CATALOG, menu(), 0, 'break').filter((t) => t.kind === 'slot');
    expect(slots).toEqual([]);
  });

  it('Scout_SeesRecipeWithItsSlot_WhenTypingARecipeName', () => {
    const hit = searchAddTargets(CATALOG, menu(), 1, 'pancak')[0];
    expect(hit).toMatchObject({ kind: 'recipe', recipeId: 'B001', slot: 'breakfast', label: 'Pancakes · Breakfast' });
  });

  it('Scout_SeesAddsToExisting_WhenTheDayHasThatSlot', () => {
    const hit = searchAddTargets(CATALOG, menu(), 0, 'pancak')[0];
    expect(hit.sub).toBe('adds to breakfast');
  });

  it('Scout_SeesNewMeal_WhenTheDayLacksThatSlot', () => {
    const hit = searchAddTargets(CATALOG, menu(), 1, 'pancak')[0];
    expect(hit.sub).toBe('new breakfast');
  });

  it('Scout_IsNotOfferedARecipe_AlreadyOnThatDaysMealOfTheSlot', () => {
    expect(searchAddTargets(CATALOG, menu(), 0, 'bacon')).toEqual([]);
  });

  it('Scout_IsOfferedTheRecipe_OnAnotherDay', () => {
    expect(searchAddTargets(CATALOG, menu(), 1, 'bacon').map((t) => t.label)).toEqual(['Bacon · Breakfast']);
  });

  it('Scout_IsNotOfferedANewMeal_WhenTheMenuIsAtTheMealCap', () => {
    const meals = Array.from({ length: MAX_MENU_MEALS }, (_, i) => ({
      id: `x${i}`,
      day: 0,
      slot: 'dinner' as const,
      headcount: null,
      recipeIds: [],
      recipeEdits: {}
    }));
    expect(searchAddTargets(CATALOG, menu({ meals }), 1, 'pancak')).toEqual([]);
  });
});
