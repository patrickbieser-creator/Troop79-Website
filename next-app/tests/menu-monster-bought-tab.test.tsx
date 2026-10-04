import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * "What we bought" (Plans/Menu-Monster-Brands-Gear.md, release 4; prototype concept-f-kinds/bought.html): a
 * prefilled checklist. Nine lines as planned cost no clicks; a different price is typed and Enter moves on;
 * the row's choices sit inline in its accordion. The mock boundary is the bought actions.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const saveBoughtAction = vi.fn();
const setShoppingDoneAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/bought-actions', () => ({
  saveBoughtAction: (...a: unknown[]) => saveBoughtAction(...a),
  setShoppingDoneAction: (...a: unknown[]) => setShoppingDoneAction(...a)
}));

import { BoughtTab } from '../src/app/(public)/library/menu-monster/menus/_components/bought-tab';
import type { Bought } from '../src/lib/menu-monster/bought';
import type { Brand, Catalog, Package } from '../src/lib/menu-monster/types';
import type { Menu } from '../src/lib/menu-monster/menus';

const pkg = (id: string, ingredientId: string, brandId: string | null, price: number, y: number, size: string): Package => ({
  id, ingredientId, name: id, store: null, price, anchorPrice: price, yield: y, yieldUnitLabel: null, noun: 'box',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-10-01', brandId, sizeLabel: size
});
const brand = (id: string, ingredientId: string, name: string, over: Partial<Brand> = {}): Brand => ({ id, ingredientId, name, avoid: null, ...over });
const cup = { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' as const };
const CATALOG: Catalog = {
  ingredients: [
    { id: 'cereal', name: 'Cold cereal', unit: cup, section: 'dry', staple: false, avoid: [] },
    { id: 'milk', name: 'Milk', unit: cup, section: 'dairy', staple: false, avoid: [] },
    { id: 'oj', name: 'Orange juice', unit: cup, section: 'dairy', staple: false, avoid: [] }
  ],
  packages: [
    pkg('p-cheerios', 'cereal', 'b-cheerios', 6.77, 18, '18 oz'),
    pkg('p-chex', 'cereal', 'b-chex', 6.5, 18, '18 oz'),
    pkg('p-milk', 'milk', null, 5, 16, 'gallon'),
    pkg('p-oj', 'oj', 'b-tropicana', 4.5, 8, '64 oz')
  ],
  conversions: [],
  recipes: [
    {
      id: 'cereal', name: 'Cold cereal', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
      lines: [
        { ingredientId: 'cereal', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: 'milk', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
      ]
    },
    {
      id: 'oj', name: 'Orange juice', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 1,
      lines: [{ ingredientId: 'oj', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
    }
  ],
  brands: [brand('b-cheerios', 'cereal', 'Cheerios'), brand('b-chex', 'cereal', 'Rice Chex'), brand('xb-fl', 'cereal', 'Froot Loops', { isNew: true }), brand('b-tropicana', 'oj', 'Tropicana')]
};
const MENU: Menu = {
  name: 'Fall Campout', context: 'camp', calendarEntryId: 35, startDate: '2026-10-10', headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands: { cereal: [{ brandId: 'b-chex', qty: null }], oj: [{ brandId: 'b-tropicana', qty: null }] } },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['cereal', 'oj'], recipeEdits: {} }]
};
const NONE: Bought = { lines: {}, done: null };
const tab = (over: Partial<Parameters<typeof BoughtTab>[0]> = {}) => <BoughtTab catalog={CATALOG} menuId="menu-1" menu={MENU} bought={NONE} canRecord {...over} />;
const price = (name: string) => screen.getByRole('textbox', { name: `Price for ${name}, dollars` }) as HTMLInputElement;
const rowFor = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
const sent = () => saveBoughtAction.mock.calls[0][1] as Record<string, { status: string; items?: Record<string, unknown>[] }>;

beforeEach(() => {
  vi.clearAllMocks();
  saveBoughtAction.mockImplementation(async () => ({ ok: true, results: {}, bought: NONE }));
  setShoppingDoneAction.mockImplementation(async (_id: string, done: boolean) => ({ ok: true, bought: { lines: {}, done: done ? { by: 'Maya O.', personId: 5, at: '2026-10-12T15:00:00Z' } : null } }));
});

describe('What we bought — the prefilled checklist', () => {
  it('EveryLine_StartsChecked_WithTheExpectedPrice_AndNothingToSave', () => {
    render(tab());
    expect(screen.getAllByRole('checkbox', { name: / bought$/ }).every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect([price('Milk').value, price('Cold cereal').value, price('Orange juice').value]).toEqual(['5.00', '6.50', '4.50']);
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ARow_NamesItsBrand_AndSaysItIsNotConfirmedYet', () => {
    render(tab());
    expect(rowFor('Cold cereal').textContent).toContain('1 × Rice Chex');
    expect(rowFor('Cold cereal').textContent).toContain('not confirmed');
    expect(rowFor('Milk').textContent).toContain('1 × any brand');
  });

  it('TheTotal_IsProjected_UntilSomethingIsRecordedOrDoneIsTicked', () => {
    render(tab());
    expect(screen.getByText(/projected · planned \$16\.00 · 0 of 3 recorded/)).toBeTruthy();
  });

  it('ADifferentPrice_IsTheOnlyThingSent', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.clear(price('Milk'));
    await user.type(price('Milk'), '5.49');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveBoughtAction).toHaveBeenCalledTimes(1));
    expect(saveBoughtAction.mock.calls[0][0]).toBe('menu-1');
    // `seen` is the price the box showed first: the server reports to the price book only what was changed.
    expect(sent()).toEqual({ milk: { status: 'bought', items: [{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5.49, seen: 5 }] } });
  });

  it('Enter_InAPrice_MovesToTheNextPrice_AndNeverSaves', async () => {
    const user = userEvent.setup();
    render(tab());
    const first = screen.getAllByRole('textbox', { name: /^Price for/ })[0];
    const second = screen.getAllByRole('textbox', { name: /^Price for/ })[1];
    await user.click(first);
    await user.keyboard('{Enter}');
    expect([document.activeElement === second, saveBoughtAction.mock.calls.length]).toEqual([true, 0]);
  });

  it('APriceWithAComma_IsNotReadAsHundreds', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.clear(price('Milk'));
    await user.type(price('Milk'), '5,50');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter what Milk cost.')).toBeTruthy();
    expect(saveBoughtAction).not.toHaveBeenCalled();
  });

  it('ABadPrice_StopsTheSave_AndSaysWhich', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.clear(price('Milk'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter what Milk cost.')).toBeTruthy();
    expect(saveBoughtAction).not.toHaveBeenCalled();
  });
});

