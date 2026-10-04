import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Brand } from '../src/lib/menu-monster/types';
import { createMenuWith } from '../src/lib/menu-monster/menus-store';
import { setBoughtLineWith, setShoppingDoneWith, loadBoughtManyWith } from '../src/lib/menu-monster/bought-store';
import { listPurchasesWith, menuPurchase, unfinishedPurchases, type PurchaseOuting } from '../src/lib/menu-monster/purchases';
import { recentTypedBrands } from '../src/lib/menu-monster/brands-store';

/**
 * Release 6 — the leader tools' Purchases and "Needs attention": each outing's menus with what they planned
 * and what was paid (the same numbers as the menu's own "What we bought"), the past outings nobody finished
 * recording, and the brands people typed in lately.
 */

const MARKER = 'vitest-mm-purchases';
const admin = adminClient();
const CHARLIE = { personId: 39, label: 'Charlie W.' };
const WHO = { personId: 39, name: 'Charlie W.' };

const menu = (over: Partial<Menu> = {}): Menu => ({
  name: MARKER,
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 10,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 1,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }],
  ...over
});

afterEach(async () => {
  await admin.from('mm_menus').delete().like('name', `%${MARKER}%`);
  await admin.from('audit_log').delete().eq('area', 'menus').like('summary', `%${MARKER}%`);
  await admin.from('calendar_entries').delete().like('title', `${MARKER}%`);
});

