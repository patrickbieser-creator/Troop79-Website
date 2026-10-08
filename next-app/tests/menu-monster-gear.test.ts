import { describe, it, expect } from 'vitest';
import { cleanGearEntry, cleanGearExtras, cleanMealGear, cleanMealGearOut, gearKey, gearMealSlots, gearPickOptions, mealGearEntries, mealRecipeGear, menuGearRows, packedSummary, parseGear, sortGear, unknownGearNames, withoutMealGear, type GearItem, type MenuGearState } from '../src/lib/menu-monster/gear';
import type { Catalog, Recipe } from '../src/lib/menu-monster/types';
import type { Menu, MenuMeal } from '../src/lib/menu-monster/menus';

/**
 * Menu Monster gear roll-up (Plans/Menu-Monster-Brands-Gear.md, release 2): reusable gear is shared, so a menu
 * needs the MOST any one food asks for, never the sum; per-person items follow People; a Packed tick stops
 * counting when the plan later changes that item.
 */
const recipe = (id: string, name: string, equipment: string[]): Recipe => ({
  id, name, status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0, lines: [], equipment
});
const CATALOG: Catalog = {
  ingredients: [], packages: [], conversions: [],
  recipes: [
    recipe('pancakes', 'Pancakes', ['Camp stove', 'Griddle', 'Spatula']),
    recipe('bacon', 'Bacon', ['Camp stove', 'Skillet', 'Long tongs']),
    recipe('eggs', 'Scrambled eggs', ['camp stove', 'Skillet × 2', 'Spatula']),
    recipe('apples', 'Apples', [])
  ]
};
const LIST: GearItem[] = [
  { id: 1, name: 'Troop mess kit', home: 'trailer', perPerson: true, retiredAt: null },
  { id: 2, name: 'Camp stove', home: 'trailer', perPerson: false, retiredAt: null },
  { id: 3, name: 'Griddle', home: 'trailer', perPerson: false, retiredAt: null },
  { id: 4, name: 'Skillet', home: 'trailer', perPerson: false, retiredAt: null },
  { id: 5, name: 'Spatula', home: 'patrol_box', perPerson: false, retiredAt: null },
  { id: 6, name: 'Long tongs', home: 'patrol_box', perPerson: false, retiredAt: null }
];
const meal = (id: string, recipeIds: string[], headcount: number | null = null): MenuMeal => ({ id, day: 0, slot: 'breakfast', headcount, recipeIds, recipeEdits: {} });
const menu = (meals: MenuMeal[], headcount = 8): Pick<Menu, 'meals' | 'headcount'> => ({ meals, headcount });
const NONE: MenuGearState = { extras: [], packed: {} };
const rowsOf = (m: Pick<Menu, 'meals' | 'headcount'>, state: MenuGearState = NONE) => menuGearRows(m, CATALOG, LIST, state);
const count = (m: Pick<Menu, 'meals' | 'headcount'>, name: string, state: MenuGearState = NONE) => rowsOf(m, state).find((r) => r.name === name)?.count;

describe('parseGear', () => {
  it.each([
    ['Skillet', 'Skillet', 1],
    ['Skillet × 2', 'Skillet', 2],
    ['Skillet x2', 'Skillet', 2],
    ['Dutch oven (12 in)', 'Dutch oven (12 in)', 1],
    ['Dutch oven (12 in) × 2', 'Dutch oven (12 in)', 2],
    ['  Long   tongs ', 'Long tongs', 1]
  ])('Reads %s', (text, name, n) => {
    expect(parseGear(text)).toEqual({ name, count: n });
  });

  it('CleanGearEntry_KeepsTheCount_InOneSpelling', () => {
    expect(cleanGearEntry('  Water   jug x 2')).toBe('Water jug × 2');
  });

  it('CleanGearExtras_KeepsOneOfEach_IgnoringCaseAndCount', () => {
    expect(cleanGearExtras(['Water jug', 'water jug × 2', '', 'Wash bins × 3'])).toEqual(['Water jug', 'Wash bins × 3']);
  });
});