describe('What we bought — the accordion', () => {
  it('OpeningARow_ShowsThePlan_AndTheChoicesInline', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Cold cereal/ }));
    const row = within(rowFor('Cold cereal'));
    expect(row.getByText(/^Planned: 1 × Rice Chex, for Saturday breakfast\. Needs 8 cups\.$/)).toBeTruthy();
    expect(['Didn’t buy it', 'Different brand', 'Add another brand'].map((n) => row.getByRole('button', { name: n }) != null)).toEqual([true, true, true]);
  });

  it('TwoRows_StayOpenTogether', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Cold cereal/ }));
    await user.click(screen.getByRole('button', { name: /^Milk/ }));
    expect(screen.getAllByRole('button', { name: 'Didn’t buy it' })).toHaveLength(2);
  });

  it('DidntBuyIt_UnchecksTheRow_AndIsSaved', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Milk/ }));
    await user.click(within(rowFor('Milk')).getByRole('button', { name: 'Didn’t buy it' }));
    expect((screen.getByRole('checkbox', { name: 'Milk bought' }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveBoughtAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ milk: { status: 'not_bought' } });
  });

  it('UncheckingTheBox_IsTheSameAsDidntBuyIt', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('checkbox', { name: 'Milk bought' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveBoughtAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ milk: { status: 'not_bought' } });
  });

  it('DifferentBrand_SwapsInAKnownBrand_AtItsPrice', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Cold cereal/ }));
    await user.click(within(rowFor('Cold cereal')).getByRole('button', { name: 'Different brand' }));
    await user.click(within(screen.getByRole('group', { name: 'Which brand of Cold cereal was bought' })).getByRole('button', { name: /^Cheerios/ }));
    expect(price('Cold cereal').value).toBe('6.77');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveBoughtAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ cereal: { status: 'bought', items: [{ brandId: 'b-cheerios', packageId: 'p-cheerios', qty: 1, pricePaid: 6.77 }] } });
  });

  it('AddAnotherBrand_AddsASecondItem_EachWithItsOwnPrice', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Cold cereal/ }));
    await user.click(within(rowFor('Cold cereal')).getByRole('button', { name: 'Add another brand' }));
    await user.click(within(screen.getByRole('group', { name: 'Another brand of Cold cereal' })).getByRole('button', { name: /^Cheerios/ }));
    expect(screen.getByRole('textbox', { name: 'Price for Cheerios Cold cereal, dollars' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveBoughtAction).toHaveBeenCalledTimes(1));
    expect(sent().cereal.items?.map((x) => x.packageId)).toEqual(['p-chex', 'p-cheerios']);
  });

  it('SomethingElse_AsksForTheBrandItsSizeAndItsPrice', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Cold cereal/ }));
    await user.click(within(rowFor('Cold cereal')).getByRole('button', { name: 'Different brand' }));
    await user.click(screen.getByRole('button', { name: 'Something else…' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter what Cold cereal cost.')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Brand of Cold cereal' }), 'Lucky Charms');
    await user.type(screen.getByRole('textbox', { name: 'How much one package holds' }), '12');
    await user.type(price('Cold cereal'), '5.25');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveBoughtAction).toHaveBeenCalledTimes(1));
    expect(sent().cereal.items?.[0]).toMatchObject({ brandId: null, packageId: null, qty: 1, pricePaid: 5.25, newBrand: { name: 'Lucky Charms', size: 12, sizeUnit: 'cup' } });
  });

  it('ABrandNobodyHasPriced_GetsItsFirstPriceHere_WithASize', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Cold cereal/ }));
    await user.click(within(rowFor('Cold cereal')).getByRole('button', { name: 'Different brand' }));
    await user.click(within(screen.getByRole('group', { name: 'Which brand of Cold cereal was bought' })).getByRole('button', { name: /^Froot Loops/ }));
    expect((screen.getByRole('textbox', { name: 'Brand of Cold cereal' }) as HTMLInputElement).value).toBe('Froot Loops');
    expect(price('Cold cereal').value).toBe('');
  });

  it('Undo_PutsAnEditedRowBack', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: /^Milk/ }));
    await user.click(within(rowFor('Milk')).getByRole('button', { name: 'Didn’t buy it' }));
    await user.click(within(rowFor('Milk')).getByRole('button', { name: 'Undo' }));
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('What we bought — who recorded, done, held', () => {
  const recorded: Bought = {
    lines: {
      milk: { status: 'bought', items: [{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5.49 }], by: 'Maya O.', personId: 5, at: '2026-10-12T15:00:00Z' },
      oj: { status: 'not_bought', items: [], by: 'Sam K.', personId: 6, at: '2026-10-13T15:00:00Z' }
    },
    done: null
  };

  it('ShowsWhoRecordedEachLine_AndEveryoneWhoDid', () => {
    render(tab({ bought: recorded }));
    expect(rowFor('Milk').textContent).toContain('changed · Maya O.');
    expect(rowFor('Orange juice').textContent).toContain('not bought · Sam K.');
    expect(screen.getByText('Recorded by Maya O. and Sam K. · Oct 13, 2026')).toBeTruthy();
  });

  it('TheDoneTick_MakesUntouchedLinesAsPlanned_AndTheTotalPaid', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('checkbox', { name: /We’re done shopping/ }));
    await waitFor(() => expect(setShoppingDoneAction).toHaveBeenCalledWith('menu-1', true));
    await waitFor(() => expect(rowFor('Milk').textContent).toContain('as planned'));
    expect(screen.getByText(/paid · planned \$16\.00 · 3 of 3 recorded/)).toBeTruthy();
  });

  it('TheDoneTick_WaitsForUnsavedChanges', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('checkbox', { name: 'Milk bought' }));
    expect((screen.getByRole('checkbox', { name: /We’re done shopping/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('AHeldPrice_IsSaid_OnTheRowAndInTheStatusLine', async () => {
    saveBoughtAction.mockResolvedValue({ ok: true, results: { milk: 'held' }, bought: { lines: { milk: { status: 'bought', items: [{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 12 }], by: 'Maya O.', personId: 5, at: '2026-10-12T15:00:00Z' } }, done: null } });
    const user = userEvent.setup();
    render(tab());
    await user.clear(price('Milk'));
    await user.type(price('Milk'), '12');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('⚑ Held for a leader')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/a leader will check it/);
  });

  it('ASaveThatFails_KeepsTheEdits_AndSaysWhy', async () => {
    saveBoughtAction.mockResolvedValue({ ok: false, error: 'Sign in as a scout on this outing to record what was bought.' });
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('checkbox', { name: 'Milk bought' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Sign in as a scout on this outing to record what was bought.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('AReader_SeesTheRowsAsText_WithNothingToPress', () => {
    render(tab({ canRecord: false, bought: recorded }));
    expect([screen.queryAllByRole('checkbox').length, screen.queryAllByRole('textbox').length, screen.queryByRole('button', { name: /Save|Saved/ })]).toEqual([0, 0, null]);
    expect(rowFor('Milk').textContent).toContain('$5.49');
  });
});
