import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PriceBook } from '../src/app/admin/(workspace)/library/menu-monster/price-book';
import {
  addBought,
  putFoodOnMenu,
  takeFoodOffMenu,
  createBrand,
  changeIngredientUnit,
  createFood,
  setPackageBrand,
  updateIngredient,
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
  createFood: vi.fn(async () => ({ ok: true, id: 'new-thing' })),
  updateIngredient: vi.fn(async () => ({ ok: true })),
  retireIngredient: vi.fn(async () => ({ ok: true })),
  restoreIngredient: vi.fn(async () => ({ ok: true })),
  changeIngredientUnit: vi.fn(async () => ({ ok: true })),
  addConversion: vi.fn(async () => ({ ok: true, id: '9' })),
  deleteConversion: vi.fn(async () => ({ ok: true })),
  addBought: vi.fn(async () => ({ ok: true, id: 'p-new' })),
  setPackageBrand: vi.fn(async () => ({ ok: true })),
  putFoodOnMenu: vi.fn(async () => ({ ok: true })),
  takeFoodOffMenu: vi.fn(async () => ({ ok: true })),
  createBrand: vi.fn(async () => ({ ok: true })),
  renameBrand: vi.fn(async () => ({ ok: true })),
  setBrandDiets: vi.fn(async () => ({ ok: true })),
  mergeBrand: vi.fn(async () => ({ ok: true })),
  moveBrand: vi.fn(async () => ({ ok: true })),
  removeBrand: vi.fn(async () => ({ ok: true })),
  updatePackage: vi.fn(async () => ({ ok: true })),
  retirePackage: vi.fn(async () => ({ ok: true })),
  restorePackage: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(addBought).mockClear();
  vi.mocked(putFoodOnMenu).mockClear();
  vi.mocked(takeFoodOffMenu).mockClear();
  vi.mocked(setPackageBrand).mockClear();
  vi.mocked(updateIngredient).mockClear();
  vi.mocked(updatePackage).mockClear();
  vi.mocked(createFood).mockClear();
  vi.mocked(changeIngredientUnit).mockClear();
});

const TODAY = '2026-09-08';
/** The active store names the page reads from mm_stores. Aldi is not a seeded store. */
const STORES = ['Costco', 'Kroger', 'Aldi'];

const ING: Ingredient[] = [
  { id: 'milk', name: 'Milk', unit: UNITS.cup, section: 'dairy', staple: false, avoid: ['dairy'], retiredAt: null },
  { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'oj', name: 'Orange juice', unit: UNITS.cup, section: 'dairy', staple: false, avoid: [], retiredAt: null }
];
const PK: Package[] = [
  {
    id: 'p-milk-gal', ingredientId: 'milk', name: 'Milk, gallon', store: 'Kroger', price: 3.49, anchorPrice: 3.49, yield: 16,
    yieldUnitLabel: null, noun: 'gallon', soldSize: 1, soldUnit: 'gallon', note: null, asOf: '2026-05-01', retiredAt: null
  },
  {
    id: 'p-mix-10lb', ingredientId: 'pancake-mix', name: 'Krusteaz Pancake Mix, 10 lb', store: 'Costco', price: 15, anchorPrice: 15, yield: 36,
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

/** Opens "Add a price" (closed until asked for) and returns its form. A price, not a purchase: a shelf price or a guess will do. */
const openAdd = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Add a price' }));
  return screen.getByRole('region', { name: 'Add a price' });
};
const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) });

