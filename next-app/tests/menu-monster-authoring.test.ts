import { describe, it, expect } from 'vitest';
import type { Catalog, Conversion, Ingredient, Package, Recipe } from '../src/lib/menu-monster/types';
import { UNITS } from '../src/lib/menu-monster/units';
import {
  BIG_CHANGE,
  STALE_DAYS,
  blockingIssues,
  changeUnitPlan,
  priceChange,
  recipeIssues,
  staleDays,
  staleText,
  suggestYield,
  unusableText,
  type RecipeDraft
} from '../src/lib/menu-monster/authoring';

/**
 * Menu Monster leader tools — the pure authoring helpers
 * (Plans/Menu-Monster-Leader-Tools.md, Test Plan). No DB, no React: the
 * yield helper, the price flags, the publish gate and the change-unit plan
 * are all decided here so the editors only render what these return.
 */

const count = (one: string, many: string) => ({ key: 'count', one, many, kind: 'count' as const });

const ING: Record<string, Ingredient> = {
  'pancake-mix': { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null },
  'almond-flour': { id: 'almond-flour', name: 'Almond flour', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['nut'], retiredAt: null },
  bacon: { id: 'bacon', name: 'Bacon', unit: UNITS.slice, section: 'meat', staple: false, avoid: ['veg'], retiredAt: null },
  eggs: { id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [], retiredAt: null },
  milk: { id: 'milk', name: 'Milk', unit: UNITS.cup, section: 'dairy', staple: false, avoid: ['dairy'], retiredAt: null },
  oranges: { id: 'oranges', name: 'Oranges', unit: count('orange', 'oranges'), section: 'produce', staple: false, avoid: [], retiredAt: null },
  oj: { id: 'oj', name: 'Orange juice', unit: UNITS.cup, section: 'dairy', staple: false, avoid: [], retiredAt: null }
};

const pkg = (id: string, ingredientId: string, name: string, price: number, yield_: number | null, noun = 'pack'): Package => ({
  id, ingredientId, name, store: 'Kroger', price, yield: yield_,
  yieldUnitLabel: yield_ == null ? 'gallon' : null, noun, soldSize: null, soldUnit: null, note: null,
  asOf: '2026-08-22', retiredAt: null
});

const PACKAGES: Package[] = [
  pkg('p-mix-10lb', 'pancake-mix', 'Krusteaz Pancake Mix, 10 lb', 15, 36, 'bag'),
  pkg('p-alm-brm', 'almond-flour', 'Bob’s Red Mill Almond Flour, 1 lb', 8, 3, 'bag'),
  pkg('p-bac-om', 'bacon', 'Oscar Mayer Bacon, 16 oz', 7.49, 16),
  pkg('p-egg-store', 'eggs', 'Store Brand White Eggs, dozen', 2.99, 12, 'dozen'),
  pkg('p-milk-gal', 'milk', 'Milk, gallon', 3.49, 16, 'gallon'),
  pkg('p-oj-gallon', 'oj', 'Orange juice, gallon', 8, null, 'gallon')
];

const CONVERSIONS: Conversion[] = [
  { ingredientId: 'pancake-mix', from: 'ozw', to: 'cup', factor: 1 / 4.5, label: 'pancake mix ≈ 4.5 oz per cup' },
  { ingredientId: 'eggs', from: 'dozen', to: 'egg', factor: 12, label: '12 per dozen' }
];

const CATALOG: Catalog = { ingredients: Object.values(ING), packages: PACKAGES, conversions: CONVERSIONS, recipes: [] };

const draft = (over: Partial<RecipeDraft> = {}): RecipeDraft => ({
  id: 'pancakes',
  name: 'Pancakes',
  status: 'draft',
  mealFit: ['breakfast'],
  foodGroups: ['grain'],
  camp: true,
  trail: false,
  method: 'stove',
  stepsMd: '',
  lines: [
    { ingredientId: 'pancake-mix', amount: '½', unitKey: null, servesRule: 'except', servesRestrictions: ['gf'] },
    { ingredientId: 'almond-flour', amount: '0.5', unitKey: null, servesRule: 'only', servesRestrictions: ['gf'] }
  ],
  ...over
});

