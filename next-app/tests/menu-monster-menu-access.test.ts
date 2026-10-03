import { describe, it, expect } from 'vitest';
import type { Catalog, Recipe } from '../src/lib/menu-monster/types';
import { menuAccess, onShelf, redactMenu, SHELF_DAYS, type AccessViewer } from '../src/lib/menu-monster/menu-access';
import { sanitizeMenu, type Menu } from '../src/lib/menu-monster/menus';

/**
 * Scout Workspace Phase 3 (Plans/Menu-Monster-Scout-Workspace.md, "Phase 3
 * design" › Review outcome 1–2): who may open a menu, and what a non-owner
 * gets. Pure: the pages and the event list call these, so the rules are
 * proven once here.
 */

const OWNER = 39;
const OTHER = 25;

const viewer = (kind: AccessViewer['kind'], personId: number | null = null, familyIds: number[] = []): AccessViewer => ({ kind, personId, familyIds });
const menu = (sharedAt: string | null, entryPublished: boolean | null = null) => ({ ownerPersonId: OWNER, sharedAt, entryPublished });

describe('menuAccess', () => {
  it('Owner_GetsOwnerAccess_WhetherOrNotShared', () => {
    expect(menuAccess(viewer('scout', OWNER), menu(null))).toBe('owner');
  });

  it('Leader_GetsAdminAccess_ToAnUnsharedMenu', () => {
    expect(menuAccess(viewer('leader', 82), menu(null))).toBe('admin');
  });

  it('Parent_GetsParentAccess_ToTheirScoutsUnsharedMenu', () => {
    expect(menuAccess(viewer('parent', 100, [100, OWNER]), menu(null))).toBe('parent');
  });

  it('Parent_GetsNothing_ForAnotherFamilysUnsharedMenu', () => {
    expect(menuAccess(viewer('parent', 100, [100, OTHER]), menu(null))).toBeNull();
  });

  it('OtherScout_GetsNothing_WhenTheMenuIsNotShared', () => {
    expect(menuAccess(viewer('scout', OTHER), menu(null))).toBeNull();
  });

  it('OtherScout_GetsSharedAccess_WhenTheMenuIsShared', () => {
    expect(menuAccess(viewer('scout', OTHER), menu('2026-10-03T12:00:00Z'))).toBe('shared');
  });

  it('Anonymous_GetsSharedAccess_WhenSharedWithNoOuting', () => {
    expect(menuAccess(viewer('anon'), menu('2026-10-03T12:00:00Z', null))).toBe('shared');
  });

  it('Anonymous_GetsNothing_WhenTheOutingIsNotPublished', () => {
    expect(menuAccess(viewer('anon'), menu('2026-10-03T12:00:00Z', false))).toBeNull();
  });

  it('Anonymous_GetsNothing_WhenNotShared', () => {
    expect(menuAccess(viewer('anon'), menu(null))).toBeNull();
  });

  it('ScoutSibling_GetsNothing_FromAFamilyList', () => {
    // A scout identity's scope is only themselves; a family list on a scout viewer is ignored.
    expect(menuAccess(viewer('scout', OTHER, [OTHER, OWNER]), menu(null))).toBeNull();
  });

  it('Leader_GetsAdmin_EvenWhenAlsoTheParent', () => {
    expect(menuAccess(viewer('leader', 100, [100, OWNER]), menu(null))).toBe('admin');
  });
});

describe('onShelf', () => {
  const today = '2026-10-03';
  const shared = '2026-09-01T12:00:00Z';

  it('Shelf_ShowsAMenu_ForAPublishedOutingEndedWithinTheWindow', () => {
    expect(onShelf(shared, { status: 'published', entryDate: '2026-06-10', endDate: '2026-06-12' }, today)).toBe(true);
  });

  it('Shelf_DropsAMenu_WhenItsOutingEndedMoreThan120DaysAgo', () => {
    expect(SHELF_DAYS).toBe(120);
    expect(onShelf(shared, { status: 'published', entryDate: '2026-05-01', endDate: '2026-06-01' }, today)).toBe(false);
  });

  it('Shelf_UsesTheStartDate_WhenAnOutingHasNoEndDate', () => {
    expect(onShelf(shared, { status: 'published', entryDate: '2026-06-05', endDate: null }, today)).toBe(true);
  });

  it('Shelf_HidesAMenu_OnADraftOuting', () => {
    expect(onShelf(shared, { status: 'draft', entryDate: '2026-10-10', endDate: null }, today)).toBe(false);
  });

  it('Shelf_ShowsAMenuWithNoOuting_SharedWithinTheWindow', () => {
    expect(onShelf('2026-06-10T12:00:00Z', null, today)).toBe(true);
  });

  it('Shelf_DropsAMenuWithNoOuting_SharedMoreThan120DaysAgo', () => {
    expect(onShelf('2026-05-01T12:00:00Z', null, today)).toBe(false);
  });

  it('Shelf_NeverShowsAnUnsharedMenu', () => {
    expect(onShelf(null, null, today)).toBe(false);
  });
});

const recipe = (id: string): Recipe =>
  ({
    id, name: id, status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
    lines: [{ ingredientId: 'eggs', qtyPerPerson: 2, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
  }) as Recipe;

const eggs = { id: 'eggs', name: 'Eggs', unit: { key: 'egg', one: 'egg', many: 'eggs', kind: 'count' }, section: 'dairy', staple: false, avoid: [] };
const PUBLIC = { ingredients: [eggs], packages: [{ id: 'p-eggs', ingredientId: 'eggs', label: '12', size: 12, price: 3, yield: 12, store: null }], conversions: [], recipes: [recipe('B001')] } as unknown as Catalog;
// The owner's catalog also carries their unshared draft S-recipe.
const OWNERS = { ...PUBLIC, recipes: [recipe('B001'), recipe('S-0000abcd')] } as unknown as Catalog;

const ownerMenu = (): Menu =>
  sanitizeMenu(
    {
      name: 'Fall Camporee',
      context: 'camp',
      headcount: 8,
      restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
      meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001', 'S-0000abcd'], recipeEdits: {} }],
      actuals: { eggs: { packageId: 'p-eggs', qty: 1, pricePaid: 3.5 } },
      freeItems: [{ id: 'new:0000abcd', name: 'Jam' }]
    },
    OWNERS
  );

describe('redactMenu', () => {
  it('Owner_GetsTheMenuUnchanged', () => {
    const m = ownerMenu();
    expect(redactMenu(m, 'owner', PUBLIC)).toEqual({ menu: m, hiddenRecipes: 0 });
  });

  it('SharedView_HidesOwnersDraftRecipe', () => {
    const { menu: m, hiddenRecipes } = redactMenu(ownerMenu(), 'shared', PUBLIC);
    expect(m.meals[0].recipeIds).toEqual(['B001']);
    expect(hiddenRecipes).toBe(1);
  });

  it('SharedView_HidesActualsAndFreeItems', () => {
    const { menu: m } = redactMenu(ownerMenu(), 'shared', PUBLIC);
    expect(m.actuals).toEqual({});
    expect(m.freeItems).toEqual([]);
  });

  it('ParentView_KeepsActuals_ButStillHidesDrafts', () => {
    const { menu: m, hiddenRecipes } = redactMenu(ownerMenu(), 'parent', PUBLIC);
    expect(m.actuals.eggs?.pricePaid).toBe(3.5);
    expect(hiddenRecipes).toBe(1);
  });

  it('AdminView_HidesDrafts', () => {
    expect(redactMenu(ownerMenu(), 'admin', PUBLIC).hiddenRecipes).toBe(1);
  });
});
