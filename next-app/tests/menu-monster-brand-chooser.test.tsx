import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { BrandChooser, brandSummary, brandsFor } from '../src/app/(public)/library/menu-monster/menus/_components/brand-chooser';
import { buildLines } from '../src/lib/menu-monster/engine';
import { BrandDetailDialog } from '../src/app/(public)/library/menu-monster/menus/_components/brand-detail-dialog';
import { StoreNamesScope } from '../src/app/(public)/library/menu-monster/menus/_components/store-names';
import type { AddedPackage } from '../src/app/(public)/library/menu-monster/menus/_components/add-package-form';
import { settleNewBrands } from '../src/lib/menu-monster/brand-detail';
import type { Brand, BrandPick, Catalog, Package, Plan } from '../src/lib/menu-monster/types';

const addScoutPackageAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  addScoutPackageAction: (...a: unknown[]) => addScoutPackageAction(...a)
}));
beforeEach(() => vi.clearAllMocks());

/**
 * The brand chooser (Plans/Menu-Monster-Brands-Gear.md, release 3): any brand, one, or several per ingredient;
 * a typed brand joins at once; several brands each get a package count. It holds no menu state, so the tests
 * drive it through a tiny harness that prices the picks with the real engine.
 */
const pkg = (id: string, brandId: string | null, price: number): Package => ({
  id, ingredientId: 'cereal', name: id, store: null, price, anchorPrice: price, yield: 18, yieldUnitLabel: null, noun: 'box',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-10-01', brandId, sizeLabel: '18 oz'
});
const brand = (id: string, name: string, over: Partial<Brand> = {}): Brand => ({ id, ingredientId: 'cereal', name, avoid: null, ...over });
const CEREAL = { id: 'cereal', name: 'Cold cereal', unit: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' as const }, section: 'dry' as const, staple: false, avoid: [] };
const CATALOG: Catalog = {
  ingredients: [CEREAL],
  packages: [pkg('p-cheerios', 'b-cheerios', 6.77), pkg('p-chex', 'b-chex', 6.5), pkg('p-store', null, 3)],
  conversions: [],
  recipes: [
    {
      id: 'cereal', name: 'Cold cereal', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
      lines: [{ ingredientId: 'cereal', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
    }
  ],
  brands: [brand('b-cheerios', 'Cheerios'), brand('b-chex', 'Rice Chex'), brand('xb-new', 'Froot Loops', { isNew: true })]
};

function Harness({
  initial = [],
  onType,
  detail = true,
  stores = [],
  onAnnounce
}: {
  initial?: BrandPick[];
  onType?: (name: string) => Promise<{ ok: true; brand: Brand } | { ok: false; error: string }>;
  /** Brand detail needs a signed-in scout: false = the chooser gets no onPackageAdded. */
  detail?: boolean;
  stores?: string[];
  onAnnounce?: (text: string) => void;
}) {
  const [picks, setPicks] = useState<BrandPick[]>(initial);
  const [catalog, setCatalog] = useState(CATALOG);
  const plan: Plan = {
    meal: 'breakfast', headcount: 20, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, recipeIds: ['cereal'], packageChoice: {}, qtyOverride: {}, lineSource: {},
    budgetPerPerson: 4, date: '2026-10-10', patrol: '', brands: { cereal: picks }
  };
  const line = buildLines(plan, catalog)[0];
  return (
    <StoreNamesScope names={stores}>
      <output data-testid="picks">{JSON.stringify(picks)}</output>
      <BrandChooser
        ingredient={CEREAL}
        catalog={catalog}
        picks={picks}
        line={line}
        onChange={setPicks}
        onAnnounce={onAnnounce}
        onPackageAdded={detail ? (a: AddedPackage) => setCatalog((c) => settleNewBrands({ ...c, packages: [...c.packages, a.pkg] })) : undefined}
        onType={
          onType &&
          (async (name) => {
            const res = await onType(name);
            if (res.ok) setCatalog((c) => ({ ...c, brands: [...(c.brands ?? []), res.brand] }));
            return res;
          })
        }
      />
    </StoreNamesScope>
  );
}
const picks = () => JSON.parse(screen.getByTestId('picks').textContent ?? '[]') as BrandPick[];
const chips = () => within(screen.getByRole('group', { name: 'Brand for Cold cereal' }));
const chip = (name: RegExp) => chips().getByRole('button', { name });

describe('BrandChooser', () => {
  it('ListsAnyBrandFirst_ThenPricedBrandsCheapestFirst_ThenNewOnes', () => {
    render(<Harness />);
    expect(chips().getAllByRole('button').map((b) => b.textContent)).toEqual(['Any brand', 'Rice Chex $6.50', 'Cheerios $6.77', 'Froot Loops New']);
  });

  it('StartsOnAnyBrand', () => {
    render(<Harness />);
    expect(chip(/^Any brand/).getAttribute('aria-pressed')).toBe('true');
  });

  it('ChoosingABrand_TakesAnyBrandOff', async () => {
    render(<Harness />);
    await userEvent.setup().click(chip(/^Rice Chex/));
    expect([picks(), chip(/^Any brand/).getAttribute('aria-pressed')]).toEqual([[{ brandId: 'b-chex', qty: null }], 'false']);
  });

  it('SeveralBrands_CanBeChosenTogether', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip(/^Rice Chex/));
    await user.click(chip(/^Cheerios/));
    expect(picks().map((p) => p.brandId)).toEqual(['b-chex', 'b-cheerios']);
  });

  it('AnyBrand_ClearsTheRest', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }]} />);
    await user.click(chip(/^Any brand/));
    expect(picks()).toEqual([]);
  });

  it('PressingAChosenBrandAgain_TakesItOff', async () => {
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }]} />);
    await userEvent.setup().click(chip(/^Rice Chex/));
    expect(picks()).toEqual([]);
  });

  it('TwoBrands_EachGetAPackageCount_AndTheNeedIsSaid', () => {
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }]} />);
    const list = within(screen.getByRole('list', { name: 'How many of each brand of Cold cereal' }));
    expect((list.getByRole('spinbutton', { name: 'Packages of Rice Chex' }) as HTMLInputElement).value).toBe('1');
    expect(screen.getByText('Need 20 cups · buying 36 cups')).toBeTruthy();
  });

  const setBox = async (user: ReturnType<typeof userEvent.setup>, name: string, text: string) => {
    const box = screen.getByRole('spinbutton', { name });
    await user.clear(box);
    await user.type(box, text);
    await user.tab();
  };

  it('BrandQty_IsANumberBox_WithLabelAndNoun', () => {
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }]} />);
    const row = within(screen.getByRole('list', { name: 'How many of each brand of Cold cereal' })).getAllByRole('listitem').find((li) => li.textContent?.includes('Rice Chex'))!;
    expect(within(row).getByText('Rice Chex')).toBeTruthy();
    expect(within(row).getByRole('spinbutton', { name: 'Packages of Rice Chex' })).toBeTruthy();
    expect(within(row).getByText('18 oz')).toBeTruthy();
    // The size text is the one control in the row (it opens the size and price entry), never a second count control.
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Change size or price for Rice Chex']);
  });

  it('BrandQty_TypingCommitsOnBlur', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }]} />);
    const box = screen.getByRole('spinbutton', { name: 'Packages of Rice Chex' });
    await user.clear(box);
    await user.type(box, '120');
    await user.tab();
    expect(picks()[0]).toEqual({ brandId: 'b-chex', qty: 99 });
    expect((screen.getByRole('spinbutton', { name: 'Packages of Rice Chex' }) as HTMLInputElement).value).toBe('99');
  });

  it('ChangingACount_IsKept_AndGoingBackToTheSplitClearsIt', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }]} />);
    await setBox(user, 'Packages of Rice Chex', '2');
    expect(picks()[0]).toEqual({ brandId: 'b-chex', qty: 2 });
    await setBox(user, 'Packages of Rice Chex', '1');
    expect(picks()[0]).toEqual({ brandId: 'b-chex', qty: null });
  });

  it('BuyingTooLittle_IsSaid_NeverBlocked', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'b-chex', qty: 0 }, { brandId: 'b-cheerios', qty: null }]} />);
    expect(screen.getByText(/2 cups short/)).toBeTruthy();
    await setBox(user, 'Packages of Rice Chex', '1');
    expect(screen.queryByText(/short/)).toBeNull();
  });

  it('ANewBrand_SaysItHasNoPriceYet', async () => {
    render(<Harness />);
    await userEvent.setup().click(chip(/^Froot Loops/));
    expect(screen.getByText('No price yet — about $6.50, cheapest known.')).toBeTruthy();
  });

  it('ATypedBrand_IsAdded_AndChosen', async () => {
    const onType = vi.fn(async (name: string) => ({ ok: true as const, brand: brand('xb-typed', name, { isNew: true }) }));
    render(<Harness onType={onType} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Type a brand of Cold cereal' }), 'Lucky Charms{Enter}');
    await waitFor(() => expect(onType).toHaveBeenCalledWith('Lucky Charms'));
    await waitFor(() => expect(picks()).toEqual([{ brandId: 'xb-typed', qty: null }]));
    expect(chip(/^Lucky Charms/).textContent).toBe('Lucky Charms New');
  });

  it('TypingAKnownBrand_IgnoringCaseAndPunctuation_ChoosesIt_WithoutAddingOne', async () => {
    const onType = vi.fn();
    render(<Harness onType={onType} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Type a brand of Cold cereal' }), 'rice chex!{Enter}');
    expect([onType.mock.calls.length, picks()]).toEqual([0, [{ brandId: 'b-chex', qty: null }]]);
  });

  it('ARefusedBrand_SaysWhy', async () => {
    render(<Harness onType={async () => ({ ok: false, error: 'That brand name can’t be saved. Try a shorter, plainer name.' })} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Type a brand of Cold cereal' }), 'x{Enter}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/can’t be saved/);
  });

  it('NoTypingField_WhenBrandsCannotBeAddedHere', () => {
    render(<Harness />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('brand text', () => {
  it('Summary_ReadsAnyBrand_OneBrand_OrSeveral', () => {
    const many = ['b-chex', 'b-cheerios', 'xb-new'].map((brandId) => ({ brandId, qty: null }));
    expect([
      brandSummary([], 'cereal', CATALOG),
      brandSummary([{ brandId: 'b-chex', qty: null }], 'cereal', CATALOG),
      brandSummary(many, 'cereal', CATALOG),
      brandSummary([...many, { brandId: 'b-four', qty: null }], 'cereal', { ...CATALOG, brands: [...(CATALOG.brands ?? []), brand('b-four', 'Kix')] })
    ]).toEqual(['any brand', 'Rice Chex', 'Rice Chex, Cheerios, Froot Loops', 'Rice Chex, Cheerios +2']);
  });

  it('Summary_IsNothing_ForAnIngredientWithNoBrands', () => {
    expect(brandSummary([], 'bananas', CATALOG)).toBeNull();
  });

  it('BrandsFor_LeavesOutRetiredBrands', () => {
    const c = { ...CATALOG, brands: [...(CATALOG.brands ?? []), brand('b-old', 'Old Flakes', { retiredAt: '2026-01-01T00:00:00Z' })] };
    expect(brandsFor('cereal', c).map((x) => x.brand.name)).not.toContain('Old Flakes');
  });
});

describe('Brand detail dialog (Plans/Menu-Monster-Brand-Detail.md)', () => {
  const TWO_NEW: BrandPick[] = [{ brandId: 'b-chex', qty: null }, { brandId: 'xb-new', qty: null }];
  const rowOf = (name: string) => within(screen.getByRole('list', { name: 'How many of each brand of Cold cereal' })).getAllByRole('listitem').find((li) => li.textContent?.includes(name))!;
  const dialog = () => screen.getByRole('dialog', { name: 'Froot Loops — Cold cereal' });
  const openFromNoun = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(rowOf('Froot Loops')).getByRole('button', { name: 'Add size and price for Froot Loops' }));
    return within(dialog());
  };
  const typedBrand = () => async (name: string) => ({ ok: true as const, brand: brand('xb-typed', name, { isNew: true }) });

  it('Scout_SeesSizeControl_NotIngredientName_OnANewBrandsQuantityRow', () => {
    render(<Harness initial={TWO_NEW} />);
    const row = rowOf('Froot Loops');
    expect(within(row).getByRole('button', { name: 'Add size and price for Froot Loops' }).textContent).toBe('size?');
    expect(row.textContent).not.toContain('Cold cereal');
  });

  it('Scout_SeesNoIngredientName_AndNoControl_WhenBrandsCannotBeSized', () => {
    render(<Harness initial={TWO_NEW} detail={false} />);
    expect(rowOf('Froot Loops').textContent).not.toContain('Cold cereal');
    expect(within(rowOf('Froot Loops')).queryByRole('button')).toBeNull();
  });

  it('Scout_TapsBrandChip_StillPicksInOneTap_AndOpensNothing', async () => {
    render(<Harness />);
    await userEvent.setup().click(chip(/^Froot Loops/));
    expect([picks(), screen.queryByRole('dialog')]).toEqual([[{ brandId: 'xb-new', qty: null }], null]);
  });

  it('Scout_OpensDetailEntry_FromTheSizeControl_FocusInFirstField', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    const d = await openFromNoun(user);
    expect(document.activeElement).toBe(d.getByRole('textbox', { name: 'Size' }));
  });

  it('Scout_OpensDetailEntry_FromTheSizeText_OfABrandThatHasAPackage', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    await user.click(within(rowOf('Rice Chex')).getByRole('button', { name: 'Change size or price for Rice Chex' }));
    expect(screen.getByRole('dialog', { name: 'Rice Chex — Cold cereal' })).toBeTruthy();
  });

  it('Scout_TypesANewBrand_TheDialogOpensForIt', async () => {
    render(<Harness onType={typedBrand()} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Type a brand of Cold cereal' }), 'Lucky Charms{Enter}');
    const d = await screen.findByRole('dialog', { name: 'Lucky Charms — Cold cereal' });
    expect(picks()).toEqual([{ brandId: 'xb-typed', qty: null }]);
    expect(within(d).getByRole('textbox', { name: 'Size' })).toBeTruthy();
  });

  it('Dialog_IsNotOpened_ByATypedBrand_WhenNothingCanBeSaved', async () => {
    render(<Harness onType={typedBrand()} detail={false} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Type a brand of Cold cereal' }), 'Lucky Charms{Enter}');
    await waitFor(() => expect(picks()).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Save_IsGreyed_UntilSomethingIsTyped', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    const d = await openFromNoun(user);
    expect((d.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(d.getByRole('textbox', { name: 'Price' }), '4');
    expect((d.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Save_WithAPriceButNoSize_MarksSizeRedInPlace_AndSavesNothing', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    const d = await openFromNoun(user);
    await user.type(d.getByRole('textbox', { name: 'Price' }), '4.29');
    await user.click(d.getByRole('button', { name: 'Save' }));
    expect(d.getByRole('textbox', { name: 'Size' }).getAttribute('aria-invalid')).toBe('true');
    expect(d.getByText('Enter how much one package holds — check the label.')).toBeTruthy();
    expect([addScoutPackageAction.mock.calls.length, document.activeElement]).toEqual([0, d.getByRole('textbox', { name: 'Size' })]);
  });

  it('Scout_SavesSizeAndPrice_QuantityRowShowsTheSize_AndNewIsGone', async () => {
    addScoutPackageAction.mockResolvedValue({ ok: true, status: 'live', id: 'sp-1' });
    const onAnnounce = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} onAnnounce={onAnnounce} stores={['Aldi']} />);
    const d = await openFromNoun(user);
    await user.type(d.getByRole('textbox', { name: 'Size' }), '12');
    await user.selectOptions(d.getByRole('combobox', { name: 'Unit' }), 'oz');
    await user.type(d.getByRole('textbox', { name: 'Price' }), '4.29');
    await user.selectOptions(d.getByRole('combobox', { name: 'Store (optional)' }), 'Aldi');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(addScoutPackageAction).toHaveBeenCalledWith({ ingredientId: 'cereal', name: 'Froot Loops', store: 'Aldi', size: 12, sizeUnit: 'oz', price: 4.29, brandId: 'xb-new' });
    expect(within(rowOf('Froot Loops')).getByRole('button', { name: 'Change size or price for Froot Loops' }).textContent).toBe('12 fl oz');
    expect(chip(/^Froot Loops/).textContent).toBe('Froot Loops $4.29');
    expect(onAnnounce).toHaveBeenCalledWith('Froot Loops saved: 12 fl oz at $4.29.');
  });

  it('Scout_Cancels_FocusReturnsToTheSizeControl', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    const d = await openFromNoun(user);
    await user.click(d.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(rowOf('Froot Loops')).getByRole('button', { name: 'Add size and price for Froot Loops' })));
    expect(addScoutPackageAction).not.toHaveBeenCalled();
  });

  it('Scout_Cancels_FocusReturnsToTheChip_OfATypedBrand', async () => {
    render(<Harness onType={typedBrand()} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Type a brand of Cold cereal' }), 'Lucky Charms{Enter}');
    const d = within(await screen.findByRole('dialog', { name: 'Lucky Charms — Cold cereal' }));
    await user.click(d.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(chip(/^Lucky Charms/)));
  });

  it('Scout_PressesEscape_TheDialogClosesAndSavesNothing', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    await openFromNoun(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(addScoutPackageAction).not.toHaveBeenCalled();
  });

  it('Scout_PressesEscape_TheDialogAsksToCloseOnce', async () => {
    const onClose = vi.fn();
    render(<BrandDetailDialog ingredient={CEREAL} brand={brand('xb-new', 'Froot Loops')} conversions={[]} stores={[]} onAdded={vi.fn()} onClose={onClose} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Store_IsAPullDownOfApprovedStores_NoFreeText', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} stores={['Pick n Save', 'Aldi']} />);
    const d = await openFromNoun(user);
    const store = d.getByRole('combobox', { name: 'Store (optional)' });
    expect(within(store).getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Pick n Save', 'Aldi']);
    expect(d.queryByRole('textbox', { name: /Store/ })).toBeNull();
  });

  it('Store_FieldHidden_WhenNoStores', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} stores={[]} />);
    const d = await openFromNoun(user);
    expect(d.queryByLabelText(/Store/)).toBeNull();
  });

  it('SingleNewBrand_HasASizeControl_ThatReopensTheDialog', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'xb-new', qty: null }]} />);
    await user.click(screen.getByRole('button', { name: 'Add size and price for Froot Loops' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add size and price for Froot Loops' })));
    await user.click(screen.getByRole('button', { name: 'Add size and price for Froot Loops' }));
    expect(dialog()).toBeTruthy();
  });

  it('SingleBrandWithAPackage_ShowsItsSizeAsTheControl', async () => {
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }]} />);
    const b = screen.getByRole('button', { name: 'Change size or price for Rice Chex' });
    expect(b.textContent).toBe('18 oz');
    await userEvent.setup().click(b);
    expect(screen.getByRole('dialog', { name: 'Rice Chex — Cold cereal' })).toBeTruthy();
  });

  it('Dialog_HasNoNameField_TheBrandIsTheName', async () => {
    const user = userEvent.setup();
    render(<Harness initial={TWO_NEW} />);
    const d = await openFromNoun(user);
    expect(d.queryByRole('textbox', { name: /Name on the label/ })).toBeNull();
    expect(d.getByText('A best guess is fine.')).toBeTruthy();
  });
});
