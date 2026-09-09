import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PriceBook } from '../src/app/admin/(workspace)/library/menu-monster/price-book';
import {
  changeIngredientUnit,
  createIngredient,
  createPackage,
  updatePackage
} from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog, Ingredient, Package } from '../src/lib/menu-monster/types';

/**
 * Menu Monster leader tools — Price book (Plans/Menu-Monster-Leader-Tools.md,
 * Test Plan — DOM). The mock boundary is the actions module: assert on what
 * the editor sent. Today is a prop so the stale and as-of behaviour is
 * deterministic.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  createIngredient: vi.fn(async () => ({ ok: true, id: 'new-thing' })),
  updateIngredient: vi.fn(async () => ({ ok: true })),
  retireIngredient: vi.fn(async () => ({ ok: true })),
  restoreIngredient: vi.fn(async () => ({ ok: true })),
  changeIngredientUnit: vi.fn(async () => ({ ok: true })),
  addConversion: vi.fn(async () => ({ ok: true, id: '9' })),
  deleteConversion: vi.fn(async () => ({ ok: true })),
  createPackage: vi.fn(async () => ({ ok: true, id: 'p-new' })),
  updatePackage: vi.fn(async () => ({ ok: true })),
  retirePackage: vi.fn(async () => ({ ok: true })),
  restorePackage: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(createPackage).mockClear();
  vi.mocked(updatePackage).mockClear();
  vi.mocked(createIngredient).mockClear();
  vi.mocked(changeIngredientUnit).mockClear();
});

const TODAY = '2026-09-08';

const ING: Ingredient[] = [
  { id: 'milk', name: 'Milk', unit: UNITS.cup, section: 'dairy', staple: false, avoid: ['dairy'], retiredAt: null },
  { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'oj', name: 'Orange juice', unit: UNITS.cup, section: 'dairy', staple: false, avoid: [], retiredAt: null }
];
const PK: Package[] = [
  {
    id: 'p-milk-gal', ingredientId: 'milk', name: 'Milk, gallon', store: 'Kroger', price: 3.49, yield: 16,
    yieldUnitLabel: null, noun: 'gallon', soldSize: 1, soldUnit: 'gallon', note: null, asOf: '2026-05-01', retiredAt: null
  },
  {
    id: 'p-mix-10lb', ingredientId: 'pancake-mix', name: 'Krusteaz Pancake Mix, 10 lb', store: 'Costco', price: 15, yield: 36,
    yieldUnitLabel: null, noun: 'bag', soldSize: 10, soldUnit: 'lb', note: null, asOf: '2026-09-01', retiredAt: null
  }
];
const CATALOG: Catalog = {
  ingredients: ING,
  packages: PK,
  conversions: [{ ingredientId: 'pancake-mix', from: 'ozw', to: 'cup', factor: 1 / 4.5, label: 'pancake mix ≈ 4.5 oz per cup' }],
  recipes: [
    { id: 'pancakes', name: 'Pancakes', status: 'published', mealFit: ['breakfast'], foodGroups: ['grain'], camp: true, trail: false, method: 'stove', stepsMd: null, sortOrder: 10,
      lines: [{ ingredientId: 'pancake-mix', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] }
  ]
};

const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) });

describe('Price book', () => {
  it('Leader_SeesStatusPerIngredient_NeverColorOnly', () => {
    render(<PriceBook catalog={CATALOG} today={TODAY} />);
    expect(within(row('Orange juice')).getByText('Unpriced')).toBeTruthy();
    expect(within(row('Milk')).getByText('Stale')).toBeTruthy();
    expect(within(row('Pancake mix')).getByText('OK')).toBeTruthy();
  });

  it('Leader_SeesYieldSuggestion_WhileAddingPackage', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const add = screen.getByRole('region', { name: 'Add a package' });

    expect(within(add).getByText('Type the size on the label and the tool will suggest how many cups it makes.')).toBeTruthy();
    await user.type(within(add).getByLabelText('Product name'), 'Kroger 2% Milk');
    await user.type(within(add).getByLabelText('Price'), '3.29');
    await user.type(within(add).getByLabelText('Package size'), '1');
    await user.selectOptions(within(add).getByLabelText('Sold by'), 'gallon');
    expect(within(add).getByText('Suggested: ≈ 16 cups from 1 gallon.')).toBeTruthy();
    // The suggestion lands in the yield field until the leader types over it.
    expect((within(add).getByLabelText('How many cups it makes') as HTMLInputElement).value).toBe('16');

    await user.click(within(add).getByRole('button', { name: 'Add package' }));
    await waitFor(() => expect(createPackage).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(createPackage).mock.calls[0][0];
    expect(sent).toMatchObject({ ingredientId: 'milk', name: 'Kroger 2% Milk', price: 3.29, soldSize: 1, soldUnit: 'gallon', yield: 16, asOf: TODAY });
  });

  it('Leader_SeesBigChangeFlag_WhenEditingPrice', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const card = screen.getByRole('region', { name: 'Milk, gallon' });

    // Already saved: the Save reads Saved and is off; the stale flag shows.
    const save = within(card).getByRole('button', { name: 'Saved' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getByText('Price is 130 days old — still used, but check it.')).toBeTruthy();

    const price = within(card).getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '4.99');
    expect(within(card).getByText('⚠ Big change (+43%) — flagged for a second look')).toBeTruthy();
    // Editing the price moved the as-of to today.
    expect((within(card).getByLabelText('Price as of') as HTMLInputElement).value).toBe(TODAY);

    await user.click(within(card).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updatePackage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updatePackage).mock.calls[0][0]).toBe('p-milk-gal');
    expect(vi.mocked(updatePackage).mock.calls[0][1]).toMatchObject({ price: 4.99, asOf: TODAY });
  });

  it('Leader_PreviewsUnitChange_BeforeSaving', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} />);
    await user.click(within(row('Pancake mix')).getByRole('button', { name: 'Pancake mix' }));
    await user.click(screen.getByRole('button', { name: 'Change unit' }));
    const dlg = screen.getByRole('dialog', { name: /Change the recipe unit/ });
    await user.selectOptions(within(dlg).getByLabelText('Recipe unit'), 'tbsp');
    expect(within(dlg).getByText('1 package will convert automatically (1 cup = 16 Tbsp).')).toBeTruthy();
    expect(within(dlg).getByText(/1 recipe line keeps cups and still costs out/)).toBeTruthy();
    await user.click(within(dlg).getByRole('button', { name: 'Change unit' }));
    await waitFor(() => expect(changeIngredientUnit).toHaveBeenCalledWith('pancake-mix', UNITS.tbsp));
  });

  it('Leader_AddsAnIngredient_ThatStartsUnpriced', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} />);
    await user.click(screen.getByRole('button', { name: '+ New ingredient' }));
    const panel = screen.getByRole('region', { name: 'New ingredient' });
    expect(within(panel).getByText('It starts unpriced — add a package below to make it usable.')).toBeTruthy();
    await user.type(within(panel).getByLabelText('Name'), 'Bananas');
    await user.selectOptions(within(panel).getByLabelText('Measured by'), 'count');
    await user.type(within(panel).getByLabelText('One is called'), 'banana');
    await user.type(within(panel).getByLabelText('Several are called'), 'bananas');
    await user.selectOptions(within(panel).getByLabelText('Store section'), 'produce');
    await user.click(within(panel).getByRole('button', { name: 'Add ingredient' }));
    await waitFor(() => expect(createIngredient).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createIngredient).mock.calls[0][0]).toMatchObject({
      name: 'Bananas',
      unit: { kind: 'count', key: 'count', one: 'banana', many: 'bananas' },
      section: 'produce',
      staple: false,
      avoid: []
    });
  });
});
