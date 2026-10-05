import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Admin › Menu Monster › Menus (Patrick, 2026-10-05: "add a tab to show all menus. same details"): every saved
 * menu with its owner, dates, sharing, who may edit it, and the owner's controls — which a leader has on any
 * menu (D-327).
 */

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const duplicateMenu = vi.fn();
const renameMenu = vi.fn();
const setMenuShared = vi.fn();
const deleteMenu = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  duplicateMenu: (...a: unknown[]) => duplicateMenu(...a),
  renameMenu: (...a: unknown[]) => renameMenu(...a),
  setMenuShared: (...a: unknown[]) => setMenuShared(...a),
  deleteMenu: (...a: unknown[]) => deleteMenu(...a)
}));

import { MenusAdmin, type MenuAdminRow } from '../src/app/admin/(workspace)/library/menu-monster/menus-admin';

const row = (over: Partial<MenuAdminRow> = {}): MenuAdminRow => ({
  id: 'M-0000abcd',
  name: 'Fall campout',
  context: 'camp',
  calendarEntryId: 77,
  outing: 'Fall Campout at Camp Long Lake',
  headcount: 8,
  mealCount: 5,
  createdAt: '2026-09-20T15:00:00.000Z',
  updatedAt: '2026-10-03T15:00:00.000Z',
  ownerPersonId: 39,
  owner: 'Charlie W.',
  sharedAt: '2026-10-01T15:00:00.000Z',
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [duplicateMenu, renameMenu, setMenuShared, deleteMenu]) fn.mockResolvedValue({ ok: true });
});

const pick = async (value: string) => userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Fall campout' }), value);
const cells = () => within(screen.getByText('Fall campout').closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);

describe('MenusAdmin', () => {
  it('TheList_HasAColumnForEachThingALeaderAskedFor', () => {
    render(<MenusAdmin menus={[row()]} />);
    expect(within(screen.getByRole('table', { name: 'Menus' })).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Menu', 'Owner', 'For', 'People', 'Meals', 'Created', 'Last edited', 'Shared', 'Who can edit', 'Actions'
    ]);
  });

  it('ARow_SaysWhoseItIs_WhatItIsFor_AndWhoMayEditIt', () => {
    render(<MenusAdmin menus={[row()]} />);
    expect(cells().slice(1, 9)).toEqual(['Charlie W.', 'Fall Campout at Camp Long Lake', '8', '5', 'Sep 20, 2026', 'Oct 3, 2026', 'Oct 1, 2026', 'Owner and leaders']);
  });

  it('AMenuWithNoOuting_SaysItsKind', () => {
    render(<MenusAdmin menus={[row({ outing: null, calendarEntryId: null, context: 'trail', sharedAt: null })]} />);
    expect(cells().slice(2, 3).concat(cells().slice(7, 8))).toEqual(['Trail', 'Not shared']);
  });

  it('Open_GoesToTheMenuItself', () => {
    render(<MenusAdmin menus={[row()]} />);
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/library/menu-monster/menus/M-0000abcd');
  });

  it('Leader_CanDuplicateIt', async () => {
    render(<MenusAdmin menus={[row()]} />);
    await pick('duplicate');
    expect(duplicateMenu).toHaveBeenCalledWith('M-0000abcd');
  });

  it('Leader_CanRenameIt_InPlace', async () => {
    const user = userEvent.setup();
    render(<MenusAdmin menus={[row()]} />);
    await pick('rename');
    const box = screen.getByRole('textbox', { name: 'New name for Fall campout' });
    await user.clear(box);
    await user.type(box, 'Fall campout, patrol 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(renameMenu).toHaveBeenCalledWith('M-0000abcd', 'Fall campout, patrol 2');
  });

  it('ASharedMenu_OffersStopSharing_AndAnUnsharedOneOffersShare', async () => {
    render(<MenusAdmin menus={[row(), row({ id: 'M-0000ef01', name: 'Day hike', sharedAt: null })]} />);
    await pick('unshare');
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Day hike' }), 'share');
    expect(setMenuShared.mock.calls).toEqual([['M-0000abcd', false], ['M-0000ef01', true]]);
  });

  it('Delete_TakesTwoClicks', async () => {
    render(<MenusAdmin menus={[row()]} />);
    await pick('delete');
    expect(deleteMenu).not.toHaveBeenCalled();
    expect(within(screen.getByRole('combobox', { name: 'More for Fall campout' })).getByRole('option', { name: 'Click again to delete' })).toBeTruthy();
    await pick('delete');
    expect(deleteMenu).toHaveBeenCalledWith('M-0000abcd');
  });

  it('Search_FindsByOuting', async () => {
    render(<MenusAdmin menus={[row(), row({ id: 'M-0000ef01', name: 'Day hike', outing: 'Ice Age Trail hike' })]} />);
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search menus' }), 'ice age');
    expect([screen.queryByText('Fall campout'), screen.getByText('Day hike')].map((x) => x != null)).toEqual([false, true]);
  });

  it('EmptyList_SaysSo', () => {
    render(<MenusAdmin menus={[]} />);
    expect(screen.getByText('No one has saved a menu yet.')).toBeTruthy();
  });
});