describe('Price book', () => {
  it('Leader_SeesStatusPerIngredient_NeverColorOnly', () => {
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    expect(within(row('Orange juice')).getByText('Unpriced')).toBeTruthy();
    expect(within(row('Milk')).getByText('Stale')).toBeTruthy();
    expect(within(row('Pancake mix')).getByText('OK')).toBeTruthy();
  });

  it('Leader_OpensAnIngredient_DirectlyUnderTheRowTheyClicked', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    // The very next table row is Milk's own detail, not something below the whole list.
    const next = row('Milk').nextElementSibling as HTMLElement;
    expect(within(next).getByRole('region', { name: 'Milk details' })).toBeTruthy();
    // Clicking the row again closes it.
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    expect(screen.queryByRole('region', { name: 'Milk details' })).toBeNull();
  });

  it('Leader_SeesYieldSuggestion_WhileAddingWhatTheyBought', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const add = await openAdd(user);

    expect(within(add).getByText('Type the size on the label and the tool will suggest how many cups are in it.')).toBeTruthy();
    await user.type(within(add).getByLabelText('Product name (optional)'), 'Kroger 2% Milk');
    await user.type(within(add).getByLabelText('Price'), '3.29');
    await user.type(within(add).getByLabelText('Package size'), '1');
    await user.selectOptions(within(add).getByLabelText('The label is in'), 'gallon');
    expect(within(add).getByText('Suggested: ≈ 16 cups from 1 gallon.')).toBeTruthy();
    // The suggestion lands in the yield field until the leader types over it.
    expect((within(add).getByLabelText('How many cups are in it') as HTMLInputElement).value).toBe('16');

    await user.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addBought).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(addBought).mock.calls[0][0];
    expect(sent).toMatchObject({ ingredientId: 'milk', name: 'Kroger 2% Milk', price: 3.29, soldSize: 1, soldUnit: 'gallon', yield: 16, asOf: TODAY, brandId: null, newBrand: null, sizeLabel: '1 gallon' });
  });

  it('Leader_IsToldTheTypedYieldBecomesTheConversion_WhenNoneIsOnFile', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(within(row('Orange juice')).getByRole('button', { name: 'Orange juice' }));
    const add = await openAdd(user);
    await user.type(within(add).getByLabelText('Package size'), '20');
    await user.selectOptions(within(add).getByLabelText('The label is in'), 'ozw');
    expect(within(add).getByText(/^No conversion on file for Orange juice sold by the oz\./)).toBeTruthy();

    await user.type(within(add).getByLabelText('How many cups are in it'), '4');
    expect(within(add).getByText('Saves 1 oz = 0.2 cups as the conversion for Orange juice.')).toBeTruthy();
  });

  it('Leader_SeesBigChangeFlag_WhenEditingPrice', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const line = screen.getByRole('listitem', { name: 'Milk, gallon' });
    // The stale flag shows on the line itself, before anything is opened.
    expect(within(line).getByText('Price is 130 days old — still used, but check it.')).toBeTruthy();
    await user.click(within(line).getByRole('button', { name: 'Edit Milk, gallon' }));

    // Already saved: the Save reads Saved and is off.
    const save = within(line).getByRole('button', { name: 'Saved' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    const price = within(line).getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '4.99');
    expect(within(line).getByText('⚠ Big change (+43%) — flagged for a second look')).toBeTruthy();
    // Editing the price moved the as-of to today.
    expect((within(line).getByLabelText('Price as of') as HTMLInputElement).value).toBe(TODAY);

    await user.click(within(line).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updatePackage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updatePackage).mock.calls[0][0]).toBe('p-milk-gal');
    expect(vi.mocked(updatePackage).mock.calls[0][1]).toMatchObject({ price: 4.99, asOf: TODAY });
    // Its brand did not change, so the brand is not written again.
    expect(setPackageBrand).not.toHaveBeenCalled();
  });

  it('Leader_PreviewsUnitChange_BeforeSaving', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
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
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(screen.getByRole('button', { name: '+ New ingredient' }));
    const panel = screen.getByRole('region', { name: 'New ingredient' });
    await user.type(within(panel).getByLabelText('Name'), 'Bananas');
    await user.selectOptions(within(panel).getByLabelText('Measured by'), 'count');
    await user.type(within(panel).getByLabelText('One is called'), 'banana');
    await user.type(within(panel).getByLabelText('Several are called'), 'bananas');
    await user.selectOptions(within(panel).getByLabelText('Store section'), 'produce');
    await user.click(within(panel).getByRole('button', { name: 'Add ingredient' }));
    await waitFor(() => expect(createFood).toHaveBeenCalledTimes(1));
    // No price typed and not on the menu by itself: an ingredient only.
    expect(vi.mocked(createFood).mock.calls[0][0]).toMatchObject({
      ingredient: { name: 'Bananas', unit: { kind: 'count', key: 'count', one: 'banana', many: 'bananas' }, section: 'produce', staple: false, avoid: [] },
      package: null,
      menu: null
    });
  });

  it('Leader_PicksAStoreFromTheTable_WhenAddingWhatTheyBought', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const add = await openAdd(user);
    const options = within(within(add).getByLabelText('Store')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['— pick —', 'Costco', 'Kroger', 'Aldi']);
  });

  it('Leader_PicksAStoreFromTheTable_WhenEditingAPrice', async () => {
    const user = userEvent.setup();
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={STORES} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const line = screen.getByRole('listitem', { name: 'Milk, gallon' });
    await user.click(within(line).getByRole('button', { name: 'Edit Milk, gallon' }));
    const options = within(within(line).getByLabelText('Store')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['— not set —', 'Costco', 'Kroger', 'Aldi']);
  });

  it('Leader_KeepsARetiredStoreSelectable_WhenEditingAPriceThatCarriesIt', async () => {
    const user = userEvent.setup();
    // Kroger was retired: it is no longer in the active list, but the milk package still carries it.
    render(<PriceBook catalog={CATALOG} today={TODAY} stores={['Costco', 'Aldi']} />);
    await user.click(within(row('Milk')).getByRole('button', { name: 'Milk' }));
    const line = screen.getByRole('listitem', { name: 'Milk, gallon' });
    await user.click(within(line).getByRole('button', { name: 'Edit Milk, gallon' }));
    const select = within(line).getByLabelText('Store') as HTMLSelectElement;
    expect(select.value).toBe('Kroger');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('Kroger');
    const add = await openAdd(user);
    expect(within(within(add).getByLabelText('Store')).queryByRole('option', { name: 'Kroger' })).toBeNull();
  });
});

