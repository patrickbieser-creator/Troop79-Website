import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';

/** The hub's row that offers a scout the unsaved menu on this computer (IA correction, 2026-10-02). */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const createMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a)
}));

import { DraftOffer } from '../src/app/(public)/library/menu-monster/menus/_components/draft-offer';
import { LOCAL_MENU_KEY } from '../src/lib/menu-monster/local-menu';
import { PLAN_STORAGE_KEY } from '../src/lib/menu-monster/legacy-draft';

const LOCAL = { name: 'Fall Camporee', headcount: 10, dayCount: 1, meals: [{ day: 0, slot: 'breakfast', recipeIds: ['B003', 'B014'] }] };
const putLocal = (m: unknown = LOCAL) => window.localStorage.setItem(LOCAL_MENU_KEY, JSON.stringify(m));
const offer = () => render(<DraftOffer catalog={CATALOG} />);
const OFFER_TEXT = /Unsaved menu on this computer/;
const SAVE = { name: 'Save it to My menus' };

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
});
afterEach(() => vi.restoreAllMocks());

describe('DraftOffer', () => {
  it('Scout_SeesTheOffer_WhenAMenuIsOnThisComputer', async () => {
    putLocal();
    offer();
    expect(await screen.findByText(OFFER_TEXT)).toBeTruthy();
    expect(screen.getByText('Fall Camporee')).toBeTruthy();
    expect(screen.getByText(/1 meal\./)).toBeTruthy();
  });

  it('Scout_SeesNothing_WhenNoMenuIsStored', () => {
    const { container } = offer();
    expect(container.innerHTML).toBe('');
  });

  it('Scout_SeesNothing_WhenStorageIsBlocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { container } = offer();
    expect(container.innerHTML).toBe('');
  });

  it('Scout_SeesTheOffer_WhenAnOldPlannerDraftFoldsIn', async () => {
    window.localStorage.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ meal: 'breakfast', headcount: 10, recipeIds: ['B003'], restrictions: {}, budgetPerPerson: 4, date: '2026-10-10' })
    );
    offer();
    expect(await screen.findByText('Breakfast from this computer')).toBeTruthy();
  });

  it('Scout_CreatesAMenuFromTheLocalMenu_WhenSaving', async () => {
    putLocal();
    offer();
    await userEvent.setup().click(await screen.findByRole('button', SAVE));
    await waitFor(() => expect(createMenuAction).toHaveBeenCalledTimes(1));
    const sent = createMenuAction.mock.calls[0][0];
    expect(sent.name).toBe('Fall Camporee');
    expect(sent.meals[0].recipeIds).toEqual(['B003', 'B014']);
  });

  it('Scout_LandsOnTheNewMenu_WhenSaving', async () => {
    putLocal();
    offer();
    await userEvent.setup().click(await screen.findByRole('button', SAVE));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/library/menu-monster/menus/new-id'));
  });

  it('Scout_LosesTheLocalMenu_OnlyAfterTheSaveSucceeds', async () => {
    let finish: (v: unknown) => void = () => {};
    createMenuAction.mockReturnValue(new Promise((r) => (finish = r)));
    putLocal();
    offer();
    await userEvent.setup().click(await screen.findByRole('button', SAVE));
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
    await act(async () => finish({ ok: true, id: 'new-id' }));
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).toBeNull();
  });

  it('Scout_SeesTheError_AndKeepsTheOffer_WhenSavingFails', async () => {
    createMenuAction.mockResolvedValue({ ok: false, error: 'You have 50 menus' });
    putLocal();
    offer();
    await userEvent.setup().click(await screen.findByRole('button', SAVE));
    expect(await screen.findByText(/You have 50 menus/)).toBeTruthy();
    expect(screen.getByRole('button', SAVE)).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('Scout_KeepsTheMenu_WhenTheyChangeTheirMindAboutDiscarding', async () => {
    putLocal();
    offer();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Discard it' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Discard it' })).toBeTruthy();
  });

  it('Scout_LosesTheOffer_WhenAnotherTabClearsTheMenu', async () => {
    putLocal();
    offer();
    await screen.findByText(OFFER_TEXT);
    window.localStorage.removeItem(LOCAL_MENU_KEY);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_MENU_KEY }));
    });
    expect(screen.queryByText(OFFER_TEXT)).toBeNull();
  });
});
