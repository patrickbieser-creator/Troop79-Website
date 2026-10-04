import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Menu Monster leader tools — a single food in one step, against the local
 * stack. createFood writes what a food like Cookies needs (an ingredient, a
 * priced package, a one-line published menu item) from one form; and a brand
 * new menu item never keeps the editor's `__new__` placeholder as its id.
 *
 * Same request-glue mocks as menu-monster-authoring-db.test.ts. Every row is
 * named "ZZ Food …", so its slugged ids start `zz-food-` / `p-zz-food-`.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['library.moderate']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { createFood, saveRecipe, type FoodInput } from '../src/app/admin/(workspace)/library/menu-monster/actions';

const admin = adminClient();

async function cleanup() {
  await admin.from('mm_recipe_lines').delete().like('recipe_id', 'zz-food-%');
  await admin.from('mm_recipes').delete().like('id', 'zz-food-%');
  await admin.from('mm_recipes').delete().eq('id', '__new__');
  await admin.from('mm_packages').delete().like('ingredient_id', 'zz-food-%');
  await admin.from('mm_ingredients').delete().like('id', 'zz-food-%');
}

beforeAll(cleanup);
afterAll(cleanup);

const cookies = (over: Partial<FoodInput> = {}): FoodInput => ({
  ingredient: { name: 'ZZ Food Cookies', unit: { kind: 'count', key: 'count', one: 'cookie', many: 'cookies' }, section: 'bakery', staple: false, avoid: ['gf'] },
  package: { name: 'ZZ Chips Ahoy, 13 oz', store: null, price: 4.29, holds: 36, asOf: '2026-10-03' },
  menu: { amount: '2', mealFit: ['snack', 'dessert'], foodGroups: ['grain'] },
  ...over
});

describe('menu monster leader tools — a single food in one step', () => {
  it('Leader_AddsASingleFood_AsIngredientPackageAndPublishedMenuItem', async () => {
    const res = await createFood(cookies());
    expect(res).toMatchObject({ ok: true, id: 'zz-food-cookies', recipeId: 'zz-food-cookies' });

    const { data: ing } = await admin.from('mm_ingredients').select('name, unit_one, unit_many, section, avoid').eq('id', 'zz-food-cookies').single();
    expect(ing).toMatchObject({ name: 'ZZ Food Cookies', unit_one: 'cookie', unit_many: 'cookies', section: 'bakery', avoid: ['gf'] });
    const { data: pkgs } = await admin.from('mm_packages').select('name, price, yield').eq('ingredient_id', 'zz-food-cookies');
    expect(pkgs).toHaveLength(1);
    expect(pkgs?.[0]).toMatchObject({ name: 'ZZ Chips Ahoy, 13 oz', yield: 36 });
    expect(Number(pkgs?.[0].price)).toBe(4.29);
    const { data: recipe } = await admin.from('mm_recipes').select('name, status, meal_fit, method').eq('id', 'zz-food-cookies').single();
    expect(recipe).toMatchObject({ name: 'ZZ Food Cookies', status: 'published', meal_fit: ['snack', 'dessert'], method: 'no-cook' });
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id, qty_per_person, serves_rule').eq('recipe_id', 'zz-food-cookies');
    expect(lines).toHaveLength(1);
    expect(lines?.[0]).toMatchObject({ ingredient_id: 'zz-food-cookies', serves_rule: 'everyone' });
    expect(Number(lines?.[0].qty_per_person)).toBe(2);
  });

  it('Leader_CannotAddAFood_ThatIsAlreadyInThePriceBook', async () => {
    const res = await createFood(cookies());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already in the price book/);
    const { data } = await admin.from('mm_ingredients').select('id').like('id', 'zz-food-cookies%');
    expect(data).toHaveLength(1);
  });

  it('Leader_AddsAnUnpricedFood_SavedAsADraftThatSaysWhy', async () => {
    const res = await createFood(cookies({ ingredient: { ...cookies().ingredient, name: 'ZZ Food Brownies' }, package: null }));
    expect(res).toMatchObject({ ok: true, recipeId: 'zz-food-brownies' });
    expect(res.note).toMatch(/draft/);
    const { data } = await admin.from('mm_recipes').select('status').eq('id', 'zz-food-brownies').single();
    expect((data as { status: string }).status).toBe('draft');
  });

  it('Leader_AddsAnIngredientOnly_WithNoMenuItem', async () => {
    const res = await createFood(cookies({ ingredient: { ...cookies().ingredient, name: 'ZZ Food Sprinkles' }, menu: null }));
    expect(res).toMatchObject({ ok: true, id: 'zz-food-sprinkles' });
    expect(res.recipeId).toBeUndefined();
    const { data } = await admin.from('mm_recipes').select('id').eq('id', 'zz-food-sprinkles');
    expect(data).toHaveLength(0);
  });

  it('Leader_IsRefused_BeforeAnythingIsWritten_WhenTheServingIsMissing', async () => {
    const res = await createFood(cookies({ ingredient: { ...cookies().ingredient, name: 'ZZ Food Fudge' }, menu: { amount: '', mealFit: ['snack'], foodGroups: [] } }));
    expect(res.ok).toBe(false);
    const { data } = await admin.from('mm_ingredients').select('id').eq('id', 'zz-food-fudge');
    expect(data).toHaveLength(0);
  });

  it('NewMenuItem_NeverKeepsTheEditorPlaceholder_AsItsId', async () => {
    const res = await saveRecipe({
      id: '__new__', name: 'ZZ Food Placeholder', status: 'draft', mealFit: ['snack'], foodGroups: [],
      camp: true, trail: false, method: null, stepsMd: '', base: [], variations: []
    });
    expect(res).toEqual({ ok: true, id: 'zz-food-placeholder' });
  });
});
