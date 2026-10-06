import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG as BASE } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Brand, Catalog } from '../src/lib/menu-monster/types';
import { buildSnapshot } from '../src/lib/menu-monster/menu-snapshot';
import { buildMenuList, lineUpdated, needsLabelCheck } from '../src/lib/menu-monster/menu-view';

/**
 * Brands on the Shopping tab (Plans/Menu-Monster-Brands-Gear.md, release 3): a line reads "any brand" with an
 * "about" price, or names its brands (one line each when there are several); a line the scout changed says
 * Updated; a store-room staple can be bought this trip; "check the label" shows only where it could matter.
 */
const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  addScoutPackageAction: vi.fn(),
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { ShoppingTab } from '../src/app/(public)/library/menu-monster/menus/_components/shopping-tab';

const brand = (id: string, ingredientId: string, name: string, over: Partial<Brand> = {}): Brand => ({ id, ingredientId, name, avoid: null, ...over });
// Bacon has two priced brands and one nobody has priced; oatmeal is a store-room staple; bread has no brands.
const CATALOG: Catalog = {
  ...BASE,
  ingredients: BASE.ingredients.map((i) => (i.id === 'oatmeal' ? { ...i, staple: true } : i)),
  packages: BASE.packages.map((p) =>
    p.id === 'p-bac-kirk' ? { ...p, brandId: 'b-kirk', sizeLabel: '4 × 1 lb' } : p.id === 'p-bac-om' ? { ...p, brandId: 'b-om', sizeLabel: '16 oz' } : { ...p, brandId: null, sizeLabel: null }
  ),
  brands: [brand('b-kirk', 'bacon', 'Kirkland'), brand('b-om', 'bacon', 'Oscar Mayer'), brand('xb-new', 'bacon', 'Farm stand', { isNew: true })]
};
const VERSION = '2026-10-02T12:00:00.000Z';
const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food', context: 'camp', calendarEntryId: null, startDate: null, headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} }, actuals: {},
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B014'], recipeEdits: {} },
    { id: 'm3', day: 1, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }
  ],
  ...over
});
const tab = (m: Menu = menu()) => <ShoppingTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} snapshot={buildSnapshot(m, CATALOG)} />;
const rowFor = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
const withBrands = (brands: NonNullable<Menu['shopping']['brands']>) => menu({ shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands } });
const sent = () => saveMenuAction.mock.calls[0][1] as Menu;

beforeEach(() => {
  vi.clearAllMocks();
  saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
});

describe('Shopping tab — brands', () => {
  it('AnyBrand_ReadsAnyBrand_WithAPlainPrice', () => {
    render(tab());
    const row = rowFor('Bacon');
    expect(row.textContent).toContain('any brand · 2 × 16 oz');
    expect(row.textContent).toContain('$14.98 (estimated)'); // the "(estimated)" is screen-reader text only (2026-10-06)
  });

  // Patrick, 2026-10-06: no per-line marker ("~" read as a minus; "about" was clutter) — the rule is said once.
  it('EstimatedPrice_IsAPlainPrice_SaidOnceUnderTheTotals', () => {
    render(tab());
    expect(rowFor('Bacon').textContent).not.toMatch(/~|about/);
    expect(rowFor('Bacon').textContent).toContain('$14.98');
    expect(screen.getByText('Prices before a brand is chosen use the cheapest brand we know.')).toBeTruthy();
  });

  it('AnIngredientWithNoBrands_HasNoAbout', () => {
    render(tab());
    expect(rowFor('Bread').textContent).not.toContain('about');
  });

  it('OneBrand_NamesItAndItsSize_WithAnExactPrice', () => {
    render(tab(withBrands({ bacon: [{ brandId: 'b-kirk', qty: null }] })));
    const row = rowFor('Bacon');
    expect(row.textContent).toContain('1 × Kirkland, 4 × 1 lb');
    expect(row.textContent).toContain('$18.15');
    expect(row.textContent).not.toContain('about');
  });

  it('SeveralBrands_GetOneLineEach', () => {
    render(tab(withBrands({ bacon: [{ brandId: 'b-kirk', qty: null }, { brandId: 'b-om', qty: null }] })));
    const subs = within(screen.getByRole('list', { name: 'Bacon brands' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(subs).toEqual(['1 × Kirkland, 4 × 1 lb$18.15', '1 × Oscar Mayer, 16 oz$7.49']);
  });

  it('ABrandNobodyHasPriced_IsTaggedNew_WithAPlainPrice', () => {
    render(tab(withBrands({ bacon: [{ brandId: 'xb-new', qty: null }] })));
    const row = rowFor('Bacon');
    expect([row.textContent?.includes('New brand'), row.textContent?.includes('~$')]).toEqual([true, false]);
  });

  it('ChoosingABrandHere_SavesItOnTheMenu', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Bacon/ }));
    await user.click(within(screen.getByRole('group', { name: 'Brand for Bacon' })).getByRole('button', { name: /^Oscar Mayer/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect(sent().shopping.brands).toEqual({ bacon: [{ brandId: 'b-om', qty: null }] });
  });

  it('GoingBackToAnyBrand_LeavesNoBrandsKeyBehind', async () => {
    const user = userEvent.setup();
    render(tab(withBrands({ bacon: [{ brandId: 'b-om', qty: null }] })));
    await user.click(screen.getByRole('button', { name: /^Bacon/ }));
    await user.click(within(screen.getByRole('group', { name: 'Brand for Bacon' })).getByRole('button', { name: 'Any brand' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect('brands' in sent().shopping).toBe(false);
  });

  it('TheCountOfOneBrand_IsThatBrandsCount', async () => {
    const user = userEvent.setup();
    render(tab(withBrands({ bacon: [{ brandId: 'b-om', qty: null }] })));
    await user.click(screen.getByRole('button', { name: /^Bacon/ }));
    await user.click(within(rowFor('Bacon')).getByRole('button', { name: 'One more Bacon package' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect(sent().shopping.brands).toEqual({ bacon: [{ brandId: 'b-om', qty: 3 }] });
  });
});

describe('Shopping tab — Updated', () => {
  it('ALineAsThePlanMadeIt_HasNoPill', () => {
    render(tab());
    expect(within(rowFor('Bacon')).queryByText('Updated')).toBeNull();
  });

  it('AChangedCount_ShowsUpdated_AndPuttingItBackClearsIt', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Bread/ }));
    await user.click(within(rowFor('Bread')).getByRole('button', { name: 'One more Bread package' }));
    expect(within(rowFor('Bread')).getByLabelText('Bread, updated')).toBeTruthy();
    await user.click(within(rowFor('Bread')).getByRole('button', { name: /^Reset to/ }));
    expect(within(rowFor('Bread')).queryByText('Updated')).toBeNull();
  });

  it('BringingItFromHome_ShowsUpdated', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Bread/ }));
    await user.click(within(rowFor('Bread')).getByRole('button', { name: 'Bringing from home' }));
    expect(within(rowFor('Bread')).getByText('Updated')).toBeTruthy();
  });
});

