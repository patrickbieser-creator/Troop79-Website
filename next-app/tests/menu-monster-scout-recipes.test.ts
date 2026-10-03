import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import {
  cleanScoutText,
  creditFor,
  isScoutRecipeId,
  newScoutRecipeId,
  sanitizeScoutRecipe,
  shareProblems,
  stepsFromText,
  stepsToText
} from '../src/lib/menu-monster/scout-recipes';

/**
 * Phase 4A scout recipes, pure rules: the id, the text every scout string passes
 * (public once shared), the cleaned draft the RPC receives, and what sharing needs.
 */

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'S-0000abcd',
  name: '  Campfire   chili ',
  mealFit: ['dinner', 'brunch'],
  foodGroups: ['protein', 'candy'],
  steps: ['Brown the beef.', '', '  Simmer 20 min. '],
  lines: [
    { ingredientId: 'bacon', qtyPerPerson: 3, unitKey: null },
    { ingredientId: 'bacon', qtyPerPerson: 1, unitKey: null },
    { ingredientId: 'no-such', qtyPerPerson: 1, unitKey: null },
    { ingredientId: 'eggs', qtyPerPerson: -2, unitKey: null }
  ],
  ...over
});

describe('scout recipe ids', () => {
  it('NewId_IsAScoutId', () => {
    expect(isScoutRecipeId(newScoutRecipeId())).toBe(true);
  });

  it('LeaderId_IsNotAScoutId', () => {
    expect(isScoutRecipeId('B001')).toBe(false);
  });
});

describe('cleanScoutText', () => {
  it('Text_LosesControlCharacters', () => {
    expect(cleanScoutText('Chili\u0007 time', 60)).toBe('Chili time');
  });

  it('Text_LosesLinks', () => {
    expect(cleanScoutText('See https://example.com/x and www.foo.com now', 200)).toBe('See and now');
  });

  it('Text_IsCappedAtItsLength', () => {
    expect(cleanScoutText('abcdefghij', 4)).toBe('abcd');
  });

  it('Text_CollapsesSpaces', () => {
    expect(cleanScoutText('  a   b ', 10)).toBe('a b');
  });

  it('NonText_IsEmpty', () => {
    expect(cleanScoutText(42, 10)).toBe('');
  });
});

describe('sanitizeScoutRecipe', () => {
  const d = sanitizeScoutRecipe(raw(), CATALOG);

  it('Name_IsCleaned', () => {
    expect(d.name).toBe('Campfire chili');
  });

  it('Meals_KeepOnlyRealSlots', () => {
    expect(d.mealFit).toEqual(['dinner']);
  });

  it('FoodGroups_KeepOnlyRealGroups', () => {
    expect(d.foodGroups).toEqual(['protein']);
  });

  it('Steps_DropEmptyOnes', () => {
    expect(d.steps).toEqual(['Brown the beef.', 'Simmer 20 min.']);
  });

  it('Lines_KeepOneLivePositiveLinePerIngredient', () => {
    expect(d.lines).toEqual([{ ingredientId: 'bacon', qtyPerPerson: 3, unitKey: null }]);
  });

  it('Id_IsKept_WhenItIsAScoutId', () => {
    expect(d.id).toBe('S-0000abcd');
  });

  it('Id_IsDropped_WhenItIsNotAScoutId', () => {
    expect(sanitizeScoutRecipe(raw({ id: 'B001' }), CATALOG).id).toBeNull();
  });

  it('UnknownUnit_FallsBackToTheIngredientsOwn', () => {
    const r = sanitizeScoutRecipe(raw({ lines: [{ ingredientId: 'bacon', qtyPerPerson: 2, unitKey: 'furlong' }] }), CATALOG);
    expect(r.lines[0].unitKey).toBeNull();
  });
});

describe('steps text', () => {
  it('Steps_RoundTripThroughText', () => {
    expect(stepsFromText(stepsToText(['One.', 'Two.']))).toEqual(['One.', 'Two.']);
  });

  it('NoSteps_IsNoText', () => {
    expect(stepsFromText(null)).toEqual([]);
  });
});

describe('shareProblems', () => {
  it('ReadyRecipe_HasNoProblems', () => {
    expect(shareProblems(sanitizeScoutRecipe(raw(), CATALOG))).toEqual([]);
  });

  it('Recipe_NeedsAMealAndAnIngredient_ToShare', () => {
    expect(shareProblems(sanitizeScoutRecipe(raw({ mealFit: [], lines: [] }), CATALOG))).toEqual(['Pick at least one meal it’s good for.', 'Add at least one ingredient.']);
  });
});

describe('creditFor', () => {
  it('Credit_IsFirstNameAndLastInitial', () => {
    expect(creditFor({ first_name: 'Charlie', last_name: 'Walters' })).toBe('Charlie W.');
  });

  it('Credit_IsCleanedAndCapped', () => {
    expect(creditFor({ first_name: 'A'.repeat(60), last_name: 'B' }).length).toBe(40);
  });
});

describe('steps budget', () => {
  it('Steps_StayWithinTheStoredTextLimit', () => {
    const d = sanitizeScoutRecipe({ name: 'x', steps: Array.from({ length: 30 }, () => 'y'.repeat(300)) }, CATALOG);
    expect(stepsToText(d.steps).length).toBeLessThanOrEqual(4000);
  });
});

describe('invisible characters', () => {
  it('Text_LosesZeroWidthAndBidiCharacters', () => {
    expect(cleanScoutText('Chi​li ‮evil', 40)).toBe('Chili evil');
  });
});
