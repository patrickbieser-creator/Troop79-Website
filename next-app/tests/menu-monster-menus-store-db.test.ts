import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { MAX_MENUS_PER_SCOUT, type Menu } from '../src/lib/menu-monster/menus';
import { CATALOG } from './helpers/menu-monster-fixture';
import { buildSnapshot } from '../src/lib/menu-monster/menu-snapshot';
import {
  createMenuWith,
  MENU_LIMIT,
  deleteMenuWith,
  duplicateMenuWith,
  listMenusWith,
  loadMenuWith,
  saveMenuWith
} from '../src/lib/menu-monster/menus-store';

/**
 * Scout Workspace, Phase 1 slice 3: the menu store against local Postgres.
 * The invariant that matters most: a scout reads and writes ONLY their own
 * menus — every write is scoped by the actor's person id, which the server
 * action takes from the verified session, never from the client.
 *
 * Rows belong to the test scout (Charlie Walters, person 39) and one other
 * person; everything named MARKER is removed after each test.
 */

const MARKER = 'vitest-mm-store';
const admin = adminClient();
const CHARLIE = { personId: 39, label: 'Charlie W.' };
let other: { personId: number; label: string };

const menu = (overrides: Partial<Menu> = {}): Menu => ({
  name: MARKER,
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  freeItems: [],
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'], recipeEdits: {} }],
  ...overrides
});

beforeAll(async () => {
  const { data } = await admin.from('people').select('id').neq('id', CHARLIE.personId).order('id').limit(1).single();
  other = { personId: data!.id as number, label: 'Other P.' };
});

afterEach(async () => {
  // %…%: duplicates are named "Copy of <MARKER>".
  await admin.from('mm_menus').delete().like('name', `%${MARKER}%`);
  await admin.from('audit_log').delete().eq('area', 'menus').like('summary', `%${MARKER}%`);
});

async function auditSummaries(): Promise<string[]> {
  const { data } = await admin.from('audit_log').select('summary').eq('area', 'menus').like('summary', `%${MARKER}%`).order('id');
  return (data ?? []).map((r) => r.summary as string);
}

describe('menu store dayCount', () => {
  it('Scout_KeepsTheirDayCount_AcrossSaveAndLoad', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu({ dayCount: 6 }), CATALOG);
    expect((await loadMenuWith(admin, id))!.menu.dayCount).toBe(6);
  });

  it('Load_CoversALateMeal_WhenTheStoredCountIsSmaller', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu({ dayCount: 2 }), CATALOG);
    await admin.from('mm_menus').update({ meals: [{ id: 'm1', day: 4, slot: 'lunch', headcount: null, recipeIds: [], recipeEdits: {} }] }).eq('id', id);
    expect((await loadMenuWith(admin, id))!.menu.dayCount).toBe(5);
  });
});

