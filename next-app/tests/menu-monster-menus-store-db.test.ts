import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { MAX_MENUS_PER_SCOUT, type Menu } from '../src/lib/menu-monster/menus';
import { CATALOG } from './helpers/menu-monster-fixture';
import { publicScoutName } from '../src/lib/scout-name';
import { buildSnapshot } from '../src/lib/menu-monster/menu-snapshot';
import {
  createMenuWith,
  MENU_LIMIT,
  deleteMenuWith,
  duplicateMenuWith,
  listAllMenusWith,
  listMenusWith,
  listOutingMenusWith,
  ownerCreditNamesWith,
  loadMenuWith,
  saveActualsWith,
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
  await admin.from('calendar_entries').delete().like('title', `${MARKER}%`);
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

  it('Leader_SavesAScoutsMenu_AndTheMenuStaysTheScouts', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    const loaded = await loadMenuWith(admin, id);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), loaded!.updatedAt, CATALOG, { asLeader: true });
    expect(res.status).toBe('saved');
    const after = await loadMenuWith(admin, id);
    expect(after?.menu.headcount).toBe(12);
    expect(after?.ownerPersonId).toBe(other.personId);
    // The owner is told: the row says the latest save was a leader's, and whose.
    expect(after?.leaderEdit?.byPersonId).toBe(CHARLIE.personId);
  });

  it('LeaderSave_LeavesWhatTheScoutPaidAlone', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    await admin.from('mm_menus').update({ actuals: { milk: { packageId: 'p-milk', qty: 1, pricePaid: 3.5 } }, gear_extras: ['Tarp'] }).eq('id', id);
    const loaded = await loadMenuWith(admin, id);
    await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), loaded!.updatedAt, CATALOG, { asLeader: true });
    const { data } = await admin.from('mm_menus').select('actuals, gear_extras').eq('id', id).single();
    expect(data).toEqual({ actuals: { milk: { packageId: 'p-milk', qty: 1, pricePaid: 3.5 } }, gear_extras: ['Tarp'] });
  });

  it('LeaderCannotDelete_AScoutsMenu', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    expect(await deleteMenuWith(admin, CHARLIE, id)).toBe(false);
    expect(await loadMenuWith(admin, id)).not.toBeNull();
  });

  it('OwnersNextSave_ClearsTheLeaderEditedMark', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    const first = await loadMenuWith(admin, id);
    const led = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), first!.updatedAt, CATALOG, { asLeader: true });
    if (led.status !== 'saved') throw new Error('fixture: the leader save did not land');
    const own = await saveMenuWith(admin, other, id, menu({ headcount: 10 }), led.updatedAt, CATALOG);
    expect(own.status).toBe('saved');
    expect((await loadMenuWith(admin, id))?.leaderEdit).toBeNull();
  });

  it('LeaderSave_IsAConflict_WhenTheScoutSavedFirst', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    const loaded = await loadMenuWith(admin, id);
    await saveMenuWith(admin, other, id, menu({ headcount: 9 }), loaded!.updatedAt, CATALOG);
    const res = await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), loaded!.updatedAt, CATALOG, { asLeader: true });
    expect(res.status).toBe('conflict');
    expect((await loadMenuWith(admin, id))?.menu.headcount).toBe(9);
  });

  it('LeaderSave_IsAudited', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    const loaded = await loadMenuWith(admin, id);
    await saveMenuWith(admin, CHARLIE, id, menu({ headcount: 12 }), loaded!.updatedAt, CATALOG, { asLeader: true });
    expect((await auditSummaries()).some((s) => /edited menu .* as a leader/.test(s))).toBe(true);
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

describe('menu store actuals (Phase 2 release A)', () => {
  it('Load_ReadsActuals_FromTheRow', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const actuals = { eggs: { packageId: 'p-eggs', qty: 2, pricePaid: 3.49 } };
    await admin.from('mm_menus').update({ actuals }).eq('id', id);
    expect((await loadMenuWith(admin, id))!.menu.actuals).toEqual(actuals);
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

describe('menu store actuals save (Phase 2 release B)', () => {
  const EGGS = { eggs: { packageId: 'p-egg-store', qty: 2, pricePaid: 3.49 } };
  // The same catalog with every package repriced, as after an applied price report.
  const REPRICED = { ...CATALOG, packages: CATALOG.packages.map((p) => ({ ...p, price: p.price * 2 })) };
  const bacon = () => menu({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }] });

  it('Scout_CanSaveActuals_OnTheirOwnMenu', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    expect((await saveActualsWith(admin, CHARLIE, id, EGGS, CATALOG)).status).toBe('saved');
    expect((await loadMenuWith(admin, id))!.menu.actuals).toEqual(EGGS);
  });

  it('Scout_CannotSaveActuals_OnAnotherScoutsMenu', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    expect((await saveActualsWith(admin, CHARLIE, id, EGGS, CATALOG)).status).toBe('not_found');
    expect((await loadMenuWith(admin, id))!.menu.actuals).toEqual({});
  });

  it('ActualsSave_DoesNotBumpUpdatedAt_SoAnOpenPlanTabHasNoFalseConflict', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const before = (await loadMenuWith(admin, id))!.updatedAt;
    await saveActualsWith(admin, CHARLIE, id, EGGS, CATALOG);
    expect((await loadMenuWith(admin, id))!.updatedAt).toBe(before);
    const again = await saveMenuWith(admin, CHARLIE, id, menu({ name: `${MARKER} renamed` }), before, CATALOG);
    expect(again.status).toBe('saved');
  });

  it('ActualsSave_WritesOnlyActuals_LeavingTheMealsAndChoicesAlone', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu({ headcount: 12 }), CATALOG);
    await saveActualsWith(admin, CHARLIE, id, EGGS, CATALOG);
    const after = (await loadMenuWith(admin, id))!.menu;
    expect({ headcount: after.headcount, meals: after.meals.length }).toEqual({ headcount: 12, meals: 1 });
  });

  it('ActualsSave_ReSnapshots_WhenAPriceWasApplied', async () => {
    const id = await createMenuWith(admin, CHARLIE, bacon(), CATALOG);
    const before = (await loadMenuWith(admin, id))!.snapshot!.totals.spent;
    await saveActualsWith(admin, CHARLIE, id, EGGS, REPRICED, { resnapshot: true });
    const after = (await loadMenuWith(admin, id))!.snapshot!.totals.spent;
    expect([before, after]).toEqual([buildSnapshot(bacon(), CATALOG).totals.spent, buildSnapshot(bacon(), REPRICED).totals.spent]);
    expect(after).not.toBe(before);
  });

  it('ActualsSave_KeepsTheSnapshot_WhenNoPriceWasApplied', async () => {
    const id = await createMenuWith(admin, CHARLIE, bacon(), CATALOG);
    const before = (await loadMenuWith(admin, id))!.snapshot;
    await saveActualsWith(admin, CHARLIE, id, EGGS, REPRICED);
    expect((await loadMenuWith(admin, id))!.snapshot).toEqual(before);
  });

  it('ActualsSave_CanClearEveryLine_WithAnEmptyObject', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await saveActualsWith(admin, CHARLIE, id, EGGS, CATALOG);
    await saveActualsWith(admin, CHARLIE, id, {}, CATALOG);
    expect((await loadMenuWith(admin, id))!.menu.actuals).toEqual({});
  });
});

