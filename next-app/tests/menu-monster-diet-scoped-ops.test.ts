import { describe, it, expect } from 'vitest';
import { mapCatalog } from '../src/lib/menu-monster/catalog';
import { ROWS } from './helpers/menu-monster-fixture';
import { composePlan, mealCatalog, sanitizeMenu, applyRecipeEdits, type EditOp, type Menu, type MenuMeal } from '../src/lib/menu-monster/menus';
import { applyScopedOps } from '../src/lib/menu-monster/variations';
import { buildLines, restrictionWarnings } from '../src/lib/menu-monster/engine';
import { buildMenuList } from '../src/lib/menu-monster/menu-view';
import { menuEditRows, opsWithAdded, opsWithLeaveOut, opsWithSwap, opsWithoutAdded, opsWithoutOp, opsWithAmount, scopeLabel, idleLabel } from '../src/lib/menu-monster/ingredient-rows';
import type { RecipeLine, Variation } from '../src/lib/menu-monster/types';

/**
 * "Only for the gluten-free people" (Patrick, 2026-10-06): a menu's swap / leave out / add may be
 * for ONE diet's scouts. The ops fold into the SAME diff shape a recipe's diet tab compiles
 * (variations.ts compileRecipe), so the engine, the shopping list and the print sheets read the
 * same 'except' / 'only' lines they always have.
 */

// The fixture plus gluten-free bread (no avoid flag) and a package for it.
const gfBreadRow = { ...ROWS.ingredients[7], id: 'gf-bread', name: 'Gluten-free bread', avoid: [] as never[] };
const gfBreadPkg = { ...ROWS.packages[ROWS.packages.length - 1], id: 'p-gfb', ingredient_id: 'gf-bread', name: 'Udi’s GF bread', price: 6, yield: 12 };
const CATALOG = mapCatalog({ ...ROWS, ingredients: [...ROWS.ingredients, gfBreadRow], packages: [...ROWS.packages, gfBreadPkg] });

const sandwiches = CATALOG.recipes.find((r) => r.id === 'L001')!;
const pancakes = CATALOG.recipes.find((r) => r.id === 'B001')!;

const meal = (recipeEdits: MenuMeal['recipeEdits'], over: Partial<MenuMeal> = {}): MenuMeal => ({ id: 'm1', day: 0, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits, ...over });
const menuOf = (m: MenuMeal, over: Partial<Menu> = {}): Menu => ({
  name: 'Lunch',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 18,
  restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 1,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [m],
  ...over
});