describe('menu store', () => {
  it('Scout_CanCreateAndListOwnMenus', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await createMenuWith(admin, other, menu({ name: `${MARKER} theirs` }), CATALOG);
    const mine = await listMenusWith(admin, CHARLIE.personId);
    const names = mine.filter((m) => m.name.startsWith(MARKER)).map((m) => m.name);
    expect(names).toEqual([MARKER]);
    expect(mine.find((m) => m.id === id)).toMatchObject({ context: 'camp', mealCount: 1, headcount: 8 });
  });

  it('Scout_CanLoadOwnMenu_AsTheMenuItSaved', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const loaded = await loadMenuWith(admin, id);
    expect(loaded?.ownerPersonId).toBe(CHARLIE.personId);
    expect(loaded?.menu).toEqual(menu());
  });

  it('Scout_CannotSaveMenu_OwnedByAnotherScout', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    const loaded = await loadMenuWith(admin, id);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), loaded!.updatedAt, CATALOG);
    expect(res.status).toBe('not_found');
    expect((await loadMenuWith(admin, id))?.menu.headcount).toBe(8);
  });

  it('Scout_CannotDeleteMenu_OwnedByAnotherScout', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    expect(await deleteMenuWith(admin, CHARLIE, id)).toBe(false);
    expect(await loadMenuWith(admin, id)).not.toBeNull();
  });

  it('Scout_CannotDuplicateMenu_OwnedByAnotherScout', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    expect(await duplicateMenuWith(admin, CHARLIE, id)).toBeNull();
  });

  it('Save_UpdatesTheMenu_AndReturnsTheNewVersion', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const before = await loadMenuWith(admin, id);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), before!.updatedAt, CATALOG);
    expect(res.status).toBe('saved');
    const after = await loadMenuWith(admin, id);
    expect(after?.menu.headcount).toBe(12);
    expect(res.status === 'saved' && res.updatedAt).toBe(after?.updatedAt);
  });

  it('Save_ReportsConflict_WhenTheMenuChangedSinceItWasLoaded', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const stale = (await loadMenuWith(admin, id))!.updatedAt;
    await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 10 }), stale, CATALOG);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 14 }), stale, CATALOG);
    expect(res.status).toBe('conflict');
    expect((await loadMenuWith(admin, id))?.menu.headcount).toBe(10);
  });

  it('Audit_RecordsCreateRenameDuplicateDelete_ButNotContentEdits', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    let v = (await loadMenuWith(admin, id))!.updatedAt;
    const edit = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 11 }), v, CATALOG);
    v = edit.status === 'saved' ? edit.updatedAt : v;
    await saveMenuWith(admin, CHARLIE, id, menu({ name: `${MARKER} renamed`, headcount: 11 }), v, CATALOG);
    const copy = await duplicateMenuWith(admin, CHARLIE, id);
    await deleteMenuWith(admin, CHARLIE, copy!);
    expect(await auditSummaries()).toEqual([
      `Charlie W. created menu "${MARKER}"`,
      `Charlie W. renamed menu "${MARKER}" to "${MARKER} renamed"`,
      `Charlie W. duplicated menu "${MARKER} renamed"`,
      `Charlie W. deleted menu "Copy of ${MARKER} renamed"`
    ]);
  });

  it('Duplicate_CopiesMealsAndPeople_AsANewMenu', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const copyId = await duplicateMenuWith(admin, CHARLIE, id);
    const copy = await loadMenuWith(admin, copyId!);
    expect(copy?.menu).toEqual(menu({ name: `Copy of ${MARKER}` }));
    expect(copy?.ownerPersonId).toBe(CHARLIE.personId);
  });

  it('Delete_RemovesOwnMenu', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    expect(await deleteMenuWith(admin, CHARLIE, id)).toBe(true);
    expect(await loadMenuWith(admin, id)).toBeNull();
  });
});

describe('menu store shopping + snapshot (slice 5)', () => {
  const SHOP = {
    packageChoice: { 'pancake-mix': 'p-mix-krus' },
    qtyOverride: { 'pancake-mix': { packageId: 'p-mix-krus', qty: 3 } },
    lineSource: { eggs: { source: 'home' as const, note: 'Mom' } }
  };

  it('Scout_KeepsTheirShoppingChoices_AcrossSaveAndLoad', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu({ shopping: SHOP }), CATALOG);
    expect((await loadMenuWith(admin, id))!.menu.shopping).toEqual(SHOP);
  });

  it('Load_FoldsPerMealChoicesIntoTheMenu_ForMenusSavedBeforeSlice5', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await admin
      .from('mm_menus')
      .update({
        shopping: {},
        meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'], packageChoice: { 'pancake-mix': 'p-mix-krus' }, qtyOverride: {}, lineSource: {}, recipeEdits: {} }]
      })
      .eq('id', id);
    const loaded = (await loadMenuWith(admin, id))!.menu;
    expect(loaded.shopping.packageChoice).toEqual({ 'pancake-mix': 'p-mix-krus' });
    expect(loaded.meals[0]).not.toHaveProperty('packageChoice');
  });

  it('Create_StoresAPricedSnapshot_BuiltFromTheMergedList', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const snap = (await loadMenuWith(admin, id))!.snapshot!;
    const expected = buildSnapshot(menu(), CATALOG);
    expect(snap).toEqual(expected);
    expect(snap.totals.spent).toBeGreaterThan(0);
  });

  it('Save_RebuildsTheSnapshot_OnEverySave', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const v = (await loadMenuWith(admin, id))!.updatedAt;
    await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 40 }), v, CATALOG);
    const snap = (await loadMenuWith(admin, id))!.snapshot!;
    expect(snap).toEqual(buildSnapshot(menu({ headcount: 40 }), CATALOG));
  });

  it('Save_ReplacesAStaleSnapshot_EvenWhenTheMenuIsUnchanged', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await admin.from('mm_menus').update({ snapshot: { v: 1, asOf: '2020-01-01', totals: { spent: 1, used: 1, left: 0 }, perPerson: 0, lines: [] } }).eq('id', id);
    const v = (await loadMenuWith(admin, id))!.updatedAt;
    await saveMenuWith(admin, CHARLIE, id, menu(), v, CATALOG);
    expect((await loadMenuWith(admin, id))!.snapshot).toEqual(buildSnapshot(menu(), CATALOG));
  });

  it('Load_ReturnsNoSnapshot_ForARowThatNeverHadOne', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await admin.from('mm_menus').update({ snapshot: null }).eq('id', id);
    expect((await loadMenuWith(admin, id))!.snapshot).toBeNull();
  });

  it('Duplicate_CarriesTheSnapshotOver', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const copy = await duplicateMenuWith(admin, CHARLIE, id);
    expect((await loadMenuWith(admin, copy!))!.snapshot).toEqual((await loadMenuWith(admin, id))!.snapshot);
  });

  it('Shopping_MustBeAnObject_AtTheDatabase', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const { error } = await admin.from('mm_menus').update({ shopping: [] }).eq('id', id);
    expect(error).not.toBeNull();
  });
});

