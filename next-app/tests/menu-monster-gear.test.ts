import { describe, it, expect } from 'vitest';
import { cleanGearEntry, cleanGearExtras, menuGearRows, packedSummary, parseGear, unknownGearNames, type GearItem, type MenuGearState } from '../src/lib/menu-monster/gear';
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

describe('the troop list grows by use', () => {
  it('UnknownGearNames_AreTheOnesTheListLacks_OncEach_WithoutCounts', () => {
    expect(unknownGearNames(['Skillet × 2', 'Wash bins × 3', 'wash bins', 'Water jug'], LIST)).toEqual(['Wash bins', 'Water jug']);
  });
});
