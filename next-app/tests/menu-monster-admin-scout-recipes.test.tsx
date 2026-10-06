import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Admin › Menu Monster › Scout recipes. Phase 4A gave it the shared list with Retire / Restore and the
 * credit edit; 2026-10-05 (Patrick: "show all recipes, date created, owner, last edited, permissions, and
 * any controls available") made it every scout recipe, with Edit, Copy and Rename.
 */

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const setRecipeStatus = vi.fn();
const setScoutRecipeCredit = vi.fn();
const renameScoutRecipe = vi.fn();
const duplicateRecipe = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  setRecipeStatus: (...a: unknown[]) => setRecipeStatus(...a),
  setScoutRecipeCredit: (...a: unknown[]) => setScoutRecipeCredit(...a),
  renameScoutRecipe: (...a: unknown[]) => renameScoutRecipe(...a),
  duplicateRecipe: (...a: unknown[]) => duplicateRecipe(...a)
}));

import { ScoutRecipes } from '../src/app/admin/(workspace)/library/menu-monster/scout-recipes';
import type { ScoutRecipeRow } from '../src/lib/menu-monster/scout-recipes-store';

const row = (over: Partial<ScoutRecipeRow> = {}): ScoutRecipeRow => ({
  id: 'S-0000abcd',
  name: 'Campfire chili',
  status: 'published',
  ownerPersonId: 39,
  owner: 'Charlie W.',
  credit: 'Charlie W.',
  createdAt: '2026-09-28T15:00:00.000Z',
  sharedAt: '2026-10-02T15:00:00.000Z',
  updatedAt: '2026-10-02T15:00:00.000Z',
  editedSinceShared: false,
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  setRecipeStatus.mockResolvedValue({ ok: true });
  setScoutRecipeCredit.mockResolvedValue({ ok: true });
  renameScoutRecipe.mockResolvedValue({ ok: true });
  duplicateRecipe.mockResolvedValue({ ok: true, id: 'campfire-chili-copy' });
});

const pick = async (value: string) => userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Campfire chili' }), value);
const cells = () => within(screen.getByText('Campfire chili').closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);

describe('ScoutRecipes', () => {
  it('TheList_HasAColumnForEachThingALeaderAskedFor', () => {
    render(<ScoutRecipes recipes={[row()]} />);
    expect(within(screen.getByRole('table', { name: 'Scout recipes' })).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Recipe', 'Owner', 'Created', 'Last edited', 'Shared', 'Who can edit', 'Status', 'Actions'
    ]);
  });

  it('ARow_SaysWhoOwnsIt_WhenItWasMadeAndChanged_AndWhoMayEditIt', () => {
    render(<ScoutRecipes recipes={[row()]} />);
    expect(cells().slice(1, 7)).toEqual(['Charlie W.', 'Sep 28, 2026', 'Oct 2, 2026', 'Oct 2, 2026', 'Owner and leaders', 'Live']);
  });

  it('AnUnsharedDraft_IsListed_AsNotShared', () => {
    render(<ScoutRecipes recipes={[row({ status: 'draft', sharedAt: null, credit: null })]} />);
    expect(cells().slice(4, 7)).toEqual(['Not shared', 'Owner and leaders', 'Draft']);
  });

  it('ACreditThatIsNotTheOwner_IsShownUnderTheName', () => {
    render(<ScoutRecipes recipes={[row({ credit: 'Charlie and Jack' })]} />);
    expect(screen.getByText('Recipe by Charlie and Jack')).toBeTruthy();
  });

  it('EditedRecipe_IsFlagged', () => {
    render(<ScoutRecipes recipes={[row({ editedSinceShared: true })]} />);
    expect(screen.getByText('Edited since shared')).toBeTruthy();
  });

  it('Edit_OpensTheLeaderEditor', () => {
    render(<ScoutRecipes recipes={[row()]} />);
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/admin/library/menu-monster/recipes/S-0000abcd');
  });

  it('Copy_MakesATroopDraft_AndOpensIt', async () => {
    render(<ScoutRecipes recipes={[row()]} />);
    await pick('copy');
    expect(duplicateRecipe).toHaveBeenCalledWith('S-0000abcd');
    expect(router.push).toHaveBeenCalledWith('/admin/library/menu-monster/recipes/campfire-chili-copy');
  });

  it('Leader_CanRenameIt_InPlace', async () => {
    const user = userEvent.setup();
    render(<ScoutRecipes recipes={[row()]} />);
    await pick('rename');
    const box = screen.getByRole('textbox', { name: 'New name for Campfire chili' });
    await user.clear(box);
    await user.type(box, 'Dutch-oven chili');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(renameScoutRecipe).toHaveBeenCalledWith('S-0000abcd', 'Dutch-oven chili');
  });

  it('Leader_SeesTheNameMarked_WhenRenamingToNothing', async () => {
    const user = userEvent.setup();
    render(<ScoutRecipes recipes={[row()]} />);
    await pick('rename');
    const box = screen.getByRole('textbox', { name: 'New name for Campfire chili' });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(renameScoutRecipe).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('It needs a name.')).toBeTruthy();
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

  it('RestoringARetiredDraft_MakesItADraftAgain_NotLive', async () => {
    render(<ScoutRecipes recipes={[row({ status: 'retired', sharedAt: null })]} />);
    await pick('restore');
    expect(setRecipeStatus).toHaveBeenCalledWith('S-0000abcd', 'draft');
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

  it('AnUnsharedDraft_HasNoCreditToChange', () => {
    render(<ScoutRecipes recipes={[row({ status: 'draft', sharedAt: null })]} />);
    expect(within(screen.getByRole('combobox', { name: 'More for Campfire chili' })).queryByRole('option', { name: 'Change credit' })).toBeNull();
  });

  it('Search_FindsByOwner', async () => {
    render(<ScoutRecipes recipes={[row(), row({ id: 'S-0000ef01', name: 'Trail mix', owner: 'Jack P.' })]} />);
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search scout recipes' }), 'jack');
    expect([screen.queryByText('Campfire chili'), screen.getByText('Trail mix')].map((x) => x != null)).toEqual([false, true]);
  });

  it('EmptyList_SaysSo', () => {
    render(<ScoutRecipes recipes={[]} />);
    expect(screen.getByText('No scout has written a recipe yet.')).toBeTruthy();
  });
});