describe('Shopping tab — store-room staples', () => {
  it('AStaple_ComesFromTheStoreRoom_ByDefault', () => {
    render(tab());
    expect(within(rowFor('Instant oatmeal')).getByText('From the troop store room')).toBeTruthy();
  });

  it('AStaple_CanBeBoughtThisTrip_AndThatIsSaved', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Instant oatmeal/ }));
    await user.click(within(rowFor('Instant oatmeal')).getByRole('button', { name: 'Buying it' }));
    const row = rowFor('Instant oatmeal');
    expect([row.textContent?.includes('$5.00'), within(row).getByText('Updated') != null]).toEqual([true, true]);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect(sent().shopping.lineSource).toEqual({ oatmeal: { source: 'buy', note: '' } });
  });

  it('ABoughtStaple_GoesBackToTheStoreRoom', async () => {
    const user = userEvent.setup();
    render(tab(menu({ shopping: { packageChoice: {}, qtyOverride: {}, lineSource: { oatmeal: { source: 'buy', note: '' } } } })));
    await user.click(screen.getByRole('button', { name: /^Instant oatmeal/ }));
    await user.click(within(rowFor('Instant oatmeal')).getByRole('button', { name: 'From the troop store room' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect(sent().shopping.lineSource).toEqual({});
  });
});

describe('check the label', () => {
  const lines = (m: Menu, c: Catalog = CATALOG) => buildMenuList(m, c).lines;
  const bacon = (m: Menu, c: Catalog = CATALOG) => lines(m, c).find((l) => l.ing.id === 'bacon')!;
  const veg = { gf: 0, nut: 0, dairy: 0, veg: 1 };

  it('NeverShows_OnAMenuWithNoDiets', () => {
    expect(needsLabelCheck(bacon(menu()), menu().restrictions, CATALOG)).toBe(false);
  });

  it('Shows_OnAnAnyBrandLine_WhoseIngredientMattersForTheDiet', () => {
    const m = menu({ restrictions: veg });
    expect(needsLabelCheck(bacon(m), m.restrictions, CATALOG)).toBe(true);
  });

  it('DoesNotShow_WhereTheDietDoesNotTouchTheIngredient', () => {
    const m = menu({ restrictions: { gf: 0, nut: 1, dairy: 0, veg: 0 } });
    expect(needsLabelCheck(bacon(m), m.restrictions, CATALOG)).toBe(false);
  });

  it('DoesNotShow_OnceAKnownPricedBrandIsChosen_ButDoesForANewOne', () => {
    const known = withBrands({ bacon: [{ brandId: 'b-om', qty: null }] });
    const fresh = withBrands({ bacon: [{ brandId: 'xb-new', qty: null }] });
    expect([needsLabelCheck(bacon({ ...known, restrictions: veg }), veg, CATALOG), needsLabelCheck(bacon({ ...fresh, restrictions: veg }), veg, CATALOG)]).toEqual([false, true]);
  });

  it('LineUpdated_IsFalse_ForAnUntouchedStaple', () => {
    expect(lineUpdated(lines(menu()).find((l) => l.ing.id === 'oatmeal')!)).toBe(false);
  });
});