/**
 * One list that reads the way the shelf does (Patrick, 2026-10-05: "What is the link between the brand list
 * and the information below? … How is adding a package different than adding a brand?"). A brand is a
 * heading, what is priced under it is a line, and adding is one act.
 */
describe('Price book — brands and what is priced under them', () => {
  const SALT: Catalog = {
    ingredients: [{ id: 'salt', name: 'Salt', unit: UNITS.tsp, section: 'dry', staple: true, avoid: [], retiredAt: null }],
    packages: [
      {
        id: 'p-morton', ingredientId: 'salt', name: 'Morton Iodized Salt', store: 'Kroger', price: 1.99, anchorPrice: 1.99, yield: 122,
        yieldUnitLabel: null, noun: 'pack', soldSize: 26, soldUnit: 'ozw', note: null, asOf: '2026-09-01', retiredAt: null, brandId: 'b-morton', sizeLabel: '26 oz'
      },
      {
        id: 'p-plain', ingredientId: 'salt', name: 'Iodized Salt', store: 'Aldi', price: 0.89, anchorPrice: 0.89, yield: 122,
        yieldUnitLabel: null, noun: 'pack', soldSize: 26, soldUnit: 'ozw', note: null, asOf: '2026-09-01', retiredAt: null
      }
    ],
    conversions: [],
    recipes: [],
    brands: [
      { id: 'b-morton', ingredientId: 'salt', name: 'Morton', avoid: null, isNew: false },
      { id: 'b-store', ingredientId: 'salt', name: 'Store brand', avoid: null, isNew: true }
    ]
  };
  const openSalt = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<PriceBook catalog={SALT} today={TODAY} stores={STORES} />);
    await user.click(within(row('Salt')).getByRole('button', { name: 'Salt' }));
  };

  it('Leader_SeesEachPricedThing_UnderItsBrand', async () => {
    await openSalt(userEvent.setup());
    const morton = screen.getByRole('region', { name: 'Morton' });
    const line = within(morton).getByRole('listitem', { name: 'Morton Iodized Salt' });
    expect(line.textContent).toContain('26 oz · Kroger · $1.99 · $0.02 per tsp');
    // The unbranded one is not lost: it has a group of its own.
    expect(within(screen.getByRole('region', { name: 'No brand yet' })).getByRole('listitem', { name: 'Iodized Salt' })).toBeTruthy();
  });

  it('Leader_SeesABrandWithNothingPriced_SaysSo', async () => {
    await openSalt(userEvent.setup());
    expect(within(screen.getByRole('region', { name: 'Store brand' })).getByText('No price yet')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Morton' })).queryByText('No price yet')).toBeNull();
  });

  it('Leader_AddsASizeUnderABrand_WithThatBrandAlreadyChosen', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    await user.click(screen.getByRole('button', { name: 'Add a size or store for Store brand' }));
    const add = screen.getByRole('region', { name: 'Add a price' });
    expect((within(add).getByLabelText('Brand') as HTMLSelectElement).value).toBe('b-store');
    await user.type(within(add).getByLabelText('Package size'), '26');
    await user.selectOptions(within(add).getByLabelText('The label is in'), 'ozw');
    await user.type(within(add).getByLabelText('How many tsp are in it'), '122');
    await user.type(within(add).getByLabelText('Price'), '0.79');
    await user.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addBought).toHaveBeenCalledTimes(1));
    // No product name typed: the brand, the food and the size name it.
    expect(vi.mocked(addBought).mock.calls[0][0]).toMatchObject({ name: 'Store brand Salt, 26 oz', brandId: 'b-store', newBrand: null, sizeLabel: '26 oz', price: 0.79 });
  });

  it('Leader_TypesANewBrand_InTheSameForm', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    const add = await openAdd(user);
    await user.selectOptions(within(add).getByLabelText('Brand'), 'A new brand…');
    // Nothing to add until the brand has a name.
    await user.type(within(add).getByLabelText('Price'), '2.49');
    expect((within(add).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(add).getByLabelText('New brand'), 'Diamond Crystal');
    await user.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addBought).toHaveBeenCalledTimes(1));
    expect(vi.mocked(addBought).mock.calls[0][0]).toMatchObject({ name: 'Diamond Crystal Salt', brandId: null, newBrand: 'Diamond Crystal' });
  });

  it('Leader_AddsABrandByNameOnly_BeforeAnyoneHasAPrice', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    await user.click(screen.getByRole('button', { name: 'Add a brand' }));
    await user.type(screen.getByLabelText('New brand of salt'), 'Diamond Crystal');
    await user.click(screen.getByRole('button', { name: 'Add brand' }));
    await waitFor(() => expect(createBrand).toHaveBeenCalledWith('salt', 'Diamond Crystal'));
  });

  it('Leader_MovesAPricedThingToABrand_FromItsOwnEditor', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    const line = screen.getByRole('listitem', { name: 'Iodized Salt' });
    await user.click(within(line).getByRole('button', { name: 'Edit Iodized Salt' }));
    await user.selectOptions(within(line).getByLabelText('Brand'), 'Store brand');
    await user.click(within(line).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(setPackageBrand).toHaveBeenCalledWith('p-plain', 'b-store', ''));
  });

  it('Leader_FixesATypoInTheIngredientsName', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('region', { name: 'Edit Salt' });
    const name = within(form).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Table salt');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateIngredient).toHaveBeenCalledWith('salt', { name: 'Table salt', section: 'dry', staple: true, avoid: [] }));
  });

  // One entry for a single food (Plans/Menu-Monster-Single-Food-Entry.md): the Price book says whether the
  // food is on the menu by itself, and puts it there or takes it off, without a second entry on another tab.
  it('Leader_SeesAFoodIsNotOnTheMenuByItself_AndPutsItThere', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    const section = within(screen.getByRole('region', { name: 'Salt on the menu by itself' }));
    expect(section.getByText('No. It is only an ingredient in recipes.')).toBeTruthy();
    await user.click(section.getByRole('button', { name: 'Put it on the menu' }));
    const amount = section.getByLabelText('Each person gets');
    await user.clear(amount);
    await user.type(amount, '2');
    // Nothing to save until it fits a meal.
    expect((section.getByRole('button', { name: 'Put it on the menu' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(section.getByLabelText('Snack'));
    await user.click(section.getByRole('button', { name: 'Put it on the menu' }));
    await waitFor(() => expect(putFoodOnMenu).toHaveBeenCalledWith('salt', { amount: '2', mealFit: ['snack'], foodGroups: [] }));
  });

  it('Leader_SeesAFoodThatIsOnTheMenu_AndTakesItOff', async () => {
    const user = userEvent.setup();
    const onMenu: Catalog = {
      ...SALT,
      recipes: [
        {
          id: 'salt-item', name: 'Salt', status: 'published', mealFit: ['snack', 'dessert'], foodGroups: [], camp: true, trail: false, method: 'no-cook', stepsMd: null, sortOrder: 10,
          lines: [{ ingredientId: 'salt', qtyPerPerson: 2, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }], foodIngredientId: 'salt'
        }
      ]
    };
    render(<PriceBook catalog={onMenu} today={TODAY} stores={STORES} />);
    await user.click(within(row('Salt')).getByRole('button', { name: 'Salt' }));
    const section = within(screen.getByRole('region', { name: 'Salt on the menu by itself' }));
    expect(section.getByText('2 tsp each · Snack, Dessert')).toBeTruthy();
    expect(section.getByText('Published')).toBeTruthy();
    expect(section.getByRole('link', { name: 'Steps, gear and diets for salt →' }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=recipes&recipe=salt-item');
    await user.click(section.getByRole('button', { name: 'Take it off the menu' }));
    await waitFor(() => expect(takeFoodOffMenu).toHaveBeenCalledWith('salt'));
  });

  it('Leader_OpensConversions_OnlyWhenTheyWantThem', async () => {
    const user = userEvent.setup();
    await openSalt(user);
    expect(screen.queryByRole('region', { name: 'Conversions' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Conversions \(0\)/ }));
    expect(screen.getByRole('region', { name: 'Conversions' })).toBeTruthy();
  });
});

/**
 * Patrick, adding a price for Cookies (2026-10-05): "Under package size do I put in the cookie count or
 * 1 lb 2.2 oz? … 'How many cookies does it make' makes no sense here." A counted food starts on its own
 * unit and asks one thing: how many are in the package.
 */
describe('Price book — adding a price for a counted food', () => {
  const COOKIES: Catalog = {
    ingredients: [{ id: 'cookies', name: 'Cookies', unit: { key: 'count', one: 'cookie', many: 'cookies', kind: 'count' }, section: 'dry', staple: false, avoid: [], retiredAt: null }],
    packages: [],
    conversions: [],
    recipes: [],
    brands: [{ id: 'b-ahoy', ingredientId: 'cookies', name: 'Chips Ahoy', avoid: null, isNew: true }]
  };
  const openCookies = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<PriceBook catalog={COOKIES} today={TODAY} stores={STORES} />);
    await user.click(within(row('Cookies')).getByRole('button', { name: 'Cookies' }));
    await user.click(screen.getByRole('button', { name: 'Add a size or store for Chips Ahoy' }));
    return screen.getByRole('region', { name: 'Add a price' });
  };

  it('AsksHowManyAreInThePackage_AndNothingAboutWhatItMakes', async () => {
    const add = await openCookies(userEvent.setup());
    expect((within(add).getByLabelText('The label is in') as HTMLSelectElement).value).toBe('count');
    expect(within(add).getByLabelText('How many cookies in the package')).toBeTruthy();
    // The second box is not shown: for a label in cookies, the size is the answer.
    expect(within(add).getByLabelText('How many cookies are in it').closest('[hidden]')).not.toBeNull();
  });

  it('SendsTheCountAsWhatThePackageHolds', async () => {
    const user = userEvent.setup();
    const add = await openCookies(user);
    await user.type(within(add).getByLabelText('How many cookies in the package'), '40');
    await user.type(within(add).getByLabelText('Price'), '7.29');
    await user.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addBought).toHaveBeenCalledTimes(1));
    expect(vi.mocked(addBought).mock.calls[0][0]).toMatchObject({ name: 'Chips Ahoy Cookies, 40 cookies', brandId: 'b-ahoy', soldSize: 40, soldUnit: 'count', yield: 40, price: 7.29, sizeLabel: '40 cookies' });
  });

  it('ALabelInOunces_AsksHowManyCookiesThatIs', async () => {
    const user = userEvent.setup();
    const add = await openCookies(user);
    await user.selectOptions(within(add).getByLabelText('The label is in'), 'ozw');
    expect(within(add).getByLabelText('Package size')).toBeTruthy();
    expect(within(add).getByLabelText('How many cookies are in it').closest('[hidden]')).toBeNull();
    await user.type(within(add).getByLabelText('Package size'), '18.2');
    expect(within(add).getByText(/^No conversion on file for Cookies sold by the oz\. Type how many cookies are in this package\./)).toBeTruthy();
  });
});
