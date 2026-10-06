import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { draftsMatching, listDraftItemsWith, type DraftItem } from '../src/lib/menu-monster/draft-items';

/**
 * Patrick, 2026-10-06: Cookies (a troop single food, still a DRAFT) did not appear in a meal's search, and nothing
 * said why — the planner lists only published items. The planner pages now also load the NAMES of the troop's
 * draft items (id, name, meal fit; nothing else) so the no-match line can say so. Rows are `vitest-draftitem-*`.
 */
const admin = adminClient();

afterEach(async () => {
  await admin.from('mm_recipes').delete().like('id', 'vitest-draftitem-%');
  await admin.from('mm_recipes').delete().like('id', 'S-0000c0%');
});

const insert = (id: string, status: string, mealFit: string[]) =>
  admin.from('mm_recipes').insert({ id: `vitest-draftitem-${id}`, name: `Vitest draftitem ${id}`, status, meal_fit: mealFit, food_groups: [], camp: true, trail: false });

describe('the troop draft names the planner pages load', () => {
  it('ATroopDraft_IsListed_WithItsIdNameAndMealFit', async () => {
    await insert('a', 'draft', ['snack']);
    const found = (await listDraftItemsWith(admin)).find((d) => d.id === 'vitest-draftitem-a');
    expect(found).toEqual({ id: 'vitest-draftitem-a', name: 'Vitest draftitem a', mealFit: ['snack'] });
  });

  it('APublishedItem_IsNotListed', async () => {
    await insert('b', 'published', ['snack']);
    expect((await listDraftItemsWith(admin)).some((d) => d.id === 'vitest-draftitem-b')).toBe(false);
  });

  it('ARetiredItem_IsNotListed', async () => {
    await insert('c', 'retired', ['snack']);
    expect((await listDraftItemsWith(admin)).some((d) => d.id === 'vitest-draftitem-c')).toBe(false);
  });

  it('AScoutsDraft_IsNeverListed_ItIsTheirsAlone', async () => {
    const { error } = await admin.from('mm_recipes').insert({ id: 'S-0000c0d1', name: 'Vitest draftitem scout', status: 'draft', meal_fit: ['snack'], food_groups: [], camp: true, trail: false, author_person_id: 39 });
    expect(error).toBeNull();
    const listed = (await listDraftItemsWith(admin)).some((d) => d.id === 'S-0000c0d1');
    expect(listed).toBe(false);
  });
});

describe('which drafts a search names', () => {
  const D = (name: string, mealFit: DraftItem['mealFit'], id = name.toLowerCase()): DraftItem => ({ id, name, mealFit });
  const drafts = [D('Cookies', ['snack', 'dessert']), D('Chili', ['dinner']), D('Cocoa', ['snack'])];

  it('ADraftWhoseNameHasTheQuery_ForThisMeal_IsNamed', () => {
    expect(draftsMatching(drafts, 'cook', 'snack').map((d) => d.name)).toEqual(['Cookies']);
  });

  it('ADraftForAnotherMeal_IsNotNamed', () => {
    expect(draftsMatching(drafts, 'chili', 'snack')).toEqual([]);
  });

  it('ANoQuery_NamesNothing', () => {
    expect(draftsMatching(drafts, '  ', 'snack')).toEqual([]);
  });

  it('SeveralMatches_AreAToZ_AndCappedAtThree', () => {
    const many = ['Cobbler', 'Cocoa', 'Coleslaw', 'Cookies'].map((n) => D(n, ['snack']));
    expect(draftsMatching(many, 'co', 'snack').map((d) => d.name)).toEqual(['Cobbler', 'Cocoa', 'Coleslaw']);
  });
});