describe('a menu’s gear', () => {
  it('TwoFoodsInOneMeal_ShareTheStove', () => {
    expect(count(menu([meal('m1', ['pancakes', 'bacon'])]), 'Camp stove')).toBe(1);
  });

  it('TwoMeals_ShareTheStove', () => {
    expect(count(menu([meal('m1', ['pancakes']), meal('m2', ['bacon'])]), 'Camp stove')).toBe(1);
  });

  it('TheBiggestAskWins_NotTheSum', () => {
    expect(count(menu([meal('m1', ['bacon', 'eggs'])]), 'Skillet')).toBe(2);
  });

  it('SpellingFollowsTheTroopList_WhateverTheRecipeTyped', () => {
    expect(rowsOf(menu([meal('m1', ['eggs'])])).map((r) => r.name)).toContain('Camp stove');
  });

  it('ARow_SaysWhichMealsAndFoodsNeedIt', () => {
    const row = rowsOf(menu([meal('m1', ['pancakes', 'eggs']), meal('m2', ['bacon'])])).find((r) => r.name === 'Spatula');
    expect(row?.usedBy).toEqual([{ mealId: 'm1', recipes: ['Pancakes', 'Scrambled eggs'] }]);
  });

  it('MessKits_AreOnePerPerson_AtTheBiggestMeal', () => {
    expect(count(menu([meal('m1', ['apples']), meal('m2', ['bacon'], 11)]), 'Troop mess kit')).toBe(11);
  });

  it('MessKits_FollowTheMenusPeople_WhenNoMealOverridesThem', () => {
    expect(count(menu([meal('m1', ['apples'])], 9), 'Troop mess kit')).toBe(9);
  });

  it('AnEmptyMenu_NeedsNoGear', () => {
    expect(rowsOf(menu([meal('m1', [])]))).toEqual([]);
  });

  it('Extras_AreTheirOwnRows_AndRemovable', () => {
    const row = rowsOf(menu([meal('m1', ['apples'])]), { extras: ['Water jug × 2'], packed: {} }).find((r) => r.name === 'Water jug');
    expect(row).toMatchObject({ count: 2, extra: true, home: 'trailer' });
  });

  it('AnExtraARecipeAlsoNames_IsOneRow_WithTheBiggerCount', () => {
    const rows = rowsOf(menu([meal('m1', ['bacon'])]), { extras: ['Skillet × 3'], packed: {} }).filter((r) => r.name === 'Skillet');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, extra: false });
  });

  it('Rows_AreGroupedByWhereTheyLive_ThenByName', () => {
    const rows = rowsOf(menu([meal('m1', ['pancakes'])]));
    expect(rows.map((r) => `${r.home}:${r.name}`)).toEqual(['trailer:Camp stove', 'trailer:Griddle', 'trailer:Troop mess kit', 'patrol_box:Spatula']);
  });
});

