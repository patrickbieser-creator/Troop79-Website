import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { BrandChooser, brandSummary, brandsFor } from '../src/app/(public)/library/menu-monster/menus/_components/brand-chooser';
import { buildLines } from '../src/lib/menu-monster/engine';
import type { Brand, BrandPick, Catalog, Package, Plan } from '../src/lib/menu-monster/types';

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

function Harness({ initial = [], onType }: { initial?: BrandPick[]; onType?: (name: string) => Promise<{ ok: true; brand: Brand } | { ok: false; error: string }> }) {
  const [picks, setPicks] = useState<BrandPick[]>(initial);
  const [catalog, setCatalog] = useState(CATALOG);
  const plan: Plan = {
    meal: 'breakfast', headcount: 20, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, recipeIds: ['cereal'], packageChoice: {}, qtyOverride: {}, lineSource: {},
    budgetPerPerson: 4, date: '2026-10-10', patrol: '', brands: { cereal: picks }
  };
  const line = buildLines(plan, catalog)[0];
  return (
    <>
      <output data-testid="picks">{JSON.stringify(picks)}</output>
      <BrandChooser
        ingredient={CEREAL}
        catalog={catalog}
        picks={picks}
        line={line}
        onChange={setPicks}
        onType={
          onType &&
          (async (name) => {
            const res = await onType(name);
            if (res.ok) setCatalog((c) => ({ ...c, brands: [...(c.brands ?? []), res.brand] }));
            return res;
          })
        }
      />
    </>
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

  it('ChangingACount_IsKept_AndGoingBackToTheSplitClearsIt', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }]} />);
    await user.click(screen.getByRole('button', { name: 'One more Rice Chex' }));
    expect(picks()[0]).toEqual({ brandId: 'b-chex', qty: 2 });
    await user.click(screen.getByRole('button', { name: 'One fewer Rice Chex' }));
    expect(picks()[0]).toEqual({ brandId: 'b-chex', qty: null });
  });

  it('BuyingTooLittle_IsSaid_NeverBlocked', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ brandId: 'b-chex', qty: 0 }, { brandId: 'b-cheerios', qty: null }]} />);
    expect(screen.getByText(/2 cups short/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'One more Rice Chex' }));
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
