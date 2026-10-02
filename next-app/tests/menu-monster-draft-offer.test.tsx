import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';

/** Scout Workspace slice 6: the one-line offer to save the browser draft to My menus. */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const createMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a)
}));

import { DraftOffer, DRAFT_ANSWERED_KEY } from '../src/app/(public)/library/menu-monster/menus/_components/draft-offer';
import { PLAN_STORAGE_KEY } from '../src/app/(public)/library/_tools/menu-monster/planner';

const DRAFT = { meal: 'breakfast', headcount: 10, recipeIds: ['B003', 'B014'], restrictions: {}, budgetPerPerson: 4, date: '2026-10-10' };
const put = (d: unknown) => window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(d));
const offer = () => render(<DraftOffer catalog={CATALOG} />);
const OFFER_TEXT = /meal planned on this computer/i;

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
});
afterEach(() => vi.restoreAllMocks());

describe('DraftOffer', () => {
  it('Scout_SeesTheOffer_WhenADraftWithRecipesIsOnThisComputer', async () => {
    put(DRAFT);
    offer();
    expect(await screen.findByText(OFFER_TEXT)).toBeTruthy();
    expect(screen.getByText(/Breakfast · /)).toBeTruthy();
  });

  it('Scout_SeesNothing_WhenNoDraftIsStored', () => {
    const { container } = offer();
    expect(container.innerHTML).toBe('');
  });

  it('Scout_SeesNothing_WhenTheDraftHasNoRecipes', () => {
    put({ ...DRAFT, recipeIds: [] });
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

  it('Scout_SeesNothing_WhenTheDraftIsNotJson', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, '{nope');
    const { container } = offer();
    expect(container.innerHTML).toBe('');
  });

  it('Scout_LosesTheLine_WhenSayingNoThanks', async () => {
    put(DRAFT);
    offer();
    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    expect(screen.queryByText(OFFER_TEXT)).toBeNull();
  });

  it('Scout_IsNotOfferedAgain_AfterNoThanks', async () => {
    put(DRAFT);
    const first = offer();
    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    first.unmount();
    const { container } = offer();
    expect(container.innerHTML).toBe('');
  });

  it('Scout_IsOfferedAgain_WhenTheDraftChanged', async () => {
    put(DRAFT);
    const first = offer();
    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    first.unmount();
    put({ ...DRAFT, headcount: 14 });
    offer();
    expect(await screen.findByText(OFFER_TEXT)).toBeTruthy();
  });

  it('Scout_CreatesAMenuFromTheDraft_WhenSaving', async () => {
    put(DRAFT);
    offer();
    await userEvent.click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    expect(createMenuAction).toHaveBeenCalledTimes(1);
    expect(createMenuAction.mock.calls[0][0]).toMatchObject({
      name: 'Breakfast from this computer',
      headcount: 10,
      meals: [{ day: 0, slot: 'breakfast', recipeIds: ['B003', 'B014'] }]
    });
  });

  it('Scout_LandsOnTheNewMenu_WhenSaving', async () => {
    put(DRAFT);
    offer();
    await userEvent.click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/library/menu-monster/menus/new-id'));
  });

  it('Scout_KeepsTheBrowserDraft_WhenSaving', async () => {
    put(DRAFT);
    const before = window.localStorage.getItem(PLAN_STORAGE_KEY);
    offer();
    await userEvent.click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBe(before);
  });

  it('Scout_IsNotOfferedAgain_AfterSaving', async () => {
    put(DRAFT);
    const first = offer();
    await userEvent.click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_ANSWERED_KEY)).not.toBeNull());
    first.unmount();
    const { container } = offer();
    expect(container.innerHTML).toBe('');
  });

  it('Scout_SeesTheError_AndKeepsTheOffer_WhenSavingFails', async () => {
    createMenuAction.mockResolvedValue({ ok: false, error: 'Nope.' });
    put(DRAFT);
    offer();
    await userEvent.click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    expect(await screen.findByText(/Nope\./)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_ANSWERED_KEY)).toBeNull();
  });
});