describe('gear for a meal (release 2)', () => {
  const withGear = (m: MenuMeal, gear: string[]): MenuMeal => ({ ...m, gear });

  it('MealGear_JoinsTheRecipeAndMenuGear_OneRowPerItem', () => {
    const m = menu([withGear(meal('m1', ['bacon']), ['Skillet × 3', 'Spatula'])]);
    const rows = rowsOf(m, { extras: ['Griddle'], packed: {} });
    expect(rows.map((r) => r.name).sort()).toEqual(['Camp stove', 'Griddle', 'Long tongs', 'Skillet', 'Spatula', 'Troop mess kit']);
    expect(rows.filter((r) => r.name === 'Skillet')).toHaveLength(1);
  });

  it('MealGear_KeepsTheMostNotTheSum_AcrossRecipeMealAndMenu', () => {
    // Recipe asks for 2 skillets, the meal 3, the menu 1: three, not six.
    const m = menu([withGear(meal('m1', ['eggs']), ['Skillet × 3'])]);
    expect(count(m, 'Skillet', { extras: ['Skillet'], packed: {} })).toBe(3);
  });

  it('AMealWithNoFood_CarriesItsGear', () => {
    const rows = rowsOf(menu([withGear(meal('m1', []), ['Spatula × 2'])]));
    expect(rows.find((r) => r.name === 'Spatula')).toMatchObject({ count: 2, extra: false });
  });

  it('AMealWithNoFood_StillOwesNoMessKits', () => {
    // The per-person rule stays tied to meals that cook.
    expect(rowsOf(menu([withGear(meal('m1', []), ['Spatula'])])).some((r) => r.perPerson)).toBe(false);
  });

  it('MealGear_AddsAUsedByEntryWithNoRecipes', () => {
    const row = rowsOf(menu([withGear(meal('m1', []), ['Spatula'])])).find((r) => r.name === 'Spatula');
    expect(row?.usedBy).toEqual([{ mealId: 'm1', recipes: [] }]);
  });

  it('MealGear_OnAMealWhoseFoodAlsoNeedsIt_KeepsTheFoodsListedOnce', () => {
    const row = rowsOf(menu([withGear(meal('m1', ['pancakes']), ['Spatula']), withGear(meal('m2', []), ['Spatula'])])).find((r) => r.name === 'Spatula');
    expect(row?.usedBy).toEqual([{ mealId: 'm1', recipes: ['Pancakes'] }, { mealId: 'm2', recipes: [] }]);
  });

  it('MealGear_IsNotARemovableMenuExtra', () => {
    expect(rowsOf(menu([withGear(meal('m1', []), ['Spatula'])])).find((r) => r.name === 'Spatula')?.extra).toBe(false);
  });

  it('CleanMealGear_IsCleanedDedupedSortedAndCapped', () => {
    expect(cleanMealGear(['Wash bin × 2', ' soap ', 'SOAP × 3', '', 7])).toEqual(['soap', 'Wash bin × 2']);
    expect(cleanMealGear(Array.from({ length: 40 }, (_, i) => `Thing ${String(i).padStart(2, '0')}`))).toHaveLength(30);
  });

  it('MealRecipeGear_IsTheMostEachFoodAsksFor_AToZ', () => {
    expect(mealRecipeGear(meal('m1', ['bacon', 'eggs']), CATALOG)).toEqual(['Camp stove', 'Long tongs', 'Skillet × 2', 'Spatula']);
  });

  it('WithoutMealGear_TakesTheNamedGearOffEveryMeal', () => {
    const m = menu([withGear(meal('m1', []), ['Spatula', 'Soap']), withGear(meal('m2', []), ['spatula × 2'])]);
    const next = withoutMealGear(m, ['Spatula']);
    expect(next.meals[0].gear).toEqual(['Soap']);
    expect(next.meals[1]).not.toHaveProperty('gear');
  });
});

describe('Packed ticks', () => {
  const tick = (n: number) => ({ count: n, by: 'Leo B.', personId: 5, at: '2026-10-03T18:00:00Z' });

  it('ATick_CountsWhileTheCountIsTheSame', () => {
    const row = rowsOf(menu([meal('m1', ['bacon'])]), { extras: [], packed: { skillet: tick(1) } }).find((r) => r.name === 'Skillet');
    expect([row?.packed?.by, row?.changed]).toEqual(['Leo B.', null]);
  });

  it('ATick_Clears_WhenThePlanChangesTheCount', () => {
    const row = rowsOf(menu([meal('m1', ['bacon', 'eggs'])]), { extras: [], packed: { skillet: tick(1) } }).find((r) => r.name === 'Skillet');
    expect([row?.packed, row?.changed?.count, row?.count]).toEqual([null, 1, 2]);
  });

  it('MessKitTick_Clears_WhenPeopleChange', () => {
    const state = { extras: [], packed: { 'troop mess kit': tick(8) } };
    expect(rowsOf(menu([meal('m1', ['apples'])], 9), state).find((r) => r.perPerson)?.packed).toBeNull();
  });

  it('Summary_CountsOnlyLiveTicks', () => {
    const rows = rowsOf(menu([meal('m1', ['bacon', 'eggs'])]), { extras: [], packed: { skillet: tick(1), 'camp stove': tick(1) } });
    expect(packedSummary(rows)).toEqual({ packed: 1, total: rows.length });
  });
});

