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
const setMenuOwner = vi.fn();
const setMenuPatrol = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  duplicateMenu: (...a: unknown[]) => duplicateMenu(...a),
  renameMenu: (...a: unknown[]) => renameMenu(...a),
  setMenuShared: (...a: unknown[]) => setMenuShared(...a),
  deleteMenu: (...a: unknown[]) => deleteMenu(...a),
  setMenuOwner: (...a: unknown[]) => setMenuOwner(...a),
  setMenuPatrol: (...a: unknown[]) => setMenuPatrol(...a)
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
  patrol: null,
  createdAt: '2026-09-20T15:00:00.000Z',
  updatedAt: '2026-10-03T15:00:00.000Z',
  ownerPersonId: 39,
  owner: 'Charlie W.',
  sharedAt: '2026-10-01T15:00:00.000Z',
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [duplicateMenu, renameMenu, setMenuShared, deleteMenu, setMenuOwner, setMenuPatrol]) fn.mockResolvedValue({ ok: true });
});

const pick = async (value: string) => userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Fall campout' }), value);
const cells = () => within(screen.getByText('Fall campout').closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);

describe('MenusAdmin', () => {
  it('TheList_HasAColumnForEachThingALeaderAskedFor', () => {
    render(<MenusAdmin menus={[row()]} />);
    expect(within(screen.getByRole('table', { name: 'Menus' })).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Menu', 'Owner', 'Patrol', 'For', 'People', 'Meals', 'Created', 'Last edited', 'Shared', 'Who can edit', 'Actions'
    ]);
  });

  it('ARow_SaysWhoseItIs_WhatItIsFor_AndWhoMayEditIt', () => {
    render(<MenusAdmin menus={[row()]} />);
    expect(cells().slice(1, 10)).toEqual(['Charlie W.', '—', 'Fall Campout at Camp Long Lake', '8', '5', 'Sep 20, 2026', 'Oct 3, 2026', 'Oct 1, 2026', 'Owner and leaders']);
  });

  it('AMenuWithNoOuting_SaysItsKind', () => {
    render(<MenusAdmin menus={[row({ outing: null, calendarEntryId: null, context: 'trail', sharedAt: null })]} />);
    expect(cells().slice(3, 4).concat(cells().slice(8, 9))).toEqual(['Trail', 'Not shared']);
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

  it('Leader_SeesTheNameMarked_WhenRenamingToNothing', async () => {
    const user = userEvent.setup();
    render(<MenusAdmin menus={[row()]} />);
    await pick('rename');
    const box = screen.getByRole('textbox', { name: 'New name for Fall campout' });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(renameMenu).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('It needs a name.')).toBeTruthy();
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

  // Patrick, 2026-10-05: the High Cliff menu was entered under the wrong scout, by a patrol.
  it('Leader_CanHandAMenuToSomeoneElse_PickerGreyedUntilChosen', async () => {
    const user = userEvent.setup();
    render(<MenusAdmin menus={[row()]} owners={[{ personId: 39, name: 'Charlie W.', kind: 'scout' }, { personId: 25, name: 'Jack P.', kind: 'scout' }, { personId: 82, name: 'Patrick B.', kind: 'leader' }, { personId: 90, name: 'Anna K.', kind: 'parent' }]} />);
    await pick('owner');
    const sel = screen.getByRole('combobox', { name: 'New owner for Fall campout' });
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['— pick —', 'Charlie W.', 'Jack P.', 'Patrick B.', 'Anna K.']);
    expect(Array.from(sel.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Scouts', 'Leaders', 'Parents']);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(sel, '25');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setMenuOwner).toHaveBeenCalledWith('M-0000abcd', 25);
  });

  it('Leader_CanCreditAPatrol_FromTheList', async () => {
    const user = userEvent.setup();
    render(<MenusAdmin menus={[row()]} patrols={['Screaming Eagles', 'Whole troop']} />);
    await pick('patrol');
    const sel = screen.getByRole('combobox', { name: 'Patrol for Fall campout' });
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['No patrol', 'Screaming Eagles', 'Whole troop']);
    await user.selectOptions(sel, 'Screaming Eagles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setMenuPatrol).toHaveBeenCalledWith('M-0000abcd', 'Screaming Eagles');
  });

  it('APatrolNoLongerOnTheList_StillShowsSelected_Flagged', async () => {
    render(<MenusAdmin menus={[row({ patrol: 'Flaming Arrows' })]} patrols={['Screaming Eagles']} />);
    await pick('patrol');
    const sel = screen.getByRole('combobox', { name: 'Patrol for Fall campout' }) as HTMLSelectElement;
    expect(sel.selectedOptions[0].textContent).toBe('Flaming Arrows (not on the list)');
  });

  it('ARefusedPatrol_IsMarkedOnTheSelect', async () => {
    setMenuPatrol.mockResolvedValue({ ok: false, error: 'Flaming Arrows is not on the patrol list.' });
    const user = userEvent.setup();
    render(<MenusAdmin menus={[row()]} patrols={['Screaming Eagles']} />);
    await pick('patrol');
    const sel = screen.getByRole('combobox', { name: 'Patrol for Fall campout' });
    await user.selectOptions(sel, 'Screaming Eagles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Flaming Arrows is not on the patrol list.')).toBeTruthy();
    expect(sel.getAttribute('aria-invalid')).toBe('true');
  });

  it('AMenuWithAPatrol_ShowsIt', () => {
    render(<MenusAdmin menus={[row({ patrol: 'Screaming Eagles' })]} />);
    expect(cells()[2]).toBe('Screaming Eagles');
  });

  it('EmptyList_SaysSo', () => {
    render(<MenusAdmin menus={[]} />);
    expect(screen.getByText('No one has saved a menu yet.')).toBeTruthy();
  });
});