describe('menu store per-scout cap', () => {
  const fill = async (n: number) => {
    const rows = Array.from({ length: n }, (_, i) => ({ owner_person_id: CHARLIE.personId, name: `${MARKER} fill ${i}`, context: 'camp', headcount: 8 }));
    const { error } = await admin.from('mm_menus').insert(rows);
    expect(error).toBeNull();
  };
  const mine = async () => (await admin.from('mm_menus').select('id', { count: 'exact', head: true }).eq('owner_person_id', CHARLIE.personId).like('name', `%${MARKER}%`)).count;

  it('Scout_CannotCreateAMenu_WhenAlreadyAtTheCap', async () => {
    await fill(MAX_MENUS_PER_SCOUT - (await listMenusWith(admin, CHARLIE.personId)).length);
    expect(await createMenuWith(admin, CHARLIE, menu(), CATALOG)).toBe(MENU_LIMIT);
  });

  it('Scout_CanCreateAMenu_WhenOneUnderTheCap', async () => {
    await fill(MAX_MENUS_PER_SCOUT - 1 - (await listMenusWith(admin, CHARLIE.personId)).length);
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    expect(id).not.toBe(MENU_LIMIT);
  });

  it('Scout_CannotDuplicateAMenu_WhenAlreadyAtTheCap', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await fill(MAX_MENUS_PER_SCOUT - (await listMenusWith(admin, CHARLIE.personId)).length);
    const before = await mine();
    expect(await duplicateMenuWith(admin, CHARLIE, id as string)).toBe(MENU_LIMIT);
    expect(await mine()).toBe(before);
  });

  it('OtherScout_CanStillCreate_WhenAnotherScoutIsAtTheCap', async () => {
    await fill(MAX_MENUS_PER_SCOUT - (await listMenusWith(admin, CHARLIE.personId)).length);
    expect(await createMenuWith(admin, other, menu(), CATALOG)).not.toBe(MENU_LIMIT);
  });
});

describe('menu store actuals + free items (Phase 2 release A)', () => {
  it('Load_ReadsActualsAndFreeItems_FromTheRow', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const actuals = { eggs: { packageId: 'p-eggs', qty: 2, pricePaid: 3.49 } };
    const freeItems = [{ id: 'new:0a1b2c3d', name: 'Marshmallows' }];
    await admin.from('mm_menus').update({ actuals, free_items: freeItems }).eq('id', id);
    const loaded = (await loadMenuWith(admin, id))!.menu;
    expect({ actuals: loaded.actuals, freeItems: loaded.freeItems }).toEqual({ actuals, freeItems });
  });

  it('Save_DoesNotWriteActuals_ThroughTheNormalSavePath', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const stored = (await loadMenuWith(admin, id))!;
    const claimed = { eggs: { packageId: 'p-eggs', qty: 99, pricePaid: 0.01 } };
    const result = await saveMenuWith(admin, CHARLIE, id, menu({ actuals: claimed }), stored.updatedAt, CATALOG);
    expect(result.status).toBe('saved');
    expect((await loadMenuWith(admin, id))!.menu.actuals).toEqual({});
  });
});