// Since 2026-10-05 the list no longer grows by use (gear is picked from it); unknownGearNames is how a save finds what to drop.
describe('names the troop list lacks', () => {
  it('UnknownGearNames_AreTheOnesTheListLacks_OncEach_WithoutCounts', () => {
    expect(unknownGearNames(['Skillet × 2', 'Wash bins × 3', 'wash bins', 'Water jug'], LIST)).toEqual(['Wash bins', 'Water jug']);
  });
});

describe('picking gear from the master list', () => {
  const MASTER: GearItem[] = [
    ...LIST,
    { id: 7, name: 'Dutch oven', home: 'trailer', perPerson: false, retiredAt: null },
    { id: 8, name: 'Old griddle', home: 'trailer', perPerson: false, retiredAt: '2026-09-01T00:00:00Z' }
  ];
  const names = (q: string, taken: string[] = []) => gearPickOptions(MASTER, q, taken).map((g) => g.name);

  it('Options_AreSortedAToZ', () => {
    expect(names('')).toEqual(['Camp stove', 'Dutch oven', 'Griddle', 'Long tongs', 'Skillet', 'Spatula', 'Troop mess kit']);
  });

  it('Options_MatchTheQuery_AnywhereInTheName_IgnoringCase', () => {
    expect(names('  TON')).toEqual(['Long tongs']);
    expect(names('l')).toEqual(['Griddle', 'Long tongs', 'Skillet', 'Spatula']);
  });

  it('Options_LeaveOutWhatIsAlreadyTaken_WhateverTheCount', () => {
    expect(names('s', ['skillet × 2', 'Spatula'])).toEqual(['Camp stove', 'Long tongs', 'Troop mess kit']);
  });

  it('Options_NeverOfferARetiredItem', () => {
    expect(names('griddle')).toEqual(['Griddle']);
  });

  it('Options_NeverOfferToCreateOne_WhenNothingMatches', () => {
    expect(names('ladle')).toEqual([]);
  });
});

describe('sortGear', () => {
  it('SortsAToZ_ByName_IgnoringCaseAndCount_WithoutChangingTheEntries', () => {
    expect(sortGear(['spatula', 'Skillet × 2', 'Camp stove', 'Dutch oven'])).toEqual(['Camp stove', 'Dutch oven', 'Skillet × 2', 'spatula']);
  });

  it('IsStable_ForTheSameName', () => {
    expect(sortGear(['Pot × 2', 'pot'])).toEqual(['Pot × 2', 'pot']);
  });
});