describe('yield helper (Option C)', () => {
  it('Authoring_SuggestsYield_FromSameFamilyLabel', () => {
    const milk = suggestYield(ING.milk, 1, 'gallon', CONVERSIONS);
    expect(milk.value).toBe(16);
    expect(milk.via).toBe('family');
    expect(milk.text).toBe('Suggested: ≈ 16 cups from 1 gallon.');
    expect(milk.sub).toMatch(/Same unit family/);

    const mix = suggestYield(ING['pancake-mix'], 10, 'lb', CONVERSIONS);
    expect(mix.value).toBeCloseTo(35.56, 1);
    expect(mix.via).toBe('conversion');
    expect(mix.text).toBe('Suggested: ≈ 35.6 cups from 10 lb.');
    expect(mix.sub).toMatch(/pancake mix ≈ 4.5 oz per cup/);
  });

  it('Authoring_PromptsForSize_WhenNothingTypedYet', () => {
    const r = suggestYield(ING.milk, null, 'gallon', CONVERSIONS);
    expect(r.value).toBeNull();
    expect(r.text).toBe('Type the size on the label and the tool will suggest how many cups it makes.');
  });

  it('Authoring_ReturnsNoPath_WhenLabelUnitCannotBridge', () => {
    const r = suggestYield(ING.bacon, 1, 'lb', CONVERSIONS);
    expect(r.value).toBeNull();
    expect(r.via).toBeNull();
    expect(r.text).toBe(
      "No conversion on file for Bacon sold by the lb. Type how many slices this package makes. Until then it can't be used."
    );
  });

  it('Authoring_ExplainsUnusablePackage_InTheIngredientUnit', () => {
    expect(unusableText(PACKAGES[5], ING.oj)).toBe(
      "Can't use yet: sold by the gallon, and nobody has said how many cups that makes."
    );
  });
});

describe('price flags', () => {
  it('Authoring_FlagsBigChange_Over25Percent', () => {
    expect(BIG_CHANGE).toBe(0.25);
    const big = priceChange(4.99, 6.49, true);
    expect(big.big).toBe(true);
    expect(big.text).toBe('⚠ Big change (+30%) — flagged for a second look');

    const small = priceChange(4.99, 5.99, true);
    expect(small.big).toBe(false);
    expect(small.text).toBe('+20% from $4.99');

    const down = priceChange(4.99, 2.49, true);
    expect(down.big).toBe(true);
    expect(down.text).toBe('⚠ Big change (−50%) — flagged for a second look');

    expect(priceChange(4.99, 4.99, true).text).toBe("Same price — save to confirm it's still current.");
    expect(priceChange(4.99, 4.99, false).text).toBeNull();
  });

  it('Authoring_FlagsStale_After90Days', () => {
    expect(STALE_DAYS).toBe(90);
    expect(staleDays('2026-06-09', '2026-09-08')).toBe(91);
    expect(staleText('2026-06-09', '2026-09-08')).toBe('Price is 91 days old — still used, but check it.');
    expect(staleDays('2026-06-11', '2026-09-08')).toBe(89);
    expect(staleText('2026-06-11', '2026-09-08')).toBeNull();
    expect(staleDays(null, '2026-09-08')).toBeNull();
    expect(staleText(null, '2026-09-08')).toBe('No price date — check it.');
  });
});

