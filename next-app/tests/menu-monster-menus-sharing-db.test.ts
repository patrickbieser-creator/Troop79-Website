import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Catalog } from '../src/lib/menu-monster/types';
import {
  MENU_LIMIT,
  copyMenuWith,
  createMenuWith,
  hideMenuWith,
  listAllMenusWith,
  listMenusWith,
  listSharedMenusWith,
  loadMenuWith,
  loadMenusWith,
  ownerCreditNamesWith,
  saveActualsWith,
  setMenuSharedWith,
  setReviewNoteWith
} from '../src/lib/menu-monster/menus-store';

/**
 * Scout Workspace Phase 3 (Plans/Menu-Monster-Scout-Workspace.md, "Phase 3
 * design"): sharing, the shelf and event lists, copy, the review note and
 * the leader's take-down, against local Postgres. Owner-scoped writes take
 * the actor from the verified session, so a scout can only share their own.
 *
 * Menus belong to the test scout (Charlie Walters, person 39) and one other
 * person; everything named with MARKER is removed after each test.
 */

const MARKER = 'vitest-mm-share';
const admin = adminClient();
const CHARLIE = { personId: 39, label: 'Charlie W.' };
const LEADER = { personId: 82, label: 'Leader L.' };
const TODAY = '2026-10-03';
let other: { personId: number; label: string };

const menu = (overrides: Partial<Menu> = {}): Menu => ({
  name: MARKER,
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  freeItems: [],
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'], recipeEdits: {} }],
  ...overrides
});

beforeAll(async () => {
  const { data } = await admin.from('people').select('id').not('id', 'in', '(39,82)').order('id').limit(1).single();
  other = { personId: data!.id as number, label: 'Other P.' };
});

afterEach(async () => {
  await admin.from('mm_menus').delete().like('name', `%${MARKER}%`);
  await admin.from('audit_log').delete().eq('area', 'menus').like('summary', `%${MARKER}%`);
  await admin.from('calendar_entries').delete().like('title', `${MARKER}%`);
});

async function entry(title: string, over: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await admin
    .from('calendar_entries')
    .insert({ entry_date: '2026-09-10', end_date: '2026-09-12', category: 'Campout / Overnight', title: `${MARKER} ${title}`, status: 'published', on_calendar: true, ...over })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

async function auditSummaries(): Promise<string[]> {
  const { data } = await admin.from('audit_log').select('summary').eq('area', 'menus').like('summary', `%${MARKER}%`).order('id');
  return (data ?? []).map((r) => r.summary as string);
}

const sharedNames = async (opts: { outingId?: number } = {}) =>
  (await listSharedMenusWith(admin, TODAY, opts)).filter((m) => m.name.includes(MARKER)).map((m) => m.name);

describe('share / stop sharing', () => {
  it('Scout_CanShareOwnMenu', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    expect(await setMenuSharedWith(admin, CHARLIE, id, true)).toBe(true);
    expect((await loadMenuWith(admin, id))!.sharedAt).not.toBeNull();
    expect(await auditSummaries()).toContain(`Charlie W. shared menu "${MARKER}" with the troop`);
  });

  it('Scout_CannotShareAnotherScoutsMenu', async () => {
    const id = await createMenuWith(admin, other, menu(), CATALOG);
    expect(await setMenuSharedWith(admin, CHARLIE, id, true)).toBe(false);
    expect((await loadMenuWith(admin, id))!.sharedAt).toBeNull();
  });

  it('Share_DoesNotBumpUpdatedAt', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const before = (await loadMenuWith(admin, id))!.updatedAt;
    await setMenuSharedWith(admin, CHARLIE, id, true);
    expect((await loadMenuWith(admin, id))!.updatedAt).toBe(before);
  });

  it('Scout_CanStopSharing', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    await setMenuSharedWith(admin, CHARLIE, id, false);
    expect((await loadMenuWith(admin, id))!.sharedAt).toBeNull();
    expect(await auditSummaries()).toContain(`Charlie W. stopped sharing menu "${MARKER}"`);
  });

  it('Load_ReportsTheOutingUnpublished_WhenItsEntryIsADraft', async () => {
    const draft = await entry('draft', { status: 'draft' });
    const id = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: draft }), CATALOG);
    expect((await loadMenuWith(admin, id))!.entryPublished).toBe(false);
  });
});

