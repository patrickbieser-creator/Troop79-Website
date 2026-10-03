import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { budgetState } from '../src/lib/menu-monster/menu-view';
import { PLAN_STORAGE_KEY } from '../src/lib/menu-monster/legacy-draft';
import {
  LOCAL_MENU_KEY,
  clearLocalMenu,
  onLocalMenuChange,
  readLocalMenu,
  writeLocalMenu
} from '../src/lib/menu-monster/local-menu';
import { localMenuStore } from '../src/lib/menu-monster/local-menu-store';
import { sanitizeMenu } from '../src/lib/menu-monster/menus';

/** The unsaved menu a visitor or leader keeps on this computer (IA correction, 2026-10-02). */

const MENU = sanitizeMenu(
  { name: 'Fall Camporee', headcount: 10, dayCount: 1, meals: [{ day: 0, slot: 'breakfast', recipeIds: ['B003', 'B014'] }] },
  CATALOG
);
const DRAFT = { meal: 'breakfast', headcount: 10, recipeIds: ['B003', 'B014'], restrictions: {}, budgetPerPerson: 4, date: '2026-10-10' };

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('local menu storage', () => {
  it('Visitor_ReadsNothing_WhenNoMenuIsStored', () => {
    expect(readLocalMenu(CATALOG).menu).toBeNull();
  });

  it('Visitor_ReadsTheirMenuBack_AfterWritingIt', () => {
    expect(writeLocalMenu(MENU, CATALOG)).toBe(true);
    expect(readLocalMenu(CATALOG).menu).toMatchObject({ name: 'Fall Camporee', headcount: 10 });
  });

  it('Visitor_GetsASanitizedMenu_WhenTheStoredTextHoldsJunk', () => {
    window.localStorage.setItem(LOCAL_MENU_KEY, JSON.stringify({ name: 'X', headcount: 9999, meals: [{ day: 0, slot: 'nope' }] }));
    const { menu } = readLocalMenu(CATALOG);
    expect(menu?.headcount).toBeLessThanOrEqual(50);
    expect(menu?.meals).toEqual([]);
  });

  it('Visitor_WritesOnlySanitizedData_WhenTheMenuCarriesJunk', () => {
    writeLocalMenu({ ...MENU, headcount: 9999, extra: 'x' } as never, CATALOG);
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_MENU_KEY) ?? 'null');
    expect(stored.headcount).toBeLessThanOrEqual(50);
    expect(stored.extra).toBeUndefined();
  });

  it('Visitor_ReadsNothing_WhenTheStoredTextIsNotJson', () => {
    window.localStorage.setItem(LOCAL_MENU_KEY, '{nope');
    expect(readLocalMenu(CATALOG).menu).toBeNull();
  });

  it('Visitor_IsTold_WhenACatalogChangeDroppedARecipe', () => {
    const raw = { ...MENU, meals: [{ ...MENU.meals[0], recipeIds: ['B003', 'GONE'] }] };
    window.localStorage.setItem(LOCAL_MENU_KEY, JSON.stringify(raw));
    const read = readLocalMenu(CATALOG);
    expect(read.dropped).toBe(1);
    expect(read.menu?.meals[0].recipeIds).toEqual(['B003']);
  });

  it('Visitor_IsNotTold_WhenNothingWasDropped', () => {
    writeLocalMenu(MENU, CATALOG);
    expect(readLocalMenu(CATALOG).dropped).toBe(0);
  });

  it('Visitor_CanKeepWorking_WhenStorageIsBlocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLocalMenu(CATALOG).menu).toBeNull();
    expect(writeLocalMenu(MENU, CATALOG)).toBe(false);
  });

  it('Visitor_ReadsNothing_AfterTheMenuIsCleared', () => {
    writeLocalMenu(MENU, CATALOG);
    clearLocalMenu();
    expect(readLocalMenu(CATALOG).menu).toBeNull();
  });
});

describe('local menu sync between tabs', () => {
  it('Visitor_IsNotified_WhenAnotherTabChangesTheMenu', () => {
    const seen = vi.fn();
    const off = onLocalMenuChange(seen);
    window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_MENU_KEY }));
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('Visitor_IsNotNotified_WhenAnUnrelatedKeyChanges', () => {
    const seen = vi.fn();
    const off = onLocalMenuChange(seen);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('Visitor_IsNotNotified_AfterUnsubscribing', () => {
    const seen = vi.fn();
    onLocalMenuChange(seen)();
    window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_MENU_KEY }));
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('legacy planner draft fold-in', () => {
  it('Visitor_KeepsTheirOldDraft_AsTheLocalMenu', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(DRAFT));
    const { menu } = readLocalMenu(CATALOG);
    expect(menu?.meals[0].recipeIds).toEqual(['B003', 'B014']);
    expect(menu?.headcount).toBe(10);
  });

  it('Visitor_LosesTheOldKey_OnceItIsFolded', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(DRAFT));
    readLocalMenu(CATALOG);
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
  });

  it('Visitor_KeepsTheirEdits_WhenTheOldDraftReturns', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(DRAFT));
    readLocalMenu(CATALOG);
    writeLocalMenu({ ...readLocalMenu(CATALOG).menu!, name: 'Renamed' }, CATALOG);
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(DRAFT));
    expect(readLocalMenu(CATALOG).menu?.name).toBe('Renamed');
  });

  it('Visitor_GetsNoMenu_WhenTheOldDraftHasNoRecipes', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ ...DRAFT, recipeIds: [] }));
    expect(readLocalMenu(CATALOG).menu).toBeNull();
  });
});

describe('localMenuStore', () => {
  it('Visitor_SavesAndReloads_ThroughTheStore', async () => {
    const store = localMenuStore(CATALOG);
    expect(await store.create(MENU)).toMatchObject({ ok: true });
    expect(store.load()?.menu.name).toBe('Fall Camporee');
    expect(await store.save({ ...MENU, name: 'Renamed' }, null)).toMatchObject({ ok: true, updatedAt: null });
    expect(store.load()?.menu.name).toBe('Renamed');
  });

  it('Visitor_IsToldWhySaveFailed_WhenStorageIsBlocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const res = await localMenuStore(CATALOG).save(MENU, null);
    expect(res).toMatchObject({ ok: false });
  });

  it('Visitor_HasNoPaidOrReportCapability_OnALocalMenu', () => {
    expect(localMenuStore(CATALOG).caps).toEqual({ canSave: false, canPay: false, canReport: false });
  });
});

describe('budgetState', () => {
  it('Scout_IsUnderBudget_WhenSpendIsBelowTheTarget', () => {
    expect(budgetState({ perSpent: 3 }, 4).tone).toBe('ok');
  });

  it('Scout_IsOver_WhenSpendIsFarAboveTheTarget', () => {
    expect(budgetState({ perSpent: 6 }, 4).tone).toBe('over');
  });
});