describe('menu store leader reads (read-only view)', () => {
  it('Leader_ListsEveryScoutsMenus_WithTheirOwner', async () => {
    const mine = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} a` }), CATALOG);
    const theirs = await createMenuWith(admin, other, menu({ name: `${MARKER} b` }), CATALOG);
    const all = (await listAllMenusWith(admin)).filter((m) => m.name.startsWith(MARKER));
    expect(all.map((m) => [m.id, m.ownerPersonId]).sort()).toEqual(
      [
        [mine, CHARLIE.personId],
        [theirs, other.personId]
      ].sort()
    );
  });

  it('Leader_ListsNewestEditedFirst', async () => {
    const first = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} old` }), CATALOG);
    const second = await createMenuWith(admin, other, menu({ name: `${MARKER} new` }), CATALOG);
    await admin.from('mm_menus').update({ updated_at: '2026-01-01T00:00:00Z' }).eq('id', first);
    await admin.from('mm_menus').update({ updated_at: '2026-02-01T00:00:00Z' }).eq('id', second);
    const ids = (await listAllMenusWith(admin)).filter((m) => m.name.startsWith(MARKER)).map((m) => m.id);
    expect(ids).toEqual([second, first]);
  });

  it('CreditName_IsFirstNameAndLastInitial_FromThePeopleRow', async () => {
    const { data } = await admin.from('people').select('first_name, last_name').eq('id', CHARLIE.personId).single();
    const names = await ownerCreditNamesWith(admin, [CHARLIE.personId]);
    expect(names.get(CHARLIE.personId)).toBe(publicScoutName(data as { first_name: string; last_name: string }));
  });

  it('CreditName_ReadsNothing_WhenNoIdsAreGiven', async () => {
    expect((await ownerCreditNamesWith(admin, [])).size).toBe(0);
  });
});

describe('menu store patrol + outing menus (release 5)', () => {
  const outing = async (title: string): Promise<number> => {
    const { data, error } = await admin
      .from('calendar_entries')
      .insert({ entry_date: '2026-09-10', end_date: '2026-09-12', category: 'Campout / Overnight', title: `${MARKER} ${title}`, status: 'published', on_calendar: true })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id as number;
  };

  it('Patrol_RoundTrips', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu({ patrol: 'Screaming Eagles' }), CATALOG);
    expect((await loadMenuWith(admin, id))?.menu.patrol).toBe('Screaming Eagles');
  });

  it('Patrol_IsAbsent_WhenNeverSaid', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    expect('patrol' in (await loadMenuWith(admin, id))!.menu).toBe(false);
  });

  it('OutingMenus_AreEveryOwnersMenus_ForThatOutingOnly', async () => {
    const [here, elsewhere] = [await outing('here'), await outing('elsewhere')];
    const a = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: here, patrol: 'A' }), CATALOG);
    const b = await createMenuWith(admin, other, menu({ calendarEntryId: here, patrol: 'B' }), CATALOG);
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: elsewhere }), CATALOG);
    await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    expect((await listOutingMenusWith(admin, here)).map((m) => m.id).sort()).toEqual([a, b].sort());
  });
});