async function outing(title: string, dates: [string, string] = ['2026-09-10', '2026-09-12']): Promise<number> {
  const { data, error } = await admin
    .from('calendar_entries')
    .insert({ entry_date: dates[0], end_date: dates[1], category: 'Campout / Overnight', title: `${MARKER} ${title}`, status: 'published', on_calendar: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

const mine = (list: PurchaseOuting[]) => list.filter((o) => o.title.startsWith(MARKER));

describe('menuPurchase', () => {
  it('NothingRecorded_PaidIsThePlan_AndProjected', () => {
    const p = menuPurchase(menu(), '2026-10-01T00:00:00Z', { lines: {}, done: null }, CATALOG);
    expect([p.totals.paid, p.totals.projected, p.totals.unconfirmed]).toEqual([p.totals.planned, true, 1]);
  });

  it('ARecordedLine_ChangesWhatWasPaid', () => {
    const line = { status: 'bought' as const, items: [{ brandId: null, packageId: 'p-bac-om', qty: 2, pricePaid: 5 }], by: 'Charlie W.', personId: 39, at: '2026-10-02T00:00:00Z' };
    const p = menuPurchase(menu(), '2026-10-01T00:00:00Z', { lines: { bacon: line }, done: null }, CATALOG);
    expect([p.totals.paid, p.totals.projected, p.recordedBy]).toEqual([10, false, ['Charlie W.']]);
  });

  it('Done_IsNoLongerProjected', () => {
    const done = { by: 'Charlie W.', personId: 39, at: '2026-10-02T00:00:00Z' };
    expect(menuPurchase(menu(), '2026-10-01T00:00:00Z', { lines: {}, done }, CATALOG).totals.projected).toBe(false);
  });
});

describe('unfinishedPurchases', () => {
  const o = (over: Partial<PurchaseOuting>): PurchaseOuting => ({ id: 1, title: 'x', startDate: '2026-09-10', endDate: '2026-09-12', menus: [], planned: 0, paid: 0, projected: true, ...over });

  it('APastOuting_StillProjected_IsUnfinished', () => {
    expect(unfinishedPurchases([o({})], '2026-10-04')).toHaveLength(1);
  });

  it('AnOutingStillAhead_OrOnToday_IsNot', () => {
    expect(unfinishedPurchases([o({ startDate: '2026-10-09', endDate: '2026-10-11' }), o({ endDate: '2026-10-04' })], '2026-10-04')).toHaveLength(0);
  });

  it('AFinishedOuting_IsNot', () => {
    expect(unfinishedPurchases([o({ projected: false })], '2026-10-04')).toHaveLength(0);
  });

  it('ADayOuting_UsesItsStartDate', () => {
    expect(unfinishedPurchases([o({ endDate: null })], '2026-10-04')).toHaveLength(1);
  });
});

describe('recentTypedBrands', () => {
  const b = (over: Partial<Brand>): Brand => ({ id: 'b1', ingredientId: 'bacon', name: 'Rice Chex', avoid: null, addedBy: 39, createdAt: '2026-10-01T12:00:00Z', retiredAt: null, ...over });

  it('ATypedBrand_InsideTheWindow_IsListed', () => {
    expect(recentTypedBrands([b({})], '2026-10-04', 30).map((x) => x.id)).toEqual(['b1']);
  });

  it('OlderOnes_RetiredOnes_AndTheTroopsOwn_AreNot', () => {
    const list = [b({ id: 'old', createdAt: '2026-08-01T00:00:00Z' }), b({ id: 'gone', retiredAt: '2026-10-02T00:00:00Z' }), b({ id: 'book', addedBy: null })];
    expect(recentTypedBrands(list, '2026-10-04', 30)).toEqual([]);
  });

  it('Newest_ComesFirst', () => {
    const list = [b({ id: 'a', createdAt: '2026-09-20T00:00:00Z' }), b({ id: 'z', createdAt: '2026-10-03T00:00:00Z' })];
    expect(recentTypedBrands(list, '2026-10-04', 30).map((x) => x.id)).toEqual(['z', 'a']);
  });
});

describe('purchases against the database', () => {
  it('AnOuting_ListsItsMenus_WithPatrolAndPlanner', async () => {
    const e = await outing('trip');
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: e, patrol: 'Screaming Eagles' }), CATALOG);
    const [o] = mine(await listPurchasesWith(admin, CATALOG));
    expect([o.id, o.menus.map((m) => [m.label, m.planner])]).toEqual([e, [['Screaming Eagles', 'Charlie W.']]]);
  });

  it('AMenuWithNoOuting_OrNoFood_IsLeftOut', async () => {
    const e = await outing('empty');
    await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: e, meals: [] }), CATALOG);
    expect(mine(await listPurchasesWith(admin, CATALOG))).toEqual([]);
  });

  it('OutingTotals_AddItsMenus', async () => {
    const e = await outing('two');
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: e, patrol: 'A' }), CATALOG);
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: e, patrol: 'B', headcount: 6 }), CATALOG);
    const [o] = mine(await listPurchasesWith(admin, CATALOG));
    expect(o.planned).toBeCloseTo(o.menus[0].totals.planned + o.menus[1].totals.planned, 2);
  });

  it('ARecordedPrice_AndTheDoneTick_ShowOnTheOuting', async () => {
    const e = await outing('recorded');
    const id = await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: e }), CATALOG);
    await setBoughtLineWith(admin, id, 'bacon', { status: 'bought', items: [{ brandId: null, packageId: 'p-bac-om', qty: 2, pricePaid: 5 }] }, WHO);
    await setShoppingDoneWith(admin, id, true, WHO);
    const [o] = mine(await listPurchasesWith(admin, CATALOG));
    expect([o.paid, o.projected, o.menus[0].done?.by, o.menus[0].recordedBy]).toEqual([10, false, 'Charlie W.', ['Charlie W.']]);
  });

  it('LatestOuting_ComesFirst', async () => {
    const early = await outing('early', ['2026-05-01', '2026-05-03']);
    const late = await outing('late', ['2026-11-06', '2026-11-08']);
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: early }), CATALOG);
    await createMenuWith(admin, CHARLIE, menu({ calendarEntryId: late }), CATALOG);
    expect(mine(await listPurchasesWith(admin, CATALOG)).map((o) => o.id)).toEqual([late, early]);
  });

  it('BoughtForManyMenus_ComesBackByMenu', async () => {
    const a = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    const b = await createMenuWith(admin, CHARLIE, menu(), CATALOG);
    await setBoughtLineWith(admin, a, 'bacon', { status: 'not_bought' }, WHO);
    const got = await loadBoughtManyWith(admin, [a, b]);
    expect([got.get(a)?.lines.bacon?.status, Object.keys(got.get(b)?.lines ?? {})]).toEqual(['not_bought', []]);
  });
});
