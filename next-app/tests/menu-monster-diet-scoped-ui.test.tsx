import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mapCatalog } from '../src/lib/menu-monster/catalog';
import { ROWS } from './helpers/menu-monster-fixture';
import type { EditOp, Menu } from '../src/lib/menu-monster/menus';
import type { Plan, Recipe, RestrictionKey } from '../src/lib/menu-monster/types';
import {
  defaultSwapQty,
  menuEditRows,
  opsWithAdded,
  opsWithAmount,
  opsWithLeaveOut,
  opsWithSwap,
  opsWithoutAdded,
  opsWithoutOp
} from '../src/lib/menu-monster/ingredient-rows';
import { buildSnapshot } from '../src/lib/menu-monster/menu-snapshot';
import { IngredientList, type RowAction } from '../src/app/(public)/library/menu-monster/_components/ingredient-list';

/**
 * "Only for the gluten-free people" (Patrick, 2026-10-06), the screens: the ingredient list's
 * diet actions and markers, the warning's answers on the meal panel, and the shopping tab
 * reading the compiled lines. The rules themselves are tested in menu-monster-diet-scoped-ops.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a),
  addMenuIngredientAction: vi.fn(),
  addScoutPackageAction: vi.fn()
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';
import { ShoppingTab } from '../src/app/(public)/library/menu-monster/menus/_components/shopping-tab';

const gfBreadRow = { ...ROWS.ingredients[7], id: 'gf-bread', name: 'Gluten-free bread', avoid: [] as never[] };
const gfBreadPkg = { ...ROWS.packages[ROWS.packages.length - 1], id: 'p-gfb', ingredient_id: 'gf-bread', name: 'Udi’s GF bread', price: 6, yield: 12 };
const CATALOG = mapCatalog({ ...ROWS, ingredients: [...ROWS.ingredients, gfBreadRow], packages: [...ROWS.packages, gfBreadPkg] });
const sandwiches = CATALOG.recipes.find((r) => r.id === 'L001') as Recipe;
const CHOICES = CATALOG.ingredients.map((i) => ({ id: i.id, name: i.name }));

const user = () => userEvent.setup();

/* ---- the ingredient list ---------------------------------------------------- */

function Harness({ restrictions, initial = [] }: { restrictions: Record<RestrictionKey, number>; initial?: EditOp[] }) {
  const [ops, setOps] = useState<EditOp[]>(initial);
  const plan: Pick<Plan, 'headcount' | 'restrictions'> = { headcount: 18, restrictions };
  const rows = menuEditRows(sandwiches, ops, CATALOG, plan, 'total');
  const act = (a: RowAction) => {
    if (a.type === 'add') return setOps((cur) => opsWithAdded(cur, a.ingredientId, 2, a.scope));
    const e = rows.find((r) => r.key === a.key)?.edit;
    if (!e) return;
    const scope = a.type === 'amount' ? undefined : (a.scope ?? e.scope);
    setOps((cur) => {
      if (a.type === 'amount') return opsWithAmount(cur, e, a.qtyPerPerson);
      if (a.type === 'swap') return opsWithSwap(cur, e, a.to, 2, scope);
      if (a.type === 'leave_out') return opsWithLeaveOut(cur, e, scope);
      if (a.type === 'remove') return opsWithoutAdded(cur, e.ingredientId, e.scope);
      return opsWithoutOp(cur, e, scope);
    });
    void defaultSwapQty;
  };
  return <IngredientList mode="menu-edit" ariaLabel="Sandwiches ingredients" rows={rows} choices={CHOICES} restrictions={restrictions} onAction={act} onAnnounce={() => {}} />;
}

const GF2 = { gf: 2, nut: 0, dairy: 0, veg: 0 };
const NONE = { gf: 0, nut: 0, dairy: 0, veg: 0 };
const more = (name: string) => screen.getByRole('button', { name: `Change ${name}` });
const itemNames = () => screen.getAllByRole('button').map((b) => b.textContent ?? '');