describe('leader take-down + review note', () => {
  it('Leader_CanHideASharedMenuFromTheShelf', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    expect(await hideMenuWith(admin, LEADER, id)).toBe(true);
    expect((await loadMenuWith(admin, id))!.sharedAt).toBeNull();
    expect(await auditSummaries()).toContain(`Leader L. hid menu "${MARKER}" by Charlie W. from the shelf`);
  });

  it('Leader_CanSetReviewNote_ReplacingTheLastOne', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await setReviewNoteWith(admin, LEADER, id, 'Bring more water.');
    expect(await setReviewNoteWith(admin, LEADER, id, '  Looks good!  ')).toBe(true);
    const stored = (await loadMenuWith(admin, id))!;
    expect(stored.review).toMatchObject({ note: 'Looks good!', byPersonId: LEADER.personId });
  });

  it('ReviewNote_DoesNotBumpUpdatedAt', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const before = (await loadMenuWith(admin, id))!.updatedAt;
    await setReviewNoteWith(admin, LEADER, id, 'Nice.');
    expect((await loadMenuWith(admin, id))!.updatedAt).toBe(before);
  });

  it('ReviewNote_IsCleared_ByABlankNote', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await setReviewNoteWith(admin, LEADER, id, 'Nice.');
    await setReviewNoteWith(admin, LEADER, id, '   ');
    expect((await loadMenuWith(admin, id))!.review).toBeNull();
  });
});

