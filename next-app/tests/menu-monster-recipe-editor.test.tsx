import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';

/**
 * Phase 4A scout recipe editor: save-button standard, the name gate, Share
 * (saving first, then the frozen credit), the before-sharing problems, steps,
 * ingredients through author mode, and the retired read-only state. Only the
 * router and the two server actions are faked.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const save = vi.fn();
const share = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/recipe-actions', () => ({
  saveScoutRecipeAction: (...a: unknown[]) => save(...a),
  shareScoutRecipeAction: (...a: unknown[]) => share(...a)
}));

import { RecipeEditor } from '../src/app/(public)/library/menu-monster/recipes/_components/recipe-editor';

const STAMP = '2026-10-02T12:00:00.000Z';
const READY = { name: 'Bacon bowl', mealFit: ['breakfast' as const], foodGroups: [], steps: ['Fry it.'], lines: [{ ingredientId: 'bacon', qtyPerPerson: 3, unitKey: null }], originRecipeId: null };
const BLANK = { name: '', mealFit: [], foodGroups: [], steps: [], lines: [], originRecipeId: null };

const fresh = () => render(<RecipeEditor catalog={CATALOG} id={null} initial={BLANK} status="draft" credit={null} updatedAt={null} />);
const existing = (status: 'draft' | 'published' | 'retired' = 'draft', initial = READY) =>
  render(<RecipeEditor catalog={CATALOG} id="S-0000abcd" initial={initial} status={status} credit={status === 'draft' ? null : 'Charlie W.'} updatedAt={STAMP} />);

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({ ok: true, id: 'S-0000abcd', updatedAt: '2026-10-02T13:00:00.000Z' });
  share.mockResolvedValue({ ok: true, credit: 'Charlie W.' });
});

describe('RecipeEditor saving', () => {
  it('NewRecipe_SaysSaveDraft', () => {
    fresh();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
  });

  it('Save_NeedsAName', async () => {
    fresh();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Give your recipe a name.')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('NewRecipe_MovesToItsOwnUrl_AfterTheFirstSave', async () => {
    const user = userEvent.setup();
    fresh();
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), 'Chili');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(router.replace).toHaveBeenCalledWith('/library/menu-monster/recipes/S-0000abcd');
  });

  it('Save_SendsTheDraftWithoutAPerson', async () => {
    const user = userEvent.setup();
    fresh();
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), 'Chili');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(Object.keys(save.mock.calls[0][0]).sort()).toEqual(['foodGroups', 'id', 'lines', 'mealFit', 'name', 'originRecipeId', 'steps']);
  });

  it('SavedRecipe_SaysSaved_UntilSomethingChanges', () => {
    existing();
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save_PassesTheLoadedVersion', async () => {
    const user = userEvent.setup();
    existing();
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save.mock.calls[0][1]).toBe(STAMP);
  });

  it('Discard_ReturnsToTheSavedRecipe', async () => {
    const user = userEvent.setup();
    existing();
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), ' deluxe');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByRole('textbox', { name: 'Recipe name' }) as HTMLInputElement).value).toBe('Bacon bowl');
  });

  it('MealChip_IsAToggle', async () => {
    const user = userEvent.setup();
    existing();
    const chip = within(screen.getByRole('group', { name: 'Good for' })).getByRole('button', { name: 'Dinner' });
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('RecipeEditor sharing', () => {
  it('Share_ListsWhatIsMissing_BeforeSharing', async () => {
    existing('draft', { ...READY, mealFit: [], lines: [] });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Share with the troop' }));
    expect(screen.getByRole('alert').textContent).toContain('Add at least one ingredient.');
    expect(share).not.toHaveBeenCalled();
  });

  it('Share_SavesFirst_WhenThereAreUnsavedChanges', async () => {
    const user = userEvent.setup();
    existing();
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Share with the troop' }));
    expect([save.mock.calls.length, share.mock.calls[0]?.[0]]).toEqual([1, 'S-0000abcd']);
  });

  it('SharedRecipe_ShowsItsCredit_AndNoShareButton', async () => {
    existing();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Share with the troop' }));
    expect(screen.getByText('Shared · Recipe by Charlie W.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share with the troop' })).toBeNull();
  });

  it('DraftRecipe_SaysOnlyTheScoutSeesIt', () => {
    existing();
    expect(screen.getByText('Draft · only you see it')).toBeTruthy();
  });
});

describe('RecipeEditor steps and ingredients', () => {
  it('AddAStep_AddsAnEmptyStep', async () => {
    existing();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a step' }));
    expect(screen.getByRole('textbox', { name: 'Step 2' })).toBeTruthy();
  });

  it('Step_CanBeRemoved', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: 'More for step 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('textbox', { name: 'Step 1' })).toBeNull();
  });

  it('AddingAnIngredient_MakesTheRecipeDirty', async () => {
    const user = userEvent.setup();
    existing();
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'egg');
    await user.click(screen.getByRole('option', { name: 'Eggs' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('TotalView_ScalesByPeople', () => {
    existing();
    const row = within(screen.getByRole('list', { name: 'Ingredients' })).getByRole('button', { name: 'Bacon' }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('24 slices');
  });
});

describe('RecipeEditor retired', () => {
  it('RetiredRecipe_IsReadOnly', () => {
    existing('retired');
    expect((screen.getByRole('textbox', { name: 'Recipe name' }) as HTMLInputElement).closest('fieldset')?.disabled).toBe(true);
  });

  it('RetiredRecipe_HasNoSave', () => {
    existing('retired');
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull();
  });
});
