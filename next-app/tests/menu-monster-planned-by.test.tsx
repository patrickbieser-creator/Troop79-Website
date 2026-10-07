import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Outing } from '../src/lib/menu-monster/menu-view';
import { localMenuStore } from '../src/lib/menu-monster/local-menu-store';

/**
 * Planned by (Plans/Menu-Monster-Planned-By.md): the scouts who planned a menu, picked from a pull-down of the
 * active roster on Who's eating, shown as chips, saved with the menu's one dirty-gated Save.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: vi.fn(),
  saveMenuAction: vi.fn()
}));

import { PeopleTab } from '../src/app/(public)/library/menu-monster/menus/_components/people-tab';
import { ScoutOptionsScope } from '../src/app/(public)/library/menu-monster/menus/_components/scout-options';

const OUTINGS: Outing[] = [];
const SCOUTS = [
  { personId: 41, name: 'Anjali Rao' },
  { personId: 39, name: 'Charlie Walters' },
  { personId: 25, name: 'Jack Porter' }
];
const base = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }],
  plannedBy: [],
  ...over
});
const VERSION = '2026-10-02T12:00:00.000Z';
const CFG = { people: '/p/people', plan: '/p', gear: '/p/gear', shopping: '/p/shopping' };
const tab = (menu: Menu, extra: Record<string, unknown> = {}) => (
  <ScoutOptionsScope options={SCOUTS}>
    <PeopleTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} steps={CFG} {...extra} />
  </ScoutOptionsScope>
);
/** The dirty gate: a clean menu offers no Save (it says Next), a changed one does. */
const saveOffered = () => screen.queryByRole('button', { name: /^Save/ }) !== null;

describe('Planned by', () => {
  beforeEach(() => vi.clearAllMocks());

  it('WhosEating_PlannedBy_IsAPullDownOfActiveScouts', () => {
    render(tab(base()));
    const pick = screen.getByRole('combobox', { name: 'Planned by' });
    expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['— pick —', 'Anjali Rao', 'Charlie Walters', 'Jack Porter']);
  });

  it('WhosEating_PickingAScout_AddsAChip_AndDirtiesSave', async () => {
    render(tab(base()));
    expect(saveOffered()).toBe(false);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Planned by' }), '39');
    expect([screen.getByRole('button', { name: 'Remove Charlie Walters' }) != null, saveOffered()]).toEqual([true, true]);
    // A picked scout leaves the list.
    expect(within(screen.getByRole('combobox', { name: 'Planned by' })).queryByRole('option', { name: 'Charlie Walters' })).toBeNull();
  });

  it('WhosEating_RemovingAChip_DirtiesSave', async () => {
    render(tab(base({ plannedBy: [25] })));
    expect(saveOffered()).toBe(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Jack Porter' }));
    expect([screen.queryByRole('button', { name: 'Remove Jack Porter' }), saveOffered()]).toEqual([null, true]);
  });

  it('ReadOnly_ShowsPlannedByAsText', () => {
    render(tab(base({ plannedBy: [41, 39] }), { readOnly: true, planners: [{ personId: 41, name: 'Anjali' }, { personId: 39, name: 'Charlie' }] }));
    expect([screen.getByText('Planned by Anjali, Charlie') != null, screen.queryByRole('combobox', { name: 'Planned by' })]).toEqual([true, null]);
  });

  it('ReadOnly_OmitsPlannedBy_WhenNobodyIsPicked', () => {
    render(tab(base(), { readOnly: true }));
    expect(screen.queryByText(/^Planned by/)).toBeNull();
  });

  it('LocalMenu_HasNoPlannedBy', () => {
    render(tab(base(), { store: localMenuStore(CATALOG) }));
    expect(screen.queryByRole('combobox', { name: 'Planned by' })).toBeNull();
  });
});