describe('IngredientList (menu-edit) — diets', () => {
  it('Menu_OffersSwapAndLeaveOut_ForEachDietWithPeopleOnTheMeal', async () => {
    const u = user();
    render(<Harness restrictions={{ gf: 2, nut: 0, dairy: 1, veg: 0 }} />);
    await u.click(more('Bread'));
    const names = itemNames();
    expect(names).toEqual(expect.arrayContaining(['Swap for gluten-free scouts…', 'Leave out for gluten-free scouts', 'Swap for dairy-free scouts…', 'Leave out for dairy-free scouts']));
    expect(names).not.toContain('Swap for nut-free scouts…');
    expect(names).not.toContain('Swap for vegetarian scouts…');
  });

  it('Menu_OffersNoDietActions_WhenNobodyOnTheMealHasADiet', async () => {
    const u = user();
    render(<Harness restrictions={NONE} />);
    await u.click(more('Bread'));
    expect(itemNames().some((n) => /scouts/.test(n))).toBe(false);
  });

  it('SwapForGfScouts_OpensASearchNamedForThem_ThenShowsTheTwoRowsWithMarkers', async () => {
    const u = user();
    render(<Harness restrictions={GF2} />);
    await u.click(more('Bread'));
    await u.click(screen.getByRole('button', { name: 'Swap for gluten-free scouts…' }));
    const box = screen.getByRole('combobox', { name: 'Swap Bread for gluten-free scouts' });
    await u.type(box, 'Gluten');
    await u.click(screen.getByRole('option', { name: 'Gluten-free bread' }));
    expect(screen.getByText('except gluten-free')).toBeTruthy();
    expect(screen.getByText('Gluten-free scouts only')).toBeTruthy();
    // The new row's amount box is open for the new ingredient's unit.
    expect(screen.getByRole('textbox', { name: 'Amount per person of Gluten-free bread, in slices' })).toBeTruthy();
  });

  it('LeaveOutForGfScouts_KeepsTheRow_MarkedExceptGf_AndPutBackWorks', async () => {
    const u = user();
    render(<Harness restrictions={GF2} />);
    await u.click(more('Bread'));
    await u.click(screen.getByRole('button', { name: 'Leave out for gluten-free scouts' }));
    expect(screen.getByText('except gluten-free')).toBeTruthy();
    await u.click(more('Bread'));
    expect(itemNames()).not.toContain('Leave out for gluten-free scouts');
    await u.click(screen.getByRole('button', { name: 'Put back for gluten-free scouts' }));
    expect(screen.queryByText('except gluten-free')).toBeNull();
  });

  it('AddFor_DefaultsToEveryone_AndOffersOnlyDietsWithPeople', async () => {
    render(<Harness restrictions={{ gf: 2, nut: 0, dairy: 0, veg: 1 }} />);
    const select = screen.getByRole('combobox', { name: 'Add for' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Everyone', 'Gluten-free scouts', 'Vegetarian scouts']);
  });

  it('AddFor_IsAbsent_WhenNobodyHasADiet', () => {
    render(<Harness restrictions={NONE} />);
    expect(screen.queryByRole('combobox', { name: 'Add for' })).toBeNull();
  });

  it('AddedForGfScouts_IsARowJustForThem_AndRemoveTakesItAway', async () => {
    const u = user();
    render(<Harness restrictions={GF2} />);
    await u.selectOptions(screen.getByRole('combobox', { name: 'Add for' }), 'gf');
    await u.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), 'Gluten');
    await u.click(screen.getByRole('option', { name: 'Gluten-free bread' }));
    expect(screen.getByText('Gluten-free scouts only')).toBeTruthy();
    // The choice goes back to Everyone for the next add.
    expect((screen.getByRole('combobox', { name: 'Add for' }) as HTMLSelectElement).value).toBe('');
    await u.keyboard('{Escape}');
    await u.click(more('Gluten-free bread'));
    await u.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('Gluten-free scouts only')).toBeNull();
  });

  it('AnAddForEveryone_HasNoScopeMarker', async () => {
    const u = user();
    render(<Harness restrictions={GF2} />);
    await u.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), 'Gluten');
    await u.click(screen.getByRole('option', { name: 'Gluten-free bread' }));
    expect(screen.queryByText('Gluten-free scouts only')).toBeNull();
    expect(screen.getByText('Added')).toBeTruthy();
  });

  it('ADietRowWithNobodyOnTheMeal_StillShows_DimmedWithWhy', () => {
    render(<Harness restrictions={NONE} initial={[{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 2, for: 'gf' }]} />);
    expect(screen.getByText('Gluten-free bread')).toBeTruthy();
    expect(screen.getByText('no gluten-free scouts on this meal')).toBeTruthy();
    const li = screen.getByText('Gluten-free bread').closest('li') as HTMLElement;
    expect(li.className).toMatch(/rowOut/);
  });

  it('BackToTheTroopsIngredient_OnAScopedSwapRow_DropsBothRows', async () => {
    const u = user();
    render(<Harness restrictions={GF2} initial={[{ op: 'swap', ingredientId: 'bread', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' }]} />);
    await u.click(more('Gluten-free bread'));
    await u.click(screen.getByRole('button', { name: 'Back to Bread' }));
    expect(screen.queryByText('Gluten-free scouts only')).toBeNull();
    expect(screen.queryByText('except gluten-free')).toBeNull();
  });

  it('TheReadList_ShowsTheScopeToo_ForALeaderReadingAScoutsMenu', () => {
    const rows = menuEditRows(sandwiches, [{ op: 'add', ingredientId: 'gf-bread', qtyPerPerson: 2, for: 'gf' }], CATALOG, { headcount: 18, restrictions: GF2 }, 'total');
    render(<IngredientList mode="read" ariaLabel="x" rows={rows} />);
    expect(screen.getByText('Gluten-free scouts only')).toBeTruthy();
  });
});

/* ---- the meal panel: the warning's answers ---------------------------------- */

const VERSION = '2026-10-02T12:00:00.000Z';
const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee lunch',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 18,
  restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 1,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }],
  ...over
});
const panel = () => within(document.getElementById('mm-meal-m1') as HTMLElement);
const editor = (m: Menu = menu()) => <PlanTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} outings={[]} openMeal="m1" />;
const WARNING = /2 people are gluten-free and this has bread\. Plan something else for them\./;

