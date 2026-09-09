import { describe, it, expect } from 'vitest';
import type { Catalog, Conversion, Ingredient, Package, Plan, Recipe, RecipeLine } from '../src/lib/menu-monster/types';
import { UNITS, conv, fracText, perPersonText, qtyText, supportedUnits } from '../src/lib/menu-monster/units';
import {
  buildLines,
  effectiveRestrictions,
  lineSentence,
  mathText,
  recommendedPackage,
  restorePlan,
  restrictionWarnings,
  seedPlan,
  servingsFor,
  sourcesText,
  totalsOf,
  withMeal
} from '../src/lib/menu-monster/engine';

/**
 * Menu Monster engine (Plans/Menu-Monster.md — Test Plan). Pure TS, no DB:
 * the fixture is a slice of data/menu-monster-seed.json with the prices the
 * discovery decisions were checked against (Oscar Mayer vs Kirkland bacon,
 * 10 lb pancake mix = 36 cups, oranges at ¼ each).
 */

const count = (one: string, many: string) => ({ key: 'count', one, many, kind: 'count' as const });

const ING: Record<string, Ingredient> = {
  'pancake-mix': { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'] },
  'almond-flour': { id: 'almond-flour', name: 'Almond flour', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['nut'] },
  bacon: { id: 'bacon', name: 'Bacon', unit: UNITS.slice, section: 'meat', staple: false, avoid: ['veg'] },
  eggs: { id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [] },
  oranges: { id: 'oranges', name: 'Oranges', unit: count('orange', 'oranges'), section: 'produce', staple: false, avoid: [] },
  cinnamon: { id: 'cinnamon', name: 'Cinnamon', unit: UNITS.gram, section: 'dry', staple: false, avoid: [] },
  bread: { id: 'bread', name: 'Bread', unit: UNITS.slice, section: 'bakery', staple: false, avoid: ['gf'] },
  butter: { id: 'butter', name: 'Butter', unit: UNITS.tbsp, section: 'dairy', staple: false, avoid: ['dairy'] },
  oj: { id: 'oj', name: 'Orange juice', unit: UNITS.cup, section: 'dairy', staple: false, avoid: [] },
  salt: { id: 'salt', name: 'Salt', unit: UNITS.tsp, section: 'dry', staple: true, avoid: [] }
};

const pkg = (id: string, ingredientId: string, name: string, price: number, yield_: number | null, noun = 'pack'): Package => ({
  id,
  ingredientId,
  name,
  store: 'Kroger',
  price,
  yield: yield_,
  yieldUnitLabel: yield_ == null ? 'gallon' : null,
  noun,
  soldSize: null,
  soldUnit: null,
  note: null,
  asOf: '2026-08-22'
});

const PACKAGES: Package[] = [
  pkg('p-mix-10lb', 'pancake-mix', 'Krusteaz Pancake Mix, 10 lb', 15, 36, 'bag'),
  pkg('p-mix-krus', 'pancake-mix', 'Krusteaz Original, 32 oz', 6.49, 7, 'box'),
  pkg('p-alm-brm', 'almond-flour', 'Bob’s Red Mill Almond Flour, 1 lb', 8, 3, 'bag'),
  pkg('p-bac-kirk', 'bacon', 'Kirkland Hickory Smoked Bacon, 4 x 1 lb', 18.15, 80),
  pkg('p-bac-om', 'bacon', 'Oscar Mayer Bacon, 16 oz', 7.49, 16),
  pkg('p-bac-smith', 'bacon', 'Smithfield Thick Cut, 24 oz', 11.19, 16),
  pkg('p-egg-store', 'eggs', 'Store Brand White Eggs, dozen', 2.99, 12, 'dozen'),
  pkg('p-ora', 'oranges', 'Orange, each', 0.4, 1, 'each'),
  pkg('p-cin-mc', 'cinnamon', 'McCormick Ground Cinnamon, 6 oz', 4.79, 67, 'bottle'),
  pkg('p-brd-kro', 'bread', 'Kroger White/Wheat', 1.99, 20, 'loaf'),
  pkg('p-but-stick', 'butter', 'Salted butter, 1 stick', 2, 8, 'stick'),
  pkg('p-salt', 'salt', 'Iodized Salt', 1.99, 300, 'box'),
  // Unusable: sold by the gallon, nobody has said how many cups that is.
  pkg('p-oj-gallon', 'oj', 'Orange juice, gallon', 8, null, 'gallon')
];

const CONVERSIONS: Conversion[] = [
  { ingredientId: 'pancake-mix', from: 'ozw', to: 'cup', factor: 1 / 4.5, label: 'pancake mix ≈ 4.5 oz per cup' },
  { ingredientId: 'bacon', from: 'lb', to: 'slice', factor: 16, label: 'regular-cut bacon ≈ 16 slices per lb' },
  { ingredientId: 'eggs', from: 'dozen', to: 'egg', factor: 12, label: '12 per dozen' },
  { ingredientId: 'cinnamon', from: 'tsp', to: 'gram', factor: 2.6, label: 'ground cinnamon ≈ 2.6 g per tsp' },
  { ingredientId: 'butter', from: 'each', to: 'tbsp', factor: 8, label: '1 stick = 8 Tbsp' }
];

const everyone = (ingredientId: string, qtyPerPerson: number, unitKey: string | null = null): RecipeLine => ({
  ingredientId, qtyPerPerson, unitKey, servesRule: 'everyone', servesRestrictions: []
});
const except = (ingredientId: string, qtyPerPerson: number, r: 'gf' | 'nut' | 'veg' | 'dairy'): RecipeLine => ({
  ingredientId, qtyPerPerson, unitKey: null, servesRule: 'except', servesRestrictions: [r]
});
const only = (ingredientId: string, qtyPerPerson: number, r: 'gf' | 'nut' | 'veg' | 'dairy'): RecipeLine => ({
  ingredientId, qtyPerPerson, unitKey: null, servesRule: 'only', servesRestrictions: [r]
});

const recipe = (id: string, name: string, lines: RecipeLine[], mealFit: Recipe['mealFit'] = ['breakfast']): Recipe => ({
  id, name, status: 'published', mealFit, foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0, lines
});

const RECIPES: Recipe[] = [
  recipe('B001', 'Pancakes', [
    except('pancake-mix', 0.5, 'gf'),
    only('almond-flour', 1, 'gf'),
    only('eggs', 1, 'gf'),
    everyone('butter', 0.5)
  ]),
  recipe('B003', 'Bacon', [everyone('bacon', 3)]),
  recipe('B014', 'Oatmeal', [everyone('cinnamon', 0.5, 'tsp')]),
  recipe('B016', 'Oranges', [everyone('oranges', 0.25)]),
  recipe('T001', 'Toast', [everyone('bread', 2), everyone('butter', 1)]),
  recipe('B023', 'Orange juice', [everyone('oj', 1)]),
  recipe('B009', 'Condiments', [everyone('salt', 0.25)])
];

const CATALOG: Catalog = { ingredients: Object.values(ING), packages: PACKAGES, conversions: CONVERSIONS, recipes: RECIPES };

function plan(over: Partial<Plan> = {}): Plan {
  return {
    meal: 'breakfast',
    headcount: 10,
    restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
    recipeIds: [],
    packageChoice: {},
    qtyOverride: {},
    lineSource: {},
    budgetPerPerson: 4,
    date: '2026-09-26',
    patrol: 'Test',
    ...over
  };
}

const lineFor = (lines: ReturnType<typeof buildLines>, id: string) => {
  const l = lines.find((x) => x.ing.id === id);
  if (!l) throw new Error(`no shopping line for ${id}`);
  return l;
};

describe('menu monster engine', () => {
  it('Engine_ConvertsSameFamilyUnits_WhenLineUnitDiffersFromRecipeUnit', () => {
    // 2 Tbsp on a cup ingredient = 0.125 cup — table conversion, no density row needed.
    const f = conv('tbsp', ING['pancake-mix'], []);
    expect(f).not.toBeNull();
    expect(2 * (f as number)).toBeCloseTo(0.125, 9);
    // Same key = 1; omitted = the recipe unit.
    expect(conv('cup', ING['pancake-mix'], [])).toBe(1);
    expect(conv(null, ING['pancake-mix'], [])).toBe(1);
  });

  it('Engine_BridgesCrossFamilyUnits_WhenConversionRowExists', () => {
    // 1 tsp cinnamon priced in grams = 2.6 g
    expect(conv('tsp', ING.cinnamon, CONVERSIONS)).toBeCloseTo(2.6, 9);
    // 1 lb bacon priced in slices = 16
    expect(conv('lb', ING.bacon, CONVERSIONS)).toBeCloseTo(16, 9);
    // A same-family step on either side of the bridge: 1 oz (weight) of bacon = 1 slice.
    expect(conv('ozw', ING.bacon, CONVERSIONS)).toBeCloseTo(1, 6);
    // Reverse direction: an ingredient priced in tsp, a line written in grams.
    const cinnamonInTsp: Ingredient = { ...ING.cinnamon, unit: UNITS.tsp };
    expect(conv('gram', cinnamonInTsp, CONVERSIONS)).toBeCloseTo(1 / 2.6, 9);
    const baconInLb: Ingredient = { ...ING.bacon, unit: UNITS.lb };
    expect(conv('slice', baconInLb, CONVERSIONS)).toBeCloseTo(1 / 16, 9);
    // supportedUnits lists the recipe unit first, then whatever bridges.
    expect(supportedUnits(ING.bacon, CONVERSIONS)).toEqual(['slice', 'gram', 'ozw', 'lb']);
  });

  it('Engine_RejectsUnit_WhenNoConversionPath', () => {
    // Count nouns never convert to each other: a slice is not an egg.
    expect(conv('slice', ING.eggs, CONVERSIONS)).toBeNull();
    // Volume → count with no density row.
    expect(conv('cup', ING.bacon, [])).toBeNull();
    // A line the engine can't convert is skipped, never a crash.
    const catalog: Catalog = {
      ...CATALOG,
      recipes: [recipe('X', 'Broken', [everyone('eggs', 2, 'slice'), everyone('bacon', 1)])]
    };
    const lines = buildLines(plan({ recipeIds: ['X'] }), catalog);
    expect(lines.map((l) => l.ing.id)).toEqual(['bacon']);
  });

  it('Engine_SplitsServings_ByRestrictionRule', () => {
    const p = plan({ headcount: 10, restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 } });
    const R = effectiveRestrictions(p);
    expect(servingsFor(except('pancake-mix', 0.5, 'gf'), 10, R)).toBe(9);
    expect(servingsFor(only('almond-flour', 1, 'gf'), 10, R)).toBe(1);
    expect(servingsFor(everyone('butter', 0.5), 10, R)).toBe(10);

    // No double count: mix for 9, almond flour for 1, butter for all 10.
    const lines = buildLines({ ...p, recipeIds: ['B001'] }, CATALOG);
    expect(lineFor(lines, 'pancake-mix').need).toBeCloseTo(4.5, 9);
    expect(lineFor(lines, 'almond-flour').need).toBe(1);
    expect(lineFor(lines, 'butter').need).toBe(5);
    expect(lineFor(lines, 'pancake-mix').sources[0].people).toBe(9);

    // A restriction count above the headcount is clamped for the math.
    const clamped = effectiveRestrictions(plan({ headcount: 4, restrictions: { gf: 9, nut: 0, dairy: 0, veg: 0 } }));
    expect(clamped.gf).toBe(4);
  });

  it('Engine_RoundsCountNeedUp_BeforePackaging', () => {
    // 0.25 orange × 10 = 2.5 → 3 oranges, sold singly.
    const lines = buildLines(plan({ recipeIds: ['B016'] }), CATALOG);
    const l = lineFor(lines, 'oranges');
    expect(l.need).toBe(3);
    expect(l.qty).toBe(3);
    expect(l.spent).toBeCloseTo(1.2, 9);
    expect(l.leftQty).toBe(0);
    expect(lineSentence(l)).toBe("You'll use 3 oranges. Buy 3, sold one at a time. Nothing left over.");
    expect(mathText(l)).toBe('sold one at a time → buy 3');
  });

  it('Engine_PicksLowestSpendThatCovers_WithLeftoverTiebreak', () => {
    const usable = PACKAGES.filter((p) => p.ingredientId === 'bacon');
    // 30 slices: 2 × Oscar Mayer ($14.98) beats 1 × Kirkland ($18.15).
    const at10 = recommendedPackage(usable, 30);
    expect(at10?.p.id).toBe('p-bac-om');
    expect(at10?.q).toBe(2);
    expect(at10?.spend).toBeCloseTo(14.98, 9);
    // 16 people (48 slices): Kirkland wins.
    const at16 = recommendedPackage(usable, 48);
    expect(at16?.p.id).toBe('p-bac-kirk');
    expect(at16?.q).toBe(1);
    // Tie on spend → less leftover.
    const tie = recommendedPackage([pkg('a', 'x', 'A', 5, 10), pkg('b', 'x', 'B', 5, 8)], 8);
    expect(tie?.p.id).toBe('b');

    // Through buildLines: the headcount dial flips the package.
    const ten = lineFor(buildLines(plan({ recipeIds: ['B003'] }), CATALOG), 'bacon');
    expect(ten.pkg?.id).toBe('p-bac-om');
    expect(ten.qty).toBe(2);
    expect(ten.status).toBe('ok');
    expect(lineSentence(ten)).toBe("You'll use 30 slices. Two packs hold 32 slices. 2 slices left over.");
    expect(mathText(ten)).toBe('30 slices ÷ 16 slices per pack = 1.88 → 2 packs');
    const sixteen = lineFor(buildLines(plan({ recipeIds: ['B003'], headcount: 16 }), CATALOG), 'bacon');
    expect(sixteen.pkg?.id).toBe('p-bac-kirk');
    expect(sixteen.qty).toBe(1);

    // The scout's own pick sticks; a hand-typed qty below the need reads as short.
    const picked = lineFor(
      buildLines(plan({ recipeIds: ['B003'], packageChoice: { bacon: 'p-bac-kirk' } }), CATALOG),
      'bacon'
    );
    expect(picked.pkg?.id).toBe('p-bac-kirk');
    expect(picked.rec?.id).toBe('p-bac-om');
    const short = lineFor(
      buildLines(plan({ recipeIds: ['B003'], qtyOverride: { bacon: { packageId: 'p-bac-om', qty: 1 } } }), CATALOG),
      'bacon'
    );
    expect(short.status).toBe('short');
    expect(short.shortQty).toBe(14);
    expect(short.overridden).toBe(true);
    expect(lineSentence(short)).toBe("You'll use 30 slices. One pack holds 16 slices. That's 14 slices short.");
  });

  it('Engine_ComputesSpentUsedLeftover_PerLineAndTotals', () => {
    const p = plan({
      recipeIds: ['B003', 'B009', 'B023', 'B016'],
      lineSource: { oranges: { source: 'home', note: 'Sam has a bag' } }
    });
    const lines = buildLines(p, CATALOG);
    // Store order: meat, dairy, produce, bakery, dry.
    expect(lines.map((l) => l.ing.id)).toEqual(['bacon', 'oj', 'oranges', 'salt']);

    const bacon = lineFor(lines, 'bacon');
    expect(bacon.spent).toBeCloseTo(14.98, 9);
    expect(bacon.used).toBeCloseTo((30 / 16) * 7.49, 9); // 14.04375
    expect(bacon.leftMoney).toBeCloseTo(14.98 - 14.04375, 9);
    expect(bacon.leftQty).toBe(2);

    const salt = lineFor(lines, 'salt');
    expect(salt.status).toBe('staple');
    expect(salt.spent).toBe(0);
    expect(salt.used).toBeCloseTo((2.5 / 300) * 1.99, 9);

    const oranges = lineFor(lines, 'oranges');
    expect(oranges.status).toBe('bring');
    expect(oranges.source).toBe('home');
    expect(oranges.note).toBe('Sam has a bag');
    expect(oranges.spent).toBe(0);
    expect(oranges.used).toBeCloseTo(1.2, 9);

    const oj = lineFor(lines, 'oj');
    expect(oj.status).toBe('unpriced');
    expect(oj.all).toHaveLength(1);
    expect(oj.usable).toHaveLength(0);

    const t = totalsOf(lines, p);
    expect(t.spent).toBeCloseTo(14.98, 9);
    expect(t.used).toBeCloseTo(14.04375, 9);
    expect(t.left).toBeCloseTo(0.93625, 9);
    expect(t.stapleUsed).toBeCloseTo((2.5 / 300) * 1.99, 9);
    expect(t.bringUsed).toBeCloseTo(1.2, 9);
    expect(t.bring).toEqual(['Oranges']);
    expect(t.unpriced).toEqual(['Orange juice']);
    expect(t.short).toEqual([]);
    expect(t.perSpent).toBeCloseTo(1.498, 9);
    expect(t.perUsed).toBeCloseTo(1.404375, 9);
    expect(t.perLeft).toBeCloseTo(0.093625, 9);

    expect(sourcesText(bacon)).toBe('for Bacon');
    const mix = lineFor(buildLines(plan({ recipeIds: ['B001'], restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 } }), CATALOG), 'pancake-mix');
    expect(sourcesText(mix)).toBe('for Pancakes (everyone except gluten-free, 9)');
  });

  it('Engine_WarnsOnlyForGlutenAndNuts', () => {
    // Bacon with a vegetarian count does not warn.
    expect(restrictionWarnings(plan({ recipeIds: ['B003'], restrictions: { gf: 0, nut: 0, dairy: 0, veg: 2 } }), CATALOG)).toEqual([]);
    // Butter with a dairy count does not warn either.
    expect(restrictionWarnings(plan({ recipeIds: ['T001'], restrictions: { gf: 0, nut: 0, dairy: 1, veg: 0 } }), CATALOG)).toEqual([]);
    // Bread with a GF count and no only-GF line warns, naming the ingredient.
    const w = restrictionWarnings(plan({ recipeIds: ['T001'], restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 } }), CATALOG);
    expect(w).toHaveLength(1);
    expect(w[0].recipe.id).toBe('T001');
    expect(w[0].restriction.key).toBe('gf');
    expect(w[0].count).toBe(1);
    expect(w[0].ingredients).toEqual(['Bread']);
    // Pancakes has an only-GF swap line, so the GF count does not warn…
    expect(restrictionWarnings(plan({ recipeIds: ['B001'], restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 } }), CATALOG)).toEqual([]);
    // …and almond flour on an only-GF line is not fed to everyone, so a nut count doesn't either.
    expect(restrictionWarnings(plan({ recipeIds: ['B001'], restrictions: { gf: 0, nut: 1, dairy: 0, veg: 0 } }), CATALOG)).toEqual([]);
    // Zero restricted people → nothing to warn about.
    expect(restrictionWarnings(plan({ recipeIds: ['T001'] }), CATALOG)).toEqual([]);
  });

  it('Engine_FormatsQuantities_FractionsForVolumeWholeForCounts', () => {
    expect(qtyText(0.5, UNITS.cup)).toBe('½ cup');
    expect(qtyText(4.5, UNITS.cup)).toBe('4½ cups');
    expect(qtyText(3, UNITS.slice)).toBe('3 slices');
    expect(qtyText(2.5, UNITS.slice)).toBe('3 slices'); // the store list rounds counts up
    expect(qtyText(2.5, UNITS.egg, true)).toBe('2½ eggs'); // recipe cards keep the fraction
    expect(qtyText(1, UNITS.egg)).toBe('1 egg');
    expect(qtyText(2.6, UNITS.gram)).toBe('2.6 g');
    expect(qtyText(0.125, UNITS.cup)).toBe('⅛ cup');
    expect(fracText(1.25)).toBe('1¼');
    expect(fracText(0.3)).toBe('0.3');
    expect(perPersonText(2.5, ING.eggs)).toBe('2½ eggs');
    expect(perPersonText(0.5, ING['pancake-mix'])).toBe('½ cup pancake mix');
    expect(perPersonText(0.5, ING.cinnamon, UNITS.tsp)).toBe('½ tsp cinnamon');
  });

  // Patrick, 2026-09-08: the planner starts agnostic — nothing ticked, six people, no restrictions.
  it('Engine_SeedsBlankBreakfastForSix_NothingPreselected', () => {
    const p = seedPlan(CATALOG);
    expect(p.meal).toBe('breakfast');
    expect(p.headcount).toBe(6);
    expect(p.restrictions).toEqual({ gf: 0, nut: 0, dairy: 0, veg: 0 });
    expect(p.recipeIds).toEqual([]);
    expect(p.budgetPerPerson).toBe(4);
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Engine_SwitchingMeal_KeepsPeopleDropsRecipesThatDontFit', () => {
    const lunch = recipe('L001', 'Sandwiches', [everyone('bread', 2)], ['lunch']);
    const cat = { ...CATALOG, recipes: [...RECIPES, lunch] };
    const p = plan({ recipeIds: ['B001', 'L001'], restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 }, headcount: 12 });
    const next = withMeal(p, 'lunch', cat);
    expect(next.meal).toBe('lunch');
    expect(next.recipeIds).toEqual(['L001']);
    expect(next.headcount).toBe(12);
    expect(next.restrictions.gf).toBe(1);
  });

  it('Engine_RestoresStoredDraft_ClampingAndDroppingUnknowns', () => {
    // Garbage in → the seed out, never a throw.
    expect(restorePlan(null, CATALOG)).toEqual(seedPlan(CATALOG));
    expect(restorePlan('nope', CATALOG).headcount).toBe(6);
    const r = restorePlan(
      {
        meal: 'breakfast',
        headcount: 40,
        restrictions: { gf: '3', nut: -2, bogus: 9 },
        recipeIds: ['B003', 'GONE', 'B003'],
        packageChoice: { bacon: 'p-bac-kirk', eggs: 'p-missing' },
        qtyOverride: { bacon: { packageId: 'p-bac-kirk', qty: 500 }, oranges: { packageId: 'nope', qty: 1 } },
        lineSource: { bread: { source: 'home', note: 'Sam' }, oj: { source: 'teleport' } },
        budgetPerPerson: -1,
        date: 'yesterday',
        patrol: 'Owls',
        extra: true
      },
      CATALOG
    );
    expect(r.headcount).toBe(16);
    expect(r.restrictions).toEqual({ gf: 3, nut: 0, dairy: 0, veg: 0 });
    expect(r.recipeIds).toEqual(['B003']);
    expect(r.packageChoice).toEqual({ bacon: 'p-bac-kirk' });
    expect(r.qtyOverride).toEqual({ bacon: { packageId: 'p-bac-kirk', qty: 99 } });
    expect(r.lineSource).toEqual({ bread: { source: 'home', note: 'Sam' } });
    expect(r.budgetPerPerson).toBe(4);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.patrol).toBe('Owls');
    expect('extra' in r).toBe(false);
  });
});
