import { describe, it, expect } from 'vitest';
import { buildLines, livePicks, recipeSuggestions } from '../src/lib/menu-monster/engine';
import { sanitizeMenu } from '../src/lib/menu-monster/menus';
import { buildMenuList } from '../src/lib/menu-monster/menu-view';
import type { Brand, BrandPicks, Catalog, Package, Plan } from '../src/lib/menu-monster/types';

/**
 * Brands in the engine (Plans/Menu-Monster-Brands-Gear.md, release 3). A menu asks for an ingredient with any
 * brand, or names one or several: one brand buys the whole need in its own cheapest package; several split
 * it; a brand nobody has priced yet is estimated from the cheapest known. A line with no brand chosen prices
 * exactly as it always did — it only says so ("about") when there were brands to choose from.
 */
const pkg = (id: string, brandId: string | null, price: number, y: number, over: Partial<Package> = {}): Package => ({
  id, ingredientId: 'cereal', name: id, store: null, price, anchorPrice: price, yield: y, yieldUnitLabel: null, noun: 'box',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-10-01', brandId, sizeLabel: '18 oz', ...over
});
const brand = (id: string, name: string, over: Partial<Brand> = {}): Brand => ({ id, ingredientId: 'cereal', name, avoid: null, ...over });

const CATALOG: Catalog = {
  ingredients: [
    { id: 'cereal', name: 'Cold cereal', unit: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' }, section: 'dry', staple: false, avoid: ['gf'] },
    { id: 'bananas', name: 'Bananas', unit: { key: 'count', one: 'banana', many: 'bananas', kind: 'count' }, section: 'produce', staple: false, avoid: [] }
  ],
  packages: [
    pkg('p-cheerios', 'b-cheerios', 6.77, 18),
    pkg('p-cheerios-big', 'b-cheerios', 9.0, 40),
    pkg('p-chex', 'b-chex', 6.5, 18),
    pkg('p-store', null, 3.0, 18),
    { ...pkg('p-ban', null, 0.25, 1), ingredientId: 'bananas', noun: 'each' }
  ],
  conversions: [],
  recipes: [
    {
      id: 'cereal', name: 'Cold cereal', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
      lines: [{ ingredientId: 'cereal', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
    },
    {
      id: 'bananas', name: 'Bananas', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 1,
      lines: [{ ingredientId: 'bananas', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
    }
  ],
  brands: [brand('b-cheerios', 'Cheerios'), brand('b-chex', 'Rice Chex', { avoid: [] }), brand('xb-new', 'Froot Loops', { isNew: true }), brand('b-old', 'Old Flakes', { retiredAt: '2026-01-01T00:00:00Z' })],
  brandAliases: { 'b-cheerios-typo': 'b-cheerios' }
};
const plan = (brands?: BrandPicks, over: Partial<Plan> = {}): Plan => ({
  meal: 'breakfast', headcount: 20, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, recipeIds: ['cereal', 'bananas'], packageChoice: {}, qtyOverride: {}, lineSource: {},
  budgetPerPerson: 4, date: '2026-10-10', patrol: '', ...(brands ? { brands } : {}), ...over
});
const cereal = (p: Plan) => buildLines(p, CATALOG).find((l) => l.ing.id === 'cereal')!;

describe('any brand', () => {
  it('NoBrandChosen_PricesAsBefore_AtTheCheapestKnown', () => {
    const l = cereal(plan());
    expect([l.pkg?.id, l.qty, l.spent, l.parts]).toEqual(['p-store', 2, 6, undefined]);
  });

  it('NoBrandChosen_IsAnEstimate_WhenThereAreBrandsToChooseFrom', () => {
    expect(cereal(plan()).estimated).toBe(true);
  });

  it('AnIngredientWithNoBrands_IsNeverAnEstimate', () => {
    expect(buildLines(plan(), CATALOG).find((l) => l.ing.id === 'bananas')?.estimated).toBeUndefined();
  });
});

describe('one brand', () => {
  it('BuysTheWholeNeed_InThatBrandsCheapestPackage', () => {
    const l = cereal(plan({ cereal: [{ brandId: 'b-cheerios', qty: null }] }));
    // 20 cups: one 40-cup box at $9.00 beats two 18-cup boxes at $13.54.
    expect([l.parts?.length, l.pkg?.id, l.qty, l.spent, l.estimated, l.status]).toEqual([1, 'p-cheerios-big', 1, 9, false, 'ok']);
  });

  it('ABrandNobodyHasPriced_IsEstimatedFromTheCheapestKnown', () => {
    const l = cereal(plan({ cereal: [{ brandId: 'xb-new', qty: null }] }));
    expect([l.parts?.[0].brand.name, l.parts?.[0].pkg.id, l.estimated, l.spent]).toEqual(['Froot Loops', 'p-store', true, 6]);
  });

  it('ACountTheMenuSet_IsWhatIsBought_AndCanFallShort', () => {
    const l = cereal(plan({ cereal: [{ brandId: 'b-chex', qty: 1 }] }));
    expect([l.qty, l.spent, l.status, l.shortQty, l.overridden]).toEqual([1, 6.5, 'short', 2, true]);
  });
});

describe('several brands', () => {
  const three: BrandPicks = { cereal: [{ brandId: 'b-chex', qty: null }, { brandId: 'b-cheerios', qty: null }, { brandId: 'xb-new', qty: null }] };

  it('EachBrandBuysItsShare_AndTheLineIsTheirSum', () => {
    const l = cereal(plan(three));
    expect(l.parts?.map((x) => [x.brand.name, x.qty])).toEqual([['Rice Chex', 1], ['Cheerios', 1], ['Froot Loops', 1]]);
    expect([l.qty, Math.round(l.spent * 100) / 100, l.status]).toEqual([3, 16.27, 'ok']);
  });

  it('BuyingExtra_IsNeverShort_AndTheLeftoverIsCounted', () => {
    const l = cereal(plan(three));
    // 54 cups bought for a 20-cup need.
    expect([l.leftQty, l.shortQty]).toEqual([34, 0]);
  });

  it('TheLineIsAnEstimate_WhileAnyBrandHasNoPrice', () => {
    expect([cereal(plan(three)).estimated, cereal(plan({ cereal: three.cereal.slice(0, 2) })).estimated]).toEqual([true, false]);
  });

  it('BringingItFromHome_IgnoresTheBrands', () => {
    const l = cereal(plan(three, { lineSource: { cereal: { source: 'home', note: '' } } }));
    expect([l.status, l.parts, l.spent]).toEqual(['bring', undefined, 0]);
  });
});

describe('a menu’s stored brands', () => {
  it('LivePicks_FollowAMerge_AndDropWhatIsGone', () => {
    const picks = livePicks(
      [{ brandId: 'b-cheerios-typo', qty: 2 }, { brandId: 'b-cheerios', qty: null }, { brandId: 'b-old', qty: null }, { brandId: 'nope', qty: null }],
      'cereal',
      CATALOG
    );
    expect(picks.map((x) => [x.brand.id, x.qty])).toEqual([['b-cheerios', 2]]);
  });

  it('LivePicks_RefuseAnotherIngredientsBrand', () => {
    expect(livePicks([{ brandId: 'b-cheerios', qty: null }], 'bananas', CATALOG)).toEqual([]);
  });

  const raw = (brands: unknown) => ({
    name: 'Fall Campout', headcount: 20, restrictions: {}, meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['cereal'], recipeEdits: {} }],
    shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands }
  });

  it('SanitizeMenu_KeepsOnlyBrandsTheCatalogCanHonour', () => {
    const m = sanitizeMenu(raw({ cereal: [{ brandId: 'b-chex', qty: 2 }, { brandId: 'b-old' }, { brandId: 'b-chex' }, 'junk'], bananas: [{ brandId: 'b-cheerios' }], ghost: [{ brandId: 'b-chex' }] }), CATALOG);
    expect(m.shopping.brands).toEqual({ cereal: [{ brandId: 'b-chex', qty: 2 }] });
  });

  it('SanitizeMenu_StoresNoBrandsKey_WhenNoneAreChosen', () => {
    expect('brands' in sanitizeMenu(raw({}), CATALOG).shopping).toBe(false);
    expect('brands' in sanitizeMenu(raw(undefined), CATALOG).shopping).toBe(false);
  });

  it('TheMenusList_PricesWithItsBrands', () => {
    const m = sanitizeMenu(raw({ cereal: [{ brandId: 'b-chex', qty: null }] }), CATALOG);
    const line = buildMenuList(m, CATALOG).lines.find((l) => l.ing.id === 'cereal');
    expect([line?.parts?.[0].brand.name, line?.qty, line?.spent]).toEqual(['Rice Chex', 2, 13]);
  });
});

describe('a recipe’s suggested brands (release 6)', () => {
  const live = CATALOG.brands![0];
  const line = (ingredientId: string) => ({ ingredientId, qtyPerPerson: 1, unitKey: null, servesRule: 'everyone' as const, servesRestrictions: [] });

  it('ALiveBrandOfAnIngredientTheRecipeUses_IsASuggestion', () => {
    expect(recipeSuggestions({ lines: [line('cereal')], brandSuggestions: { cereal: live.id } }, CATALOG).map(([id, b]) => [id, b.id])).toEqual([['cereal', live.id]]);
  });

  it('AnIngredientTheRecipeNoLongerUses_IsNot', () => {
    expect(recipeSuggestions({ lines: [line('milk')], brandSuggestions: { cereal: live.id } }, CATALOG)).toEqual([]);
  });

  it('ABrandThatIsGone_IsNot', () => {
    expect(recipeSuggestions({ lines: [line('cereal')], brandSuggestions: { cereal: 'b-nope' } }, CATALOG)).toEqual([]);
  });

  it('NoSuggestions_GiveNone', () => {
    expect(recipeSuggestions({ lines: [line('cereal')] }, CATALOG)).toEqual([]);
  });

  it('AnIngredientOnTwoLines_IsSuggestedOnce', () => {
    expect(recipeSuggestions({ lines: [line('cereal'), line('cereal')], brandSuggestions: { cereal: live.id } }, CATALOG)).toHaveLength(1);
  });
});