describe('MealPanel — the diet warning has an answer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Warning_KeepsItsText_AndOffersSwapAndLeaveOutForThoseScouts', () => {
    render(editor());
    expect(panel().getByText(WARNING)).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Swap bread for gluten-free scouts…' })).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Leave bread out for gluten-free scouts' })).toBeTruthy();
  });

  it('SwapAnswer_OpensTheRowsSearchScopedToThatDiet_AndPickingClearsTheWarning', async () => {
    const u = user();
    render(editor());
    await u.click(panel().getByRole('button', { name: 'Swap bread for gluten-free scouts…' }));
    const box = screen.getByRole('combobox', { name: 'Swap Bread for gluten-free scouts' });
    await u.type(box, 'Gluten');
    await u.click(screen.getByRole('option', { name: 'Gluten-free bread' }));
    expect(panel().queryByText(WARNING)).toBeNull();
    expect(panel().getByText('Gluten-free scouts only')).toBeTruthy();
    expect(panel().getByText('except gluten-free')).toBeTruthy();
  });

  it('LeaveOutAnswer_LeavesTheBreadOutForThem_ClearsTheWarning_AndCanBeUndone', async () => {
    const u = user();
    render(editor());
    await u.click(panel().getByRole('button', { name: 'Leave bread out for gluten-free scouts' }));
    expect(panel().queryByText(WARNING)).toBeNull();
    expect(panel().getByText('except gluten-free')).toBeTruthy();
    expect(panel().getByText('Bread left out for gluten-free scouts.')).toBeTruthy();
    await u.click(panel().getByRole('button', { name: 'Undo' }));
    expect(panel().getByText(WARNING)).toBeTruthy();
  });

  it('SavedMenu_CarriesTheScopedOp_AndNoOtherEdit', async () => {
    const u = user();
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(editor());
    await u.click(panel().getByRole('button', { name: 'Leave bread out for gluten-free scouts' }));
    await u.click(screen.getByRole('button', { name: /Save/ }));
    const saved = saveMenuAction.mock.calls[0][1] as Menu;
    expect(saved.meals[0].recipeEdits).toEqual({ L001: [{ op: 'leave_out', ingredientId: 'bread', for: 'gf' }] });
  });

  it('NotSuitableWarning_OffersToAddSomethingForThoseScouts_WithTheAddChoiceSet', async () => {
    const u = user();
    const unsuitable = mapCatalog({
      ...ROWS,
      ingredients: [...ROWS.ingredients, gfBreadRow],
      packages: [...ROWS.packages, gfBreadPkg],
      variations: [{ recipe_id: 'L001', restriction: 'gf', state: 'unsuitable', note: null, updated_at: '2026-09-08T00:00:00Z' }],
      variationLines: []
    });
    render(<PlanTab catalog={unsuitable} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    await u.click(panel().getByRole('button', { name: 'Add something for gluten-free scouts…' }));
    expect((panel().getByRole('combobox', { name: 'Add for' }) as HTMLSelectElement).value).toBe('gf');
  });

  it('Warning_HasNoAnswers_OnAReadOnlyMeal', () => {
    render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m1" readOnly />);
    expect(screen.queryByRole('button', { name: /for gluten-free scouts/ })).toBeNull();
  });

  it('TheScoutsGfSwap_ClearsTheWarning_OnReload', () => {
    const m = menu({ meals: [{ id: 'm1', day: 0, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: { L001: [{ op: 'swap', ingredientId: 'bread', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' }] } }] });
    render(editor(m));
    expect(panel().queryByText(WARNING)).toBeNull();
  });
});

/* ---- the shopping tab ------------------------------------------------------- */

describe('ShoppingTab — scoped lines in the merged list', () => {
  const m = menu({ meals: [{ id: 'm1', day: 0, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: { L001: [{ op: 'swap', ingredientId: 'bread', to: 'gf-bread', qtyPerPerson: 2, for: 'gf' }] } }] });

  it('ShoppingList_BuysTheBreadForSixteenAndTheGfBreadForTwo', async () => {
    const u = user();
    render(<ShoppingTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} snapshot={buildSnapshot(m, CATALOG)} tabs={<nav aria-label="Menu sections" />} />);
    await u.click(screen.getByRole('button', { name: /^Gluten-free bread/ }));
    expect(screen.getByText(/Needs 4 slices/)).toBeTruthy(); // 2 gluten-free scouts x 2 slices
    await u.click(screen.getByRole('button', { name: /^Bread/ }));
    expect(screen.getByText(/Needs 32 slices/)).toBeTruthy(); // 16 other scouts x 2 slices
  });
});