describe('publish gate', () => {
  it('Authoring_PassesACleanRecipe', () => {
    expect(recipeIssues(draft(), CATALOG)).toEqual([]);
  });

  it('Authoring_RecipeIssues_BlocksPublish_ForEachRule', () => {
    const one = (d: RecipeDraft) => {
      const errors = blockingIssues(recipeIssues(d, CATALOG));
      expect(errors).toHaveLength(1);
      return errors[0].text;
    };
    expect(one(draft({ name: '  ' }))).toBe('Give the menu item a name.');
    expect(one(draft({ lines: [] }))).toBe('Add at least one ingredient line.');
    expect(one(draft({ mealFit: [] }))).toBe('Pick at least one meal it fits.');
    expect(one(draft({ lines: [{ ingredientId: '', amount: '1', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })))
      .toBe('Line 1: pick an ingredient.');
    expect(one(draft({ lines: [{ ingredientId: 'oj', amount: '1', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })))
      .toBe('Line 1: Orange juice has no priced package yet — add one in the Price book.');
    expect(one(draft({ lines: [{ ingredientId: 'eggs', amount: 'two', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })))
      .toBe("Line 1: 'two' isn't a number. Type something like ½, 1/2 or 0.5.");
    expect(one(draft({ lines: [{ ingredientId: 'eggs', amount: '', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })))
      .toBe('Line 1: type an amount per person.');
    // A 0 is a number, just not a usable one (the seed's C001 draft carried one until Migration B).
    expect(one(draft({ lines: [{ ingredientId: 'eggs', amount: '0', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })))
      .toBe('Line 1: the amount per person must be more than zero.');
    expect(one(draft({ lines: [{ ingredientId: 'eggs', amount: '1', unitKey: 'slice', servesRule: 'everyone', servesRestrictions: [] }] })))
      .toBe("Line 1: Eggs can't be measured in slices — use eggs, or ask a leader to add a conversion in the Price book.");
    expect(
      one(
        draft({
          lines: [
            { ingredientId: 'eggs', amount: '1', unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
            { ingredientId: 'eggs', amount: '2', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
          ]
        })
      )
    ).toBe('Line 2: Eggs already has a line for everyone — combine them.');
  });

  it('Authoring_RecipeIssues_WarnsOnLonelySwapLine', () => {
    const lonely = draft({
      lines: [
        { ingredientId: 'eggs', amount: '2', unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: 'almond-flour', amount: '0.5', unitKey: null, servesRule: 'only', servesRestrictions: ['gf'] }
      ]
    });
    const issues = recipeIssues(lonely, CATALOG);
    expect(blockingIssues(issues)).toEqual([]);
    expect(issues.map((i) => i.text)).toEqual([
      "Line 2: only gluten-free people get Almond flour, but nothing is marked 'everyone except gluten-free' — is this a swap? Add the line it replaces."
    ]);
  });

  it('Authoring_RecipeIssues_WarnsWhenAllergenReachesEveryone', () => {
    const risky = draft({
      lines: [{ ingredientId: 'pancake-mix', amount: '½', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
    });
    const issues = recipeIssues(risky, CATALOG);
    expect(blockingIssues(issues)).toEqual([]);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].text).toBe(
      "Line 1: Pancake mix isn't gluten-free and everyone gets it — a gluten-free scout will be warned. Add an 'everyone except gluten-free' line and an 'only gluten-free' swap if you want one."
    );
    // Dairy and vegetarian never warn (obvious at the table).
    const milk = draft({ lines: [{ ingredientId: 'milk', amount: '1', unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] });
    expect(recipeIssues(milk, CATALOG)).toEqual([]);
  });
});

describe('change unit', () => {
  const lines = [
    { recipeId: 'pancakes', recipeName: 'Pancakes', unitKey: null },
    { recipeId: 'french-toast', recipeName: 'French toast', unitKey: 'tbsp' }
  ];

  it('Authoring_ChangeUnitPlan_ConvertsPackages_AndPinsLines', () => {
    const plan = changeUnitPlan(ING['pancake-mix'], UNITS.tbsp, PACKAGES.filter((p) => p.ingredientId === 'pancake-mix'), lines, CONVERSIONS);
    expect(plan.kind).toBe('family');
    expect(plan.factor).toBe(16);
    expect(plan.packages).toEqual([{ id: 'p-mix-10lb', name: 'Krusteaz Pancake Mix, 10 lb', yield: 576, yieldUnitLabel: null, converted: true }]);
    expect(plan.pinUnit).toBe('cup');
    expect(plan.pinnedLines).toEqual([{ recipeId: 'pancakes', recipeName: 'Pancakes' }]);
    expect(plan.summary).toEqual([
      '1 package will convert automatically (1 cup = 16 Tbsp).',
      '1 recipe line keeps cups and still costs out; 1 line already names its own unit.'
    ]);
  });

  it('Authoring_ChangeUnitPlan_FlipsPackagesUnusable_AcrossFamilies', () => {
    const plan = changeUnitPlan(ING['pancake-mix'], UNITS.gram, PACKAGES.filter((p) => p.ingredientId === 'pancake-mix'), lines, []);
    expect(plan.kind).toBe('cross');
    expect(plan.factor).toBeNull();
    expect(plan.packages).toEqual([{ id: 'p-mix-10lb', name: 'Krusteaz Pancake Mix, 10 lb', yield: null, yieldUnitLabel: 'cup', converted: false }]);
    expect(plan.pinUnit).toBe('cup');
    expect(plan.summary[0]).toBe('1 package will need a new yield typed in g before it can be used again.');
    expect(plan.summary[1]).toMatch(/2 recipe lines .*unit problem until a conversion from cups to g exists/);
  });

  it('Authoring_ChangeUnitPlan_BridgesAcrossFamilies_WhenAConversionExists', () => {
    const plan = changeUnitPlan(ING['pancake-mix'], UNITS.ozw, PACKAGES.filter((p) => p.ingredientId === 'pancake-mix'), lines, CONVERSIONS);
    expect(plan.kind).toBe('cross');
    expect(plan.packages[0].converted).toBe(true);
    expect(plan.packages[0].yield).toBe(162);
  });

  it('Authoring_ChangeUnitPlan_RenamesNounOnly_ForCountToCount', () => {
    const plan = changeUnitPlan(ING.oranges, count('navel', 'navels'), [], lines, []);
    expect(plan.kind).toBe('rename');
    expect(plan.pinUnit).toBeNull();
    expect(plan.summary).toEqual(['Only the name of the unit changes. Packages and recipe lines keep their numbers.']);
  });
});

describe('domain types carry retirement', () => {
  it('Authoring_RecipeType_AcceptsRetiredAt', () => {
    const r: Recipe = { id: 'x', name: 'X', status: 'retired', mealFit: [], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0, lines: [] };
    expect(r.status).toBe('retired');
  });
});