const gfSwap: EditOp = { op: 'swap', ingredientId: 'bread', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' };
const gfAdd: EditOp = { op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 2, for: 'gf' };

describe('sanitizeMenu keeps diet scopes', () => {
  const raw = (ops: unknown[]) => ({
    name: 'Lunch', context: 'camp', headcount: 18, restrictions: { gf: 2 }, budgetPerPersonMeal: 4, dayCount: 1,
    meals: [{ id: 'm1', day: 0, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: { L001: ops } }]
  });

  it('Sanitiser_KeepsAScopedSwapLeaveOutAndAdd', () => {
    const m = sanitizeMenu(raw([gfSwap, { op: 'add', ingredientId: 'eggs', qtyPerPerson: 1, for: 'nut' }, { op: 'leave_out', ingredientId: 'bread', for: 'dairy' }]), CATALOG);
    expect(m.meals[0].recipeEdits.L001).toEqual([
      gfSwap,
      { op: 'add', ingredientId: 'eggs', qtyPerPerson: 1, for: 'nut' },
      { op: 'leave_out', ingredientId: 'bread', for: 'dairy' }
    ]);
  });

  it('Sanitiser_DropsAnOpForAnUnknownRestriction_NeverWideningItToEveryone', () => {
    const m = sanitizeMenu(raw([{ op: 'leave_out', ingredientId: 'bread', for: 'keto' }, { op: 'add', ingredientId: 'eggs', qtyPerPerson: 1, for: 7 }]), CATALOG);
    expect(m.meals[0].recipeEdits.L001).toBeUndefined();
  });

  it('Sanitiser_KeepsAnUnscopedOpFreeOfAForKey', () => {
    const m = sanitizeMenu(raw([{ op: 'leave_out', ingredientId: 'bread' }]), CATALOG);
    expect(m.meals[0].recipeEdits.L001).toEqual([{ op: 'leave_out', ingredientId: 'bread' }]);
  });

  it('Sanitiser_LetsOneIngredientHaveAnOpPerDiet_AndOneForEveryone', () => {
    const m = sanitizeMenu(raw([{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }, { op: 'leave_out', ingredientId: 'bread', for: 'dairy' }, { op: 'leave_out', ingredientId: 'bread' }]), CATALOG);
    expect(m.meals[0].recipeEdits.L001).toHaveLength(3);
  });

  it('Sanitiser_LastOpWins_ForTheSameIngredientAndDiet', () => {
    const m = sanitizeMenu(raw([{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }, gfSwap]), CATALOG);
    expect(m.meals[0].recipeEdits.L001).toEqual([gfSwap]);
  });
});

describe('applyScopedOps (the ops → compileRecipe bridge)', () => {
  const lines = (r: { lines: RecipeLine[] }) => r.lines.map((l) => `${l.ingredientId}:${l.servesRule}:${l.servesRestrictions.join('+')}`);

  it('Bridge_ScopedSwap_YieldsAnExceptLineAndAnOnlyLine', () => {
    const out = applyScopedOps(sandwiches.lines, [{ op: 'swap', ingredientId: 'bread', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' }]);
    expect(lines(out)).toEqual(['bread:except:gf', 'gf-bread:only:gf']);
  });

  it('Bridge_ScopedLeaveOut_YieldsOnlyAnExceptLine', () => {
    expect(lines(applyScopedOps(sandwiches.lines, [{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }]))).toEqual(['bread:except:gf']);
  });

  it('Bridge_ScopedAdd_YieldsAnOnlyLine_AndLeavesTheBaseAlone', () => {
    expect(lines(applyScopedOps(sandwiches.lines, [{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 2, for: 'gf' }]))).toEqual(['bread:everyone:', 'gf-bread:only:gf']);
  });

  it('Bridge_TwoDietsLeavingTheSameLineOut_AreOneExceptLine', () => {
    const out = applyScopedOps(sandwiches.lines, [
      { op: 'leave_out', ingredientId: 'bread', for: 'gf' },
      { op: 'leave_out', ingredientId: 'bread', for: 'dairy' }
    ]);
    expect(lines(out)).toEqual(['bread:except:gf+dairy']);
  });

  it('Bridge_MergesWithTheRecipesOwnDietDiffs_AMealsGfAddJoinsTheRecipesGfSwap', () => {
    // Pancakes: mix except gf, almond flour + eggs only gf. The meal adds oj just for gf scouts.
    const out = applyScopedOps(pancakes.lines, [{ op: 'add', ingredientId: 'oj', qtyPerPerson: 1, for: 'gf' }], pancakes.variations);
    expect(lines(out)).toEqual(['pancake-mix:except:gf', 'almond-flour:only:gf', 'eggs:only:gf', 'oj:only:gf']);
  });

  it('Bridge_AMealsSwapOfABaseLine_ReplacesTheRecipesOwnChangeToThatLine', () => {
    const stored: Variation[] = [
      { restriction: 'gf', state: 'substituted', note: null, lines: [{ op: 'swap', baseIngredientId: 'bread', ingredientId: 'oatmeal', qtyPerPerson: 1, unitKey: null }] }
    ];
    const out = applyScopedOps(sandwiches.lines, [{ op: 'swap', ingredientId: 'bread', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' }], stored);
    expect(lines(out)).toEqual(['bread:except:gf', 'gf-bread:only:gf']);
  });

  it('Bridge_ASwapOfALineTheRecipeLacks_IsIgnored', () => {
    expect(lines(applyScopedOps(sandwiches.lines, [{ op: 'swap', ingredientId: 'eggs', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' }]))).toEqual(['bread:everyone:']);
  });

  it('Bridge_ChangingADietThatWasNotSuitable_NoLongerCountsAsNotSuitable', () => {
    const unsuitable: Variation[] = [{ restriction: 'gf', state: 'unsuitable', note: null, lines: [] }];
    const out = applyScopedOps(sandwiches.lines, [gfAdd as never], unsuitable);
    expect(out.variations.find((v) => v.restriction === 'gf')?.state).toBe('substituted');
  });

  it('Bridge_UnscopedOpsAreUnchanged_ByApplyRecipeEdits', () => {
    expect(applyRecipeEdits(sandwiches, [{ op: 'amount', ingredientId: 'bread', qtyPerPerson: 3 }])).toEqual([{ ...sandwiches.lines[0], qtyPerPerson: 3 }]);
    expect(applyRecipeEdits(sandwiches, [{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 1 }]).map((l) => l.servesRule)).toEqual(['everyone', 'everyone']);
    expect(applyRecipeEdits(sandwiches, [{ op: 'leave_out', ingredientId: 'bread' }])).toEqual([]);
  });

  it('Bridge_AScopedLeaveOut_FollowsAnUnscopedSwapOfTheSameLine', () => {
    const out = applyRecipeEdits(sandwiches, [{ op: 'swap', ingredientId: 'bread', to: 'oatmeal', qtyPerPerson: 1 }, { op: 'leave_out', ingredientId: 'bread', for: 'gf' }]);
    expect(out.map((l) => l.ingredientId + ':' + l.servesRule)).toEqual(['oatmeal:except']);
  });

  it('Bridge_ScopedOpsAfterAnUnscopedAmount_KeepTheNewAmount', () => {
    const out = applyRecipeEdits(sandwiches, [{ op: 'amount', ingredientId: 'bread', qtyPerPerson: 3 }, gfSwap]);
    expect(out.find((l) => l.ingredientId === 'bread')).toMatchObject({ qtyPerPerson: 3, servesRule: 'except', servesRestrictions: ['gf'] });
  });
});

describe('the engine prices a diet-scoped op by that diet’s headcount', () => {
  const lineFor = (m: Menu, id: string) => buildLines(composePlan(m, m.meals[0]), mealCatalog(CATALOG, m.meals[0])).find((l) => l.ing.id === id);

  it('GfBreadForTheTwoGfScouts_NeedsTwoPeoplesWorth_AndTheBreadDropsToSixteen', () => {
    const m = menuOf(meal({ L001: [gfAdd, { op: 'leave_out', ingredientId: 'bread', for: 'gf' }] }));
    expect(lineFor(m, 'gf-bread')?.need).toBe(4); // 2 people x 2 slices
    expect(lineFor(m, 'bread')?.need).toBe(32); // 16 people x 2 slices
  });

  it('ASwapForGf_DoesTheSame', () => {
    const m = menuOf(meal({ L001: [gfSwap] }));
    expect(lineFor(m, 'gf-bread')?.need).toBe(4);
    expect(lineFor(m, 'bread')?.need).toBe(32);
  });

  it('AnUnscopedAdd_StillFeedsEveryone', () => {
    const m = menuOf(meal({ L001: [{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 2 }] }));
    expect(lineFor(m, 'gf-bread')?.need).toBe(36);
  });

  it('TheShoppingList_MergesTheScopedLines_ByTheMenusHeadcounts', () => {
    const m = menuOf(meal({ L001: [gfSwap] }));
    const list = buildMenuList(m, CATALOG);
    expect(list.lines.find((l) => l.ing.id === 'gf-bread')).toMatchObject({ need: 4 });
    expect(list.lines.find((l) => l.ing.id === 'bread')).toMatchObject({ need: 32 });
  });

  it('ADifferentMealHeadcount_ScalesTheScopedLine_NotTheTroops', () => {
    // 10 at this meal, 2 of them gluten-free (the menu's counts are clamped to the meal).
    const m = menuOf(meal({ L001: [gfSwap] }, { headcount: 10 }));
    expect(lineFor(m, 'gf-bread')?.need).toBe(4);
    expect(lineFor(m, 'bread')?.need).toBe(16);
  });
});

describe('the warning clears once a diet has its own line', () => {
  const warn = (m: Menu) => restrictionWarnings(composePlan(m, m.meals[0]), mealCatalog(CATALOG, m.meals[0]));

  it('Sandwiches_WarnGlutenFree_UntilAScoutSwapsOrAddsOrLeavesOut', () => {
    expect(warn(menuOf(meal({})))).toHaveLength(1);
    expect(warn(menuOf(meal({ L001: [gfSwap] })))).toEqual([]);
    expect(warn(menuOf(meal({ L001: [gfAdd] })))).toEqual([]);
    expect(warn(menuOf(meal({ L001: [{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }] })))).toEqual([]);
  });

  it('TheWarning_NamesTheIngredientByIdToo_SoTheAnswerCanTargetIt', () => {
    const w = warn(menuOf(meal({})));
    expect(w[0].ingredientIds).toEqual(['bread']);
  });

  it('AScoutsOpForAnotherDiet_DoesNotClearTheGlutenFreeWarning', () => {
    expect(warn(menuOf(meal({ L001: [{ op: 'leave_out', ingredientId: 'bread', for: 'dairy' }] })))).toHaveLength(1);
  });

  it('ARecipesOwnTroopLevelDietVariation_AlreadyAnswersIt_NoWarning', () => {
    // Pancakes carry a stored gf variation; the compiled lines have the swap, so nothing warns.
    const m = menuOf(meal({}, { slot: 'breakfast', recipeIds: ['B001'] }));
    expect(warn(m)).toEqual([]);
  });
});

describe('menuEditRows with diet-scoped ops', () => {
  const plan = { headcount: 18, restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 } };
  const rows = (ops: EditOp[], p = plan) => menuEditRows(sandwiches, ops, CATALOG, p, 'total');

  it('AScopedSwap_ShowsTheTroopsLineExceptGf_AndANewLineJustForGf', () => {
    const r = rows([gfSwap]);
    expect(r.map((x) => [x.name, x.amount])).toEqual([['Bread', '32 slices'], ['Gluten-free bread', '4 slices']]);
    expect(r[0].scope).toMatchObject({ mode: 'except', restrictions: ['gf'], idle: false });
    expect(r[1].scope).toMatchObject({ mode: 'only', restrictions: ['gf'], idle: false });
    expect(r[1].marker).toEqual({ kind: 'swapped', was: 'Bread' });
    expect(scopeLabel(r[0].scope!)).toBe('except gluten-free');
    expect(scopeLabel(r[1].scope!)).toBe('Gluten-free scouts only');
  });

  it('AScopedAdd_IsARowJustForGf_AtTheGfHeadcount', () => {
    const r = rows([gfAdd]);
    expect(r.map((x) => [x.key, x.amount])).toEqual([['0:bread', '36 slices'], ['add:gf:gf-bread', '4 slices']]);
    expect(r[1].edit).toMatchObject({ kind: 'added', scope: 'gf' });
  });

  it('AScopedRow_ForADietWithNoPeopleOnTheMeal_StillShows_Idle', () => {
    const r = rows([gfAdd], { headcount: 18, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 } });
    expect(r).toHaveLength(2);
    expect(r[1].scope).toMatchObject({ idle: true });
    expect(r[1].amount).toBe('');
    expect(idleLabel(r[1].scope!)).toBe('no gluten-free scouts on this meal');
  });

  it('AScopedLeaveOut_KeepsTheRowAndRemembersWhichDietIsOut', () => {
    const r = rows([{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }]);
    expect(r).toHaveLength(1);
    expect(r[0].edit?.scopedOut).toEqual(['gf']);
    expect(r[0].amount).toBe('32 slices');
  });

  it('ATroopLine_IsScopable_OnlyWhenEveryoneEatsIt', () => {
    expect(rows([])[0].edit?.scopable).toBe(true);
    const pr = menuEditRows(pancakes, [], CATALOG, plan, 'total');
    expect(pr.find((x) => x.name === 'Almond flour')?.edit?.scopable).toBe(false);
  });

  it('TheScopedRowsMatchTheEnginesNumbers_ForTheSameOps', () => {
    const m = menuOf(meal({ L001: [gfSwap] }));
    const need = (id: string) => buildLines(composePlan(m, m.meals[0]), mealCatalog(CATALOG, m.meals[0])).find((l) => l.ing.id === id)?.need;
    const r = rows([gfSwap]);
    expect(parseInt(r[0].amount, 10)).toBe(need('bread'));
    expect(parseInt(r[1].amount, 10)).toBe(need('gf-bread'));
  });

  it('APlainRowIsUnchanged_WhenThereAreNoScopedOps', () => {
    const r = rows([]);
    expect(r[0].scope).toBeUndefined();
    expect(r[0].edit?.scopedOut).toBeUndefined();
  });
});

describe('op builders keep the diet apart', () => {
  const edit = menuEditRows(sandwiches, [], CATALOG, { headcount: 18, restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 } }, 'total')[0].edit!;

  it('ScopedSwapAndUnscopedSwap_CanCoexistOnOneIngredient', () => {
    const a = opsWithSwap([], edit, 'eggs', 1);
    const b = opsWithSwap(a, edit, 'gf-bread', 2, 'gf');
    expect(b).toEqual([{ op: 'swap', ingredientId: 'bread', to: 'eggs', qtyPerPerson: 1 }, gfSwap]);
  });

  it('PuttingBackForOneDiet_LeavesTheOthersAlone', () => {
    const ops: EditOp[] = [gfSwap, { op: 'leave_out', ingredientId: 'bread', for: 'dairy' }];
    expect(opsWithoutOp(ops, edit, 'gf')).toEqual([{ op: 'leave_out', ingredientId: 'bread', for: 'dairy' }]);
    expect(opsWithoutOp(ops, edit, undefined)).toEqual(ops);
  });

  it('AScopedLeaveOut_ReplacesAScopedSwapForTheSameDiet', () => {
    expect(opsWithLeaveOut([gfSwap], edit, 'gf')).toEqual([{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }]);
  });

  it('AddedForADiet_IsItsOwnSlot_AndRemovedByTheSameDiet', () => {
    const a = opsWithAdded([{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 1 }], 'gf-bread', 2, 'gf');
    expect(a).toHaveLength(2);
    expect(opsWithoutAdded(a, 'gf-bread', 'gf')).toEqual([{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 1 }]);
  });

  it('ChangingAScopedAddsAmount_TouchesOnlyThatDietsAdd', () => {
    const a: EditOp[] = [{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 1 }, gfAdd];
    const scopedEdit = { kind: 'added' as const, ingredientId: 'gf-bread', currentIngredientId: 'gf-bread', qtyPerPerson: 2, unitLabel: 'slices', scope: 'gf' as const };
    expect(opsWithAmount(a, scopedEdit, 3)).toEqual([{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 1 }, { ...gfAdd, qtyPerPerson: 3 }]);
  });
});
