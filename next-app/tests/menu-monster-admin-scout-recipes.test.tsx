import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Phase 4A admin › Menu Monster › Scout recipes: the list, Retire / Restore, and the credit edit. */

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const setRecipeStatus = vi.fn();
const setScoutRecipeCredit = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  setRecipeStatus: (...a: unknown[]) => setRecipeStatus(...a),
  setScoutRecipeCredit: (...a: unknown[]) => setScoutRecipeCredit(...a)
}));

import { ScoutRecipes } from '../src/app/admin/(workspace)/library/menu-monster/scout-recipes';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'S-0000abcd',
  name: 'Campfire chili',
  status: 'published' as const,
  credit: 'Charlie W.',
  sharedAt: '2026-10-02T15:00:00.000Z',
  updatedAt: '2026-10-02T15:00:00.000Z',
  editedSinceShared: false,
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  setRecipeStatus.mockResolvedValue({ ok: true });
  setScoutRecipeCredit.mockResolvedValue({ ok: true });
});

const pick = async (value: string) => userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Campfire chili' }), value);

describe('ScoutRecipes', () => {
  it('Leader_SeesTheCredit', () => {
    render(<ScoutRecipes recipes={[row()]} />);
    expect(screen.getByText('Charlie W.')).toBeTruthy();
  });

  it('EditedRecipe_IsFlagged', () => {
    render(<ScoutRecipes recipes={[row({ editedSinceShared: true })]} />);
    expect(screen.getByText('Edited since shared')).toBeTruthy();
  });

  it('Leader_CanRetireScoutRecipe', async () => {
    render(<ScoutRecipes recipes={[row()]} />);
    await pick('retire');
    expect(setRecipeStatus).toHaveBeenCalledWith('S-0000abcd', 'retired');
  });

  it('Leader_CanRestoreARetiredRecipe', async () => {
    render(<ScoutRecipes recipes={[row({ status: 'retired' })]} />);
    await pick('restore');
    expect(setRecipeStatus).toHaveBeenCalledWith('S-0000abcd', 'published');
  });

  it('Leader_CanChangeTheCredit', async () => {
    const user = userEvent.setup();
    render(<ScoutRecipes recipes={[row()]} />);
    await pick('credit');
    const box = screen.getByRole('textbox', { name: 'Credit for Campfire chili' });
    await user.clear(box);
    await user.type(box, 'Charlie and Jack');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setScoutRecipeCredit).toHaveBeenCalledWith('S-0000abcd', 'Charlie and Jack');
  });

  it('EmptyList_SaysSo', () => {
    render(<ScoutRecipes recipes={[]} />);
    expect(screen.getByText('No scout has shared a recipe yet.')).toBeTruthy();
  });
});
