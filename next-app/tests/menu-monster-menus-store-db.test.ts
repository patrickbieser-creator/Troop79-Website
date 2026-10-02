import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import type { Menu } from '../src/lib/menu-monster/menus';
import {
  createMenuWith,
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
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'], packageChoice: {}, qtyOverride: {}, lineSource: {}, recipeEdits: {} }],
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
    const id = await createMenuWith(admin, CHARLIE, menu({ dayCount: 6 }));
    expect((await loadMenuWith(admin, id))!.menu.dayCount).toBe(6);
  });

  it('Load_CoversALateMeal_WhenTheStoredCountIsSmaller', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu({ dayCount: 2 }));
    await admin.from('mm_menus').update({ meals: [{ id: 'm1', day: 4, slot: 'lunch', headcount: null, recipeIds: [], packageChoice: {}, qtyOverride: {}, lineSource: {}, recipeEdits: {} }] }).eq('id', id);
    expect((await loadMenuWith(admin, id))!.menu.dayCount).toBe(5);
  });
});

describe('menu store', () => {
  it('Scout_CanCreateAndListOwnMenus', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu());
    await createMenuWith(admin, other, menu({ name: `${MARKER} theirs` }));
    const mine = await listMenusWith(admin, CHARLIE.personId);
    const names = mine.filter((m) => m.name.startsWith(MARKER)).map((m) => m.name);
    expect(names).toEqual([MARKER]);
    expect(mine.find((m) => m.id === id)).toMatchObject({ context: 'camp', mealCount: 1, headcount: 8 });
  });

  it('Scout_CanLoadOwnMenu_AsTheMenuItSaved', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu());
    const loaded = await loadMenuWith(admin, id);
    expect(loaded?.ownerPersonId).toBe(CHARLIE.personId);
    expect(loaded?.menu).toEqual(menu());
  });

  it('Scout_CannotSaveMenu_OwnedByAnotherScout', async () => {
    const id = await createMenuWith(admin, other, menu());
    const loaded = await loadMenuWith(admin, id);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), loaded!.updatedAt);
    expect(res.status).toBe('not_found');
    expect((await loadMenuWith(admin, id))?.menu.headcount).toBe(8);
  });

  it('Scout_CannotDeleteMenu_OwnedByAnotherScout', async () => {
    const id = await createMenuWith(admin, other, menu());
    expect(await deleteMenuWith(admin, CHARLIE, id)).toBe(false);
    expect(await loadMenuWith(admin, id)).not.toBeNull();
  });

  it('Scout_CannotDuplicateMenu_OwnedByAnotherScout', async () => {
    const id = await createMenuWith(admin, other, menu());
    expect(await duplicateMenuWith(admin, CHARLIE, id)).toBeNull();
  });

  it('Save_UpdatesTheMenu_AndReturnsTheNewVersion', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu());
    const before = await loadMenuWith(admin, id);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), before!.updatedAt);
    expect(res.status).toBe('saved');
    const after = await loadMenuWith(admin, id);
    expect(after?.menu.headcount).toBe(12);
    expect(res.status === 'saved' && res.updatedAt).toBe(after?.updatedAt);
  });

  it('Save_ReportsConflict_WhenTheMenuChangedSinceItWasLoaded', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu());
    const stale = (await loadMenuWith(admin, id))!.updatedAt;
    await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 10 }), stale);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 14 }), stale);
    expect(res.status).toBe('conflict');
    expect((await loadMenuWith(admin, id))?.menu.headcount).toBe(10);
  });

  it('Audit_RecordsCreateRenameDuplicateDelete_ButNotContentEdits', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu());
    let v = (await loadMenuWith(admin, id))!.updatedAt;
    const edit = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 11 }), v);
    v = edit.status === 'saved' ? edit.updatedAt : v;
    await saveMenuWith(admin, CHARLIE, id, menu({ name: `${MARKER} renamed`, headcount: 11 }), v);
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
    const id = await createMenuWith(admin, CHARLIE, menu());
    const copyId = await duplicateMenuWith(admin, CHARLIE, id);
    const copy = await loadMenuWith(admin, copyId!);
    expect(copy?.menu).toEqual(menu({ name: `Copy of ${MARKER}` }));
    expect(copy?.ownerPersonId).toBe(CHARLIE.personId);
  });

  it('Delete_RemovesOwnMenu', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu());
    expect(await deleteMenuWith(admin, CHARLIE, id)).toBe(true);
    expect(await loadMenuWith(admin, id)).toBeNull();
  });
});