describe('a meal’s one gear list (derived + added + left out)', () => {
  const m = (over: Partial<MenuMeal>): MenuMeal => ({ ...meal('m1', ['bacon', 'eggs']), ...over });
  const shown = (x: MenuMeal) => mealGearEntries(x, CATALOG).map((e) => `${e.name}|${e.count}|${e.kind}`);

  it('Gear_IsOneList_DerivedFirst_ThenAddedWithMarker', () => {
    expect(shown(m({ gear: ['Dish soap', 'Wash basin × 2'] }))).toEqual([
      'Camp stove|1|food',
      'Long tongs|1|food',
      'Skillet|2|food',
      'Spatula|1|food',
      'Dish soap|1|added',
      'Wash basin|2|added'
    ]);
  });

  it('AnOwnEntry_WithADerivedName_OverridesItsCount_AsChanged', () => {
    expect(shown(m({ gear: ['Skillet × 3'] }))).toContain('Skillet|3|changed');
  });

  it('AnOwnEntry_WithADerivedName_AppearsOnce', () => {
    expect(shown(m({ gear: ['skillet'] })).filter((e) => e.toLowerCase().startsWith('skillet'))).toHaveLength(1);
  });

  it('GearOut_LeavesADerivedItemOffTheList', () => {
    expect(shown(m({ gearOut: ['Long tongs'] })).some((e) => e.startsWith('Long tongs'))).toBe(false);
  });

  it('GearOut_IgnoredForAnItemTheMealOverrides', () => {
    expect(shown(m({ gear: ['Skillet × 3'], gearOut: ['Skillet'] }))).toContain('Skillet|3|changed');
  });

  it('CleanMealGearOut_KeepsNamesOnly_OneOfEach_AToZ_NotOnTheOwnList', () => {
    expect(cleanMealGearOut(['Spatula × 2', 'skillet', 'Skillet', 12, null, ''], ['Spatula'])).toEqual(['skillet']);
  });

  it('CleanMealGearOut_IsCappedAt30', () => {
    expect(cleanMealGearOut(Array.from({ length: 40 }, (_, i) => `Item ${i}`))).toHaveLength(30);
  });

  it('TheRollUp_HonoursALeftOutItem_AndACountOverride', () => {
    const rows = menuGearRows(menu([m({ gearOut: ['Long tongs'], gear: ['Skillet × 3'] })]), CATALOG, LIST, NONE);
    expect([rows.find((r) => r.name === 'Long tongs'), rows.find((r) => r.name === 'Skillet')?.count]).toEqual([undefined, 3]);
  });

  it('TheRollUp_LetsAMealLowerADerivedCount', () => {
    const rows = menuGearRows(menu([m({ gear: ['Skillet'] })]), CATALOG, LIST, NONE);
    expect(rows.find((r) => r.name === 'Skillet')?.count).toBe(1);
  });

  it('TheRollUp_KeepsAnItemAnotherMealStillNeeds', () => {
    const rows = menuGearRows(menu([m({ gearOut: ['Long tongs'] }), meal('m2', ['bacon'])]), CATALOG, LIST, NONE);
    expect(rows.find((r) => r.name === 'Long tongs')?.usedBy.map((u) => u.mealId)).toEqual(['m2']);
  });
});

describe('which meals use each gear item (Patrick, 2026-10-08)', () => {
  const at = (id: string, slot: MenuMeal['slot'], over: Partial<MenuMeal> = {}): MenuMeal => ({ ...meal(id, ['bacon']), slot, ...over });
  const slotsOf = (meals: MenuMeal[]) => gearMealSlots({ meals }, CATALOG);

  it('ACooler_OnTwoMeals_IsMarkedForBothInMealOrder', () => {
    expect(slotsOf([at('m2', 'lunch'), at('m1', 'breakfast')]).get(gearKey('Skillet'))).toEqual(['breakfast', 'lunch']);
  });

  it('AFoodsGear_LeftOutOnOneMeal_IsNotMarkedForThatMeal', () => {
    expect(slotsOf([at('m1', 'breakfast', { gearOut: ['Skillet'] }), at('m2', 'dinner')]).get(gearKey('Skillet'))).toEqual(['dinner']);
  });

  it('AMealsOwnAddedGear_CountsForThatMeal', () => {
    expect(slotsOf([at('m1', 'snack', { recipeIds: [], gear: ['Dish soap'] })]).get(gearKey('Dish soap'))).toEqual(['snack']);
  });

  it('TwoMealsInTheSameSlot_MarkTheSlotOnce', () => {
    expect(slotsOf([at('m1', 'lunch'), at('m2', 'lunch')]).get(gearKey('Skillet'))).toEqual(['lunch']);
  });
});