describe('shelf + event lists', () => {
  it('Shelf_ListsSharedMenus_NewestFirst_WithCredit', async () => {
    const a = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} A` }), CATALOG);
    const b = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} B` }), CATALOG);
    await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} unshared` }), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, a, true);
    await setMenuSharedWith(admin, CHARLIE, b, true);
    expect(await sharedNames()).toEqual([`${MARKER} B`, `${MARKER} A`]);
  });

  it('Shelf_HidesAMenu_OnADraftOuting', async () => {
    const draft = await entry('draft', { status: 'draft' });
    const id = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: draft }), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    expect(await sharedNames()).toEqual([]);
  });

  it('Shelf_DropsAMenu_WhoseOutingEndedMoreThan120DaysAgo', async () => {
    const old = await entry('old', { entry_date: '2026-04-01', end_date: '2026-04-03' });
    const id = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: old }), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    expect(await sharedNames()).toEqual([]);
  });

  it('OutingList_ListsEveryMenuSharedForThatEntry_WithNoTimeLimit', async () => {
    const old = await entry('old', { entry_date: '2026-04-01', end_date: '2026-04-03' });
    const id = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: old }), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    expect(await sharedNames({ outingId: old })).toEqual([MARKER]);
  });

  it('OutingList_IsEmpty_ForADraftEntry', async () => {
    const draft = await entry('draft', { status: 'draft' });
    const id = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: draft }), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    expect(await sharedNames({ outingId: draft })).toEqual([]);
  });

  it('SharedRow_CarriesTheOwnersCreditName', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, id, true);
    const row = (await listSharedMenusWith(admin, TODAY)).find((m) => m.id === id);
    expect(row?.credit).toMatch(/^Charlie W\.$/);
  });
});

describe('copy a shared menu', () => {
  it('Scout_CanCopySharedMenu_AsNewUnsharedMenu', async () => {
    const src = await createMenuWith(admin, other, menu({ headcount: 12 }), CATALOG);
    await setMenuSharedWith(admin, other, src, true);
    const res = await copyMenuWith(admin, CHARLIE, src, CATALOG);
    if (res === null || res === MENU_LIMIT) throw new Error(`copy failed: ${String(res)}`);
    const copy = (await loadMenuWith(admin, res.id))!;
    expect(copy.ownerPersonId).toBe(CHARLIE.personId);
    expect(copy.menu).toMatchObject({ name: `Copy of ${MARKER}`, headcount: 12 });
    expect(copy.menu.meals[0].recipeIds).toEqual(['B001']);
    expect(copy.sharedAt).toBeNull();
    const credit = (await ownerCreditNamesWith(admin, [other.personId])).get(other.personId);
    expect(await auditSummaries()).toContain(`Charlie W. copied menu "${MARKER}" from ${credit}`);
  });

  it('Copy_DropsActualsAndReviewNote', async () => {
    const src = await createMenuWith(admin, other, menu(), CATALOG);
    await saveActualsWith(admin, other, src, { eggs: { packageId: 'p-egg-store', qty: 1, pricePaid: 4 } }, CATALOG);
    await setReviewNoteWith(admin, LEADER, src, 'Nice.');
    await setMenuSharedWith(admin, other, src, true);
    const res = await copyMenuWith(admin, CHARLIE, src, CATALOG);
    if (res === null || res === MENU_LIMIT) throw new Error('copy failed');
    const copy = (await loadMenuWith(admin, res.id))!;
    expect(copy.menu.actuals).toEqual({});
    expect(copy.review).toBeNull();
  });

  it('Copy_CountsRecipesTheCopierCannotSee', async () => {
    const src = await createMenuWith(admin, other, menu(), CATALOG);
    await setMenuSharedWith(admin, other, src, true);
    const withoutB001 = { ...CATALOG, recipes: CATALOG.recipes.filter((r) => r.id !== 'B001') } as Catalog;
    const res = await copyMenuWith(admin, CHARLIE, src, withoutB001);
    if (res === null || res === MENU_LIMIT) throw new Error('copy failed');
    expect(res.droppedRecipes).toBe(1);
  });

  it('Scout_CannotCopyUnsharedMenu', async () => {
    const src = await createMenuWith(admin, other, menu(), CATALOG);
    expect(await copyMenuWith(admin, CHARLIE, src, CATALOG)).toBeNull();
  });

  it('Scout_CannotCopyAMenuSharedOnADraftOuting', async () => {
    const draft = await entry('draft', { status: 'draft' });
    const src = await createMenuWith(admin, other, menu({ calendarEntryId: draft }), CATALOG);
    await setMenuSharedWith(admin, other, src, true);
    expect(await copyMenuWith(admin, CHARLIE, src, CATALOG)).toBeNull();
  });
});

describe('leader + parent lists', () => {
  it('Parent_ListsTheirScoutsMenus_ByOwnerIds', async () => {
    await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} mine` }), CATALOG);
    await createMenuWith(admin, other, menu({ name: `${MARKER} theirs` }), CATALOG);
    const rows = (await listMenusWith(admin, [CHARLIE.personId])).filter((m) => m.name.includes(MARKER));
    expect(rows.map((m) => m.name)).toEqual([`${MARKER} mine`]);
    expect(rows[0].ownerPersonId).toBe(CHARLIE.personId);
  });

  it('LeaderList_FiltersByScout', async () => {
    await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} mine` }), CATALOG);
    await createMenuWith(admin, other, menu({ name: `${MARKER} theirs` }), CATALOG);
    const rows = (await listAllMenusWith(admin, { scout: other.personId })).filter((m) => m.name.includes(MARKER));
    expect(rows.map((m) => m.name)).toEqual([`${MARKER} theirs`]);
  });

  it('LeaderList_FiltersBySharedAndOuting', async () => {
    const e = await entry('trip');
    const a = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} trip`, calendarEntryId: e }), CATALOG);
    await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} home` }), CATALOG);
    await setMenuSharedWith(admin, CHARLIE, a, true);
    const shared = (await listAllMenusWith(admin, { shared: true })).filter((m) => m.name.includes(MARKER));
    const byOuting = (await listAllMenusWith(admin, { outing: e })).filter((m) => m.name.includes(MARKER));
    expect(shared.map((m) => m.name)).toEqual([`${MARKER} trip`]);
    expect(byOuting.map((m) => m.name)).toEqual([`${MARKER} trip`]);
  });
});

describe('loadMenusWith', () => {
  it('LoadsSeveralMenusInOneCall_InTheOrderAsked_SkippingMissing', async () => {
    const a = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} A` }), CATALOG);
    const b = await createMenuWith(admin, CHARLIE, menu({ name: `${MARKER} B` }), CATALOG);
    const rows = await loadMenusWith(admin, [b, '00000000-0000-4000-8000-000000000000', a]);
    expect(rows.map((r) => r.menu.name)).toEqual([`${MARKER} B`, `${MARKER} A`]);
  });
});

describe('schema', () => {
  it('ReviewNote_IsCappedAt1000Characters', async () => {
    const id = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const { error } = await admin.from('mm_menus').update({ review_note: 'x'.repeat(1001), reviewed_at: new Date().toISOString() }).eq('id', id);
    expect(error?.code).toBe('23514');
  });
});
