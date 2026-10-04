import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The public Ingredients tab's "Add an ingredient" (Patrick, 2026-10-03): a
 * signed-in person asks, a leader who keeps the price book adds at once and
 * picks the store section, a visitor is pointed at sign-in — and the admin
 * list can reject a request. The mock boundary is the actions modules.
 */
const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const submitIngredientAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/ingredient-actions', () => ({
  submitIngredientAction: (...a: unknown[]) => submitIngredientAction(...a)
}));
const rejectScoutIngredient = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  matchScoutIngredient: vi.fn(),
  keepScoutIngredient: vi.fn(),
  rejectScoutIngredient: (...a: unknown[]) => rejectScoutIngredient(...a)
}));

import { IngredientBrowser } from '../src/app/(public)/library/menu-monster/_components/ingredient-browser';
import { ScoutIngredients } from '../src/app/admin/(workspace)/library/menu-monster/scout-ingredients';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog } from '../src/lib/menu-monster/types';

const CATALOG: Catalog = {
  ingredients: [
    { id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [] },
    { id: 'x-0000beef', name: 'Jerky', unit: UNITS.ozw, section: 'dry', staple: false, avoid: ['veg'], needsMatch: true, waiting: true }
  ],
  packages: [],
  conversions: [],
  recipes: []
};

beforeEach(() => {
  vi.clearAllMocks();
  submitIngredientAction.mockResolvedValue({ ok: true, status: 'review', name: 'Cookies' });
  rejectScoutIngredient.mockResolvedValue({ ok: true });
});

async function fillCookies(user: ReturnType<typeof userEvent.setup>) {
  const form = screen.getByRole('group', { name: 'New ingredient' });
  await user.type(within(form).getByLabelText('Name'), 'Cookies');
  await user.type(within(form).getByLabelText('One is called'), 'cookie');
  await user.type(within(form).getByLabelText('Several are called'), 'cookies');
  await user.type(within(form).getByLabelText('One package holds'), '36');
  await user.type(within(form).getByLabelText('Price'), '4.29');
  return form;
}

describe('Ingredients tab — add an ingredient', () => {
  it('Visitor_IsAskedToSignIn_AndHasNoAddButton', () => {
    render(<IngredientBrowser catalog={CATALOG} adder={null} signInHref="/signin?next=x" />);
    expect(screen.queryByRole('button', { name: 'Add an ingredient' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin?next=x');
  });

  it('Scout_AsksForAnIngredient_AndIsToldALeaderWillCheckIt', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    render(<IngredientBrowser catalog={CATALOG} adder="review" />);
    await user.click(screen.getByRole('button', { name: 'Add an ingredient' }));
    const form = await fillCookies(user);
    // No store section for a request: the leader picks it when keeping it.
    expect(within(form).queryByLabelText('Store section')).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    await waitFor(() => expect(submitIngredientAction).toHaveBeenCalledTimes(1));
    expect(submitIngredientAction.mock.calls[0][0]).toMatchObject({ name: 'Cookies', kind: 'count', one: 'cookie', many: 'cookies', size: 36, price: 4.29 });
    expect((await screen.findByRole('status')).textContent).toMatch(/sent to a leader to check/);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'New ingredient' })).toBeNull();
  });

  it('Leader_AddsStraightToThePriceBook_WithItsStoreSection', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    submitIngredientAction.mockResolvedValue({ ok: true, status: 'live', name: 'Cookies' });
    render(<IngredientBrowser catalog={CATALOG} adder="live" />);
    await user.click(screen.getByRole('button', { name: 'Add an ingredient' }));
    const form = await fillCookies(user);
    await user.selectOptions(within(form).getByLabelText('Store section'), 'bakery');
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    await waitFor(() => expect(submitIngredientAction).toHaveBeenCalledTimes(1));
    expect(submitIngredientAction.mock.calls[0][1]).toBe('bakery');
    expect((await screen.findByRole('status')).textContent).toMatch(/is in the price book/);
  });

  it('Refusal_KeepsTheFormOpen_AndSaysWhy', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    submitIngredientAction.mockResolvedValue({ ok: false, error: 'The troop’s price book already has that.' });
    render(<IngredientBrowser catalog={CATALOG} adder="review" />);
    await user.click(screen.getByRole('button', { name: 'Add an ingredient' }));
    const form = await fillCookies(user);
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(/already has that/);
  });

  it('OwnRequest_IsTaggedWaitingForALeader', () => {
    render(<IngredientBrowser catalog={CATALOG} adder="review" />);
    const row = screen.getByRole('button', { name: /Jerky/ }).closest('li') as HTMLElement;
    expect(within(row).getByText('Waiting for a leader')).toBeTruthy();
  });
});

describe('Admin › New ingredients — a request', () => {
  const ITEM = {
    id: 'x-0000beef', name: 'Jerky', unit: { key: 'ozw', one: 'oz', many: 'oz', kind: 'weight' as const }, avoid: ['veg' as const],
    pkg: { price: 7.5, size: 10, store: null }, addedBy: 'Charlie W.', usedIn: [], requested: true
  };

  it('Leader_SeesItWasAskedFor_AndCanRejectIt', async () => {
    render(<ScoutIngredients items={[ITEM]} book={[]} />);
    expect(screen.getByText('Asked to add it')).toBeTruthy();
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Jerky' }), 'reject');
    await waitFor(() => expect(rejectScoutIngredient).toHaveBeenCalledWith('x-0000beef'));
  });

  it('Leader_CannotReject_ATypedInAShareRevealed', () => {
    render(<ScoutIngredients items={[{ ...ITEM, requested: false, usedIn: ['Bibimbap'] }]} book={[]} />);
    expect(within(screen.getByRole('combobox', { name: 'More for Jerky' })).queryByRole('option', { name: 'Reject' })).toBeNull();
  });
});
