import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Recipe } from '../src/lib/menu-monster/types';
import {
  applyRecipeEdits,
  mealCatalog,
  sanitizeMenu,
  type EditOp,
  type MenuMeal
} from '../src/lib/menu-monster/menus';

/**
 * Scout Workspace slice 4b: meals[].recipeEdits is reserved now (Phase 2 adds
 * the UI). sanitizeMenu validates it; applyRecipeEdits() is the one pure
 * function that turns a recipe + a menu's ops into the lines the engine reads.
 */

const raw = (recipeEdits: unknown, recipeIds: string[] = ['B003', 'B001']) => ({
  name: 'Camporee',
  headcount: 8,
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds, recipeEdits }]
});
const edits = (recipeEdits: unknown, recipeIds?: string[]) => sanitizeMenu(raw(recipeEdits, recipeIds), CATALOG).meals[0].recipeEdits;

const bacon = CATALOG.recipes.find((r) => r.id === 'B003') as Recipe;
const pancakes = CATALOG.recipes.find((r) => r.id === 'B001') as Recipe;

describe('sanitizeMenu recipeEdits', () => {
  it('RecipeEdits_AreEmpty_WhenTheMealHasNone', () => {
    expect(edits(undefined)).toEqual({});
  });

  it('RecipeEdits_KeepAmountSwapLeaveOutAndAdd', () => {
    const ops: EditOp[] = [
      { op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 },
      { op: 'swap', ingredientId: 'pancake-mix', to: 'bread', qtyPerPerson: 1 },
      { op: 'leave_out', ingredientId: 'eggs' },
      { op: 'add', ingredientId: 'oj', qtyPerPerson: 1 }
    ];
    expect(edits({ B001: ops })).toEqual({ B001: ops });
  });

  it('RecipeEdits_DropAnUnknownRecipe', () => {
    expect(edits({ NOPE: [{ op: 'leave_out', ingredientId: 'bacon' }] })).toEqual({});
  });

  it('RecipeEdits_DropARecipeThatIsNotOnTheMeal', () => {
    expect(edits({ B014: [{ op: 'leave_out', ingredientId: 'oatmeal' }] })).toEqual({});
  });

  it('RecipeEdits_DropAnOpWithAnUnknownIngredient', () => {
    expect(edits({ B003: [{ op: 'leave_out', ingredientId: 'nope' }] })).toEqual({});
  });

  it('RecipeEdits_DropASwapWhoseReplacementIsUnknown', () => {
    expect(edits({ B003: [{ op: 'swap', ingredientId: 'bacon', to: 'nope', qtyPerPerson: 1 }] })).toEqual({});
  });

  it('RecipeEdits_DropAnOpWithAnUnusableQuantity', () => {
    const bad = [0, -1, 'lots', null].map((q) => ({ op: 'amount', ingredientId: 'bacon', qtyPerPerson: q }));
    expect(edits({ B003: bad })).toEqual({});
  });

  it('RecipeEdits_DropAnUnknownOpKind', () => {
    expect(edits({ B003: [{ op: 'explode', ingredientId: 'bacon' }, 'junk', null] })).toEqual({});
  });

  it('RecipeEdits_KeepTheLastOp_WhenAnIngredientIsEditedTwice', () => {
    const ops = [
      { op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 },
      { op: 'amount', ingredientId: 'bacon', qtyPerPerson: 4 }
    ];
    expect(edits({ B003: ops })).toEqual({ B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 4 }] });
  });

  it('RecipeEdits_DropARecipesKeyWhenNoOpSurvives', () => {
    expect(Object.keys(edits({ B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: -3 }] }))).toEqual([]);
  });

  it('RecipeEdits_AreNotAnArray_WhenGarbageIsSent', () => {
    expect(edits('junk')).toEqual({});
  });
});

describe('applyRecipeEdits', () => {
  it('Recipe_IsUnchanged_WhenThereAreNoOps', () => {
    expect(applyRecipeEdits(bacon, [])).toEqual(bacon.lines);
  });

  it('Amount_ChangesTheQuantityAndKeepsTheServesRule', () => {
    const [line] = applyRecipeEdits(pancakes, [{ op: 'amount', ingredientId: 'pancake-mix', qtyPerPerson: 1 }]);
    expect(line).toEqual({ ...pancakes.lines[0], qtyPerPerson: 1 });
  });

  it('Swap_ReplacesTheIngredientAndQuantity_KeepingTheServesRule', () => {
    const [line] = applyRecipeEdits(pancakes, [{ op: 'swap', ingredientId: 'pancake-mix', to: 'bread', qtyPerPerson: 2 }]);
    expect(line).toMatchObject({ ingredientId: 'bread', qtyPerPerson: 2, unitKey: null, servesRule: 'except', servesRestrictions: ['gf'] });
  });

  it('LeaveOut_RemovesEveryLineOfThatIngredient', () => {
    const lines = applyRecipeEdits(pancakes, [{ op: 'leave_out', ingredientId: 'eggs' }]);
    expect(lines.map((l) => l.ingredientId)).toEqual(['pancake-mix', 'almond-flour']);
  });

  it('Add_AppendsALineForEveryone', () => {
    const lines = applyRecipeEdits(bacon, [{ op: 'add', ingredientId: 'oj', qtyPerPerson: 1 }]);
    expect(lines[lines.length - 1]).toEqual({ ingredientId: 'oj', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] });
  });

  it('Edit_IsIgnored_WhenTheRecipeHasNoSuchIngredient', () => {
    expect(applyRecipeEdits(bacon, [{ op: 'leave_out', ingredientId: 'eggs' }])).toEqual(bacon.lines);
  });

  it('Recipe_ItselfIsNeverMutated', () => {
    const before = JSON.stringify(pancakes);
    applyRecipeEdits(pancakes, [{ op: 'leave_out', ingredientId: 'eggs' }, { op: 'amount', ingredientId: 'pancake-mix', qtyPerPerson: 3 }]);
    expect(JSON.stringify(pancakes)).toBe(before);
  });
});

describe('mealCatalog', () => {
  const meal = (recipeEdits: MenuMeal['recipeEdits']): MenuMeal => ({
    id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], packageChoice: {}, qtyOverride: {}, lineSource: {}, recipeEdits
  });

  it('Catalog_IsTheSameObject_WhenTheMealHasNoEdits', () => {
    expect(mealCatalog(CATALOG, meal({}))).toBe(CATALOG);
  });

  it('Catalog_CarriesTheEditedLines_ForTheEditedRecipeOnly', () => {
    const cat = mealCatalog(CATALOG, meal({ B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 1 }] }));
    expect([cat.recipes.find((r) => r.id === 'B003')?.lines[0].qtyPerPerson, cat.recipes.find((r) => r.id === 'B001')]).toEqual([1, pancakes]);
  });

  it('Catalog_Tolerates_AMealStoredBeforeRecipeEditsExisted', () => {
    const legacy = { ...meal({}), recipeEdits: undefined } as unknown as MenuMeal;
    expect(mealCatalog(CATALOG, legacy)).toBe(CATALOG);
  });
});
