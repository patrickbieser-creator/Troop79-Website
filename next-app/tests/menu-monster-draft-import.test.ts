import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { restorePlan, seedPlan } from '../src/lib/menu-monster/engine';
import { menuFromDraft, sanitizeMenu } from '../src/lib/menu-monster/menus';
import type { Plan } from '../src/lib/menu-monster/types';

/** Scout Workspace slice 6: the anonymous planner's draft becomes a one-meal menu. */

const draft = (over: Partial<Plan> = {}): Plan => ({
  ...restorePlan({ meal: 'breakfast', headcount: 12, recipeIds: ['B003', 'B014'], restrictions: { gf: 2 }, budgetPerPerson: 3.5, date: '2026-10-10' }, CATALOG),
  ...over
});

describe('menuFromDraft', () => {
  it('Scout_GetsOneMealOnDayZero_WhenImportingADraft', () => {
    const m = menuFromDraft(draft(), CATALOG);
    expect(m.meals).toHaveLength(1);
    expect(m.meals[0]).toMatchObject({ day: 0, slot: 'breakfast', recipeIds: ['B003', 'B014'] });
  });

  it('Scout_KeepsHeadcountDietsAndBudget_WhenImportingADraft', () => {
    const m = menuFromDraft(draft(), CATALOG);
    expect(m.headcount).toBe(12);
    expect(m.restrictions.gf).toBe(2);
    expect(m.budgetPerPersonMeal).toBe(3.5);
  });

  it('Scout_SeesSlotNameFromThisComputer_WhenImportingADraft', () => {
    expect(menuFromDraft(draft(), CATALOG).name).toBe('Breakfast from this computer');
  });

  it('Scout_KeepsTheDraftDateAsStartDay_WhenImportingADraft', () => {
    expect(menuFromDraft(draft(), CATALOG).startDate).toBe('2026-10-10');
  });

  it('Scout_CarriesShoppingChoices_WhenTheDraftHasThem', () => {
    const pkg = CATALOG.packages[0];
    const plan = draft({
      packageChoice: { [pkg.ingredientId]: pkg.id },
      lineSource: { oatmeal: { source: 'pantry', note: 'in the box' } }
    });
    const m = menuFromDraft(plan, CATALOG);
    expect(m.shopping.packageChoice[pkg.ingredientId]).toBe(pkg.id);
    expect(m.shopping.lineSource.oatmeal).toEqual({ source: 'pantry', note: 'in the box' });
  });

  it('Scout_LosesUnknownPackages_WhenTheDraftIsStale', () => {
    const m = menuFromDraft(draft({ packageChoice: { oatmeal: 'gone' } }), CATALOG);
    expect(m.shopping.packageChoice).toEqual({});
  });

  it('Scout_GetsAMenuThatSurvivesSanitize_WhenImporting', () => {
    const m = menuFromDraft(draft(), CATALOG);
    expect(sanitizeMenu(m, CATALOG)).toEqual({ ...m, meals: [{ ...m.meals[0], id: expect.any(String) }] });
  });

  it('Scout_GetsOneDay_WhenImportingASingleMeal', () => {
    expect(menuFromDraft(seedPlan(CATALOG), CATALOG).dayCount).toBe(1);
  });
});
