import { describe, it, expect } from 'vitest';
import { boughtFromActuals, boughtRows, boughtTotals, cleanLineInput, plannedItems, recorders, sanitizeBought, type Bought } from '../src/lib/menu-monster/bought';
import { buildLines } from '../src/lib/menu-monster/engine';
import type { Brand, BrandPicks, Catalog, Package, Plan } from '../src/lib/menu-monster/types';

/**
 * "What we bought" (Plans/Menu-Monster-Brands-Gear.md, release 4), the pure half: the checklist is prefilled
 * from the plan, an untouched line is "not confirmed" until the done tick, and totals lean on the plan only
 * for lines nobody has recorded.
 */
const pkg = (id: string, ingredientId: string, brandId: string | null, price: number, y: number): Package => ({
  id, ingredientId, name: id, store: null, price, anchorPrice: price, yield: y, yieldUnitLabel: null, noun: 'box',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-10-01', brandId, sizeLabel: null
});
const brand = (id: string, ingredientId: string, name: string, over: Partial<Brand> = {}): Brand => ({ id, ingredientId, name, avoid: null, ...over });
const unit = { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' as const };
const CATALOG: Catalog = {
  ingredients: [
    { id: 'cereal', name: 'Cold cereal', unit, section: 'dry', staple: false, avoid: [] },
    { id: 'milk', name: 'Milk', unit, section: 'dairy', staple: false, avoid: [] },
    { id: 'foil', name: 'Heavy foil', unit, section: 'dry', staple: true, avoid: [] }
  ],
  packages: [pkg('p-cheerios', 'cereal', 'b-cheerios', 6.77, 18), pkg('p-chex', 'cereal', 'b-chex', 6.5, 18), pkg('p-milk', 'milk', null, 5, 16), pkg('p-foil', 'foil', null, 6.49, 30)],
  conversions: [],
  recipes: [
    {
      id: 'cereal', name: 'Cold cereal', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
      lines: [
        { ingredientId: 'cereal', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: 'milk', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: 'foil', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
      ]
    }
  ],
  brands: [brand('b-cheerios', 'cereal', 'Cheerios'), brand('b-chex', 'cereal', 'Rice Chex'), brand('xb-new', 'cereal', 'Froot Loops', { isNew: true })]
};
const lines = (brands?: BrandPicks) => {
  const plan: Plan = {
    meal: 'breakfast', headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, recipeIds: ['cereal'], packageChoice: {}, qtyOverride: {}, lineSource: {},
    budgetPerPerson: 4, date: '2026-10-10', patrol: '', ...(brands ? { brands } : {})
  };
  return buildLines(plan, CATALOG);
};
const stamp = (by: string, at = '2026-10-12T15:00:00Z') => ({ by, personId: 5, at });
const none: Bought = { lines: {}, done: null };

describe('the plan as a prefilled checklist', () => {
  it('AnAnyBrandLine_IsPlannedWithNoPackageNamed_AtTheCheapestKnownPrice', () => {
    expect(plannedItems(lines().find((l) => l.ing.id === 'cereal')!)).toEqual([{ brandId: null, packageId: null, qty: 1, pricePaid: 6.5 }]);
  });

  it('AnIngredientWithNoBrands_IsPlannedAsItsPackage', () => {
    expect(plannedItems(lines().find((l) => l.ing.id === 'milk')!)).toEqual([{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5 }]);
  });

  it('SeveralBrands_ArePlannedOneItemEach_AndANewBrandHasNoPackage', () => {
    const l = lines({ cereal: [{ brandId: 'b-chex', qty: null }, { brandId: 'xb-new', qty: 2 }] }).find((x) => x.ing.id === 'cereal')!;
    expect(plannedItems(l)).toEqual([
      { brandId: 'b-chex', packageId: 'p-chex', qty: 1, pricePaid: 6.5 },
      { brandId: 'xb-new', packageId: null, qty: 2, pricePaid: 6.5 }
    ]);
  });

  it('StoreRoomLines_AreNotOnTheChecklist', () => {
    expect(boughtRows(lines(), none).map((r) => r.line.ing.id)).toEqual(['milk', 'cereal']);
  });
});

describe('rows', () => {
  it('AnUntouchedLine_IsUnconfirmed_UntilTheDoneTick', () => {
    expect(boughtRows(lines(), none).map((r) => r.state)).toEqual(['unconfirmed', 'unconfirmed']);
    expect(boughtRows(lines(), { lines: {}, done: stamp('Maya O.') }).map((r) => r.state)).toEqual(['as_planned', 'as_planned']);
  });

  it('ARecordedLine_AtThePlan_IsAsPlanned_WithItsRecorder', () => {
    const b: Bought = { lines: { milk: { status: 'bought', items: [{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5 }], ...stamp('Maya O.') } }, done: null };
    const row = boughtRows(lines(), b).find((r) => r.line.ing.id === 'milk')!;
    expect([row.state, row.stamp?.by, row.total]).toEqual(['as_planned', 'Maya O.', 5]);
  });

  it('ADifferentPrice_IsChanged', () => {
    const b: Bought = { lines: { milk: { status: 'bought', items: [{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5.49 }], ...stamp('Maya O.') } }, done: null };
    const row = boughtRows(lines(), b).find((r) => r.line.ing.id === 'milk')!;
    expect([row.state, row.total]).toEqual(['changed', 5.49]);
  });

  it('NotBought_CostsNothing', () => {
    const b: Bought = { lines: { milk: { status: 'not_bought', items: [], ...stamp('Maya O.') } }, done: null };
    const row = boughtRows(lines(), b).find((r) => r.line.ing.id === 'milk')!;
    expect([row.state, row.total, row.items]).toEqual(['not_bought', 0, []]);
  });
});

describe('totals', () => {
  it('ArePROJECTED_WhileLinesAreUnconfirmed', () => {
    const t = boughtTotals(boughtRows(lines(), none), false);
    expect([t.planned, t.paid, t.unconfirmed, t.projected]).toEqual([11.5, 11.5, 2, true]);
  });

  it('StopBeingProjected_AtTheDoneTick', () => {
    const b: Bought = { lines: {}, done: stamp('Maya O.') };
    const t = boughtTotals(boughtRows(lines(), b), true);
    expect([t.bought, t.unconfirmed, t.projected]).toEqual([2, 0, false]);
  });

  it('CountWhatWasPaid_AndWhatWasNotBought', () => {
    const b: Bought = {
      lines: {
        milk: { status: 'not_bought', items: [], ...stamp('Maya O.') },
        cereal: { status: 'bought', items: [{ brandId: 'b-cheerios', packageId: 'p-cheerios', qty: 2, pricePaid: 7 }], ...stamp('Sam K.') }
      },
      done: null
    };
    const t = boughtTotals(boughtRows(lines(), b), false);
    expect([t.planned, t.paid, t.bought, t.notBought, t.projected]).toEqual([11.5, 14, 1, 1, false]);
  });
});

describe('who recorded it', () => {
  it('ListsEveryRecorderOnce_InOrder_WithTheLatestTime', () => {
    const b: Bought = {
      lines: {
        milk: { status: 'not_bought', items: [], ...stamp('Maya O.', '2026-10-12T15:00:00Z') },
        cereal: { status: 'not_bought', items: [], ...stamp('Sam K.', '2026-10-13T09:00:00Z') }
      },
      done: stamp('Maya O.', '2026-10-14T09:00:00Z')
    };
    expect(recorders(b)).toEqual({ names: ['Maya O.', 'Sam K.'], latest: '2026-10-14T09:00:00Z' });
  });
});

describe('what may be stored', () => {
  it('SanitizeBought_KeepsWellFormedLines_AndDropsTheRest', () => {
    const b = sanitizeBought({
      lines: {
        milk: { status: 'bought', items: [{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5.499 }, { qty: -1, pricePaid: 2 }], by: 'Maya O.', personId: 5, at: '2026-10-12T15:00:00Z' },
        cereal: { status: 'not_bought', by: 'Sam K.', at: '2026-10-12T15:00:00Z' },
        bad: { status: 'bought', items: [], by: 'x', at: '2026-10-12T15:00:00Z' },
        'no stamp': { status: 'not_bought' }
      },
      done: { by: 'Maya O.', personId: 5, at: '2026-10-14T09:00:00Z' }
    });
    expect(Object.keys(b.lines)).toEqual(['milk', 'cereal']);
    expect(b.lines.milk.items).toEqual([{ brandId: null, packageId: 'p-milk', qty: 1, pricePaid: 5.5 }]);
    expect(b.done?.by).toBe('Maya O.');
  });

  it('CleanLineInput_RefusesAPackageOfAnotherIngredient', () => {
    expect(cleanLineInput('milk', { status: 'bought', items: [{ packageId: 'p-chex', qty: 1, pricePaid: 5 }] }, CATALOG)).toBeNull();
  });

  it('CleanLineInput_TakesTheBrandFromThePackage_NotFromTheClient', () => {
    const res = cleanLineInput('cereal', { status: 'bought', items: [{ packageId: 'p-chex', brandId: 'b-cheerios', qty: 2, pricePaid: 6 }] }, CATALOG);
    expect(res).toEqual({ status: 'bought', items: [{ brandId: 'b-chex', packageId: 'p-chex', qty: 2, pricePaid: 6 }] });
  });

  it('CleanLineInput_RefusesABrandOfAnotherIngredient_AndAnEmptyBoughtLine', () => {
    expect(cleanLineInput('milk', { status: 'bought', items: [{ brandId: 'b-chex', packageId: null, qty: 1, pricePaid: 5 }] }, CATALOG)).toBeNull();
    expect(cleanLineInput('milk', { status: 'bought', items: [] }, CATALOG)).toBeNull();
    expect(cleanLineInput('ghost', { status: 'not_bought' }, CATALOG)).toBeNull();
  });

  it('OldWhatYouPaidEntries_ReadAsBoughtLines', () => {
    const lines2 = boughtFromActuals({ cereal: { packageId: 'p-chex', qty: 2, pricePaid: 6.25 } }, CATALOG, '2026-10-01T00:00:00Z');
    expect(lines2.cereal).toMatchObject({ status: 'bought', items: [{ brandId: 'b-chex', packageId: 'p-chex', qty: 2, pricePaid: 6.25 }] });
  });
});
