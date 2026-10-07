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
const READY = { name: 'Bacon bowl', mealFit: ['breakfast' as const], foodGroups: [] as ('grain' | 'dairy')[], steps: ['Fry it.'], lines: [{ ingredientId: 'bacon', qtyPerPerson: 3, unitKey: null }], originRecipeId: null, equipment: [] as string[] };
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

  it('Scout_SeesTheNameMarked_WhenSavingWithoutOne', async () => {
    const user = userEvent.setup();
    fresh();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const name = screen.getByRole('textbox', { name: 'Recipe name' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(screen.getByRole('alert').textContent).toBe('Can’t save yet: give your recipe a name');
    await user.type(name, 'C');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(name.getAttribute('aria-invalid')).toBeNull();
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
    expect(Object.keys(save.mock.calls[0][0]).sort()).toEqual(['equipment', 'foodGroups', 'id', 'lines', 'mealFit', 'name', 'newIngredients', 'originRecipeId', 'steps']);
  });

  it('SavedRecipe_SaysSaved_UntilSomethingChanges', () => {
    existing();
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save_PassesTheLoadedVersion', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save.mock.calls[0][1]).toBe(STAMP);
  });

  it('Discard_ReturnsToTheSavedRecipe', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), ' deluxe');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByRole('textbox', { name: 'Recipe name' }) as HTMLInputElement).value).toBe('Bacon bowl');
  });

  it('MealChip_IsAToggle', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const chip = within(screen.getByRole('group', { name: 'Good for' })).getByRole('button', { name: 'Dinner' });
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('RecipeEditor basics summary (planner-flow guideline 2)', () => {
  it('Scout_SeesTheBasicsAsOneLine_OnASavedRecipe', () => {
    existing('draft', { ...READY, name: 'Pancakes', mealFit: ['breakfast' as const], foodGroups: ['grain', 'dairy'] as ('grain' | 'dairy')[] });
    expect(screen.getByText('Pancakes · Breakfast · Grain, Dairy')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Recipe name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('Scout_SeesTheFieldsOpen_OnANewRecipe', () => {
    fresh();
    expect(screen.getByRole('textbox', { name: 'Recipe name' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('Scout_SeesTheBasicsOpen_WhenASaveMarksTheName', async () => {
    const user = userEvent.setup();
    existing('draft', { ...READY, name: '' });
    expect(screen.queryByRole('textbox', { name: 'Recipe name' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Share with the troop' }));
    const name = screen.getByRole('textbox', { name: 'Recipe name' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
  });

  it('Scout_SeesTheFieldsOpen_AfterPressingEdit', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Recipe name' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('RecipeEditor sharing', () => {
  it('Scout_SeesWhichFieldIsBad_WhenSharingAnIncompleteRecipe', async () => {
    existing('draft', { ...READY, mealFit: [], lines: [] });
    const share$ = screen.getByRole('button', { name: 'Share with the troop' }) as HTMLButtonElement;
    expect(share$.disabled).toBe(false);
    await userEvent.setup().click(share$);
    expect(screen.getByText('Pick at least one meal it’s good for.')).toBeTruthy();
    expect(screen.getByText('Add at least one ingredient.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Recipe name' }).getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Can’t share yet: pick a meal it’s good for (+1 more)');
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Good for' })).getAllByRole('button')[0]);
    expect(share).not.toHaveBeenCalled();
  });

  it('Scout_LosesTheProblemLine_WhenTheRecipeBecomesWhole', async () => {
    const user = userEvent.setup();
    existing('draft', { ...READY, mealFit: [] });
    await user.click(screen.getByRole('button', { name: 'Share with the troop' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Good for' })).getByRole('button', { name: 'Breakfast' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Pick at least one meal it’s good for.')).toBeNull();
  });

  it('Share_SavesFirst_WhenThereAreUnsavedChanges', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
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
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
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

describe('RecipeEditor People', () => {
  it('RecipeEditor_People_IsANumberBox', () => {
    existing();
    const box = screen.getByRole('spinbutton', { name: /^People/ }) as HTMLInputElement;
    expect([box.type, screen.queryByRole('button', { name: /One (more|fewer) person/ })]).toEqual(['number', null]);
  });

  it('RecipeEditor_TypingPeople_ScalesTheTotalOnBlur', async () => {
    const user = userEvent.setup();
    existing();
    const box = screen.getByRole('spinbutton', { name: /^People/ });
    await user.clear(box);
    await user.type(box, '16');
    await user.tab();
    const row = within(screen.getByRole('list', { name: 'Ingredients' })).getByRole('button', { name: 'Bacon' }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('48 slices');
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

describe('RecipeEditor step focus', () => {
  it('AddAStep_MovesFocusIntoTheNewStep', async () => {
    existing();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a step' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Step 2' }));
  });
});

describe('RecipeEditor typed-in ingredients (Phase 4B)', () => {
  async function addNew(user: ReturnType<typeof userEvent.setup>, name = 'Gochujang') {
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), name);
    await user.click(screen.getByRole('option', { name: `Add “${name}” as a new ingredient` }));
    const form = screen.getByRole('group', { name: 'New ingredient' });
    await user.click(within(form).getByRole('button', { name: 'Weight' }));
    await user.type(within(form).getByRole('textbox', { name: 'One package holds' }), '1');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Package size unit' }), 'lb');
    await user.type(within(form).getByRole('textbox', { name: 'Price' }), '6.99');
    await user.click(within(form).getByRole('button', { name: 'Gluten' }));
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
  }

  it('Search_OffersTypedTextAsANewIngredient', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'Gochujang');
    expect(screen.getByRole('option', { name: 'Add “Gochujang” as a new ingredient' })).toBeTruthy();
  });

  it('NewIngredient_JoinsTheList_TaggedNew', async () => {
    const user = userEvent.setup();
    existing();
    await addNew(user);
    const row = within(screen.getByRole('list', { name: 'Ingredients' })).getByRole('button', { name: 'Gochujang' }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('New');
  });

  it('NewIngredient_IsPricedFromTheForm', async () => {
    const user = userEvent.setup();
    existing();
    await addNew(user);
    await user.click(within(screen.getByRole('list', { name: 'Ingredients' })).getByRole('button', { name: 'Gochujang' }));
    expect(screen.getByText('Gochujang · $6.99')).toBeTruthy();
  });

  it('NewIngredientForm_RefusesAMissingPrice', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'Gochujang');
    await user.click(screen.getByRole('option', { name: 'Add “Gochujang” as a new ingredient' }));
    const form = screen.getByRole('group', { name: 'New ingredient' });
    await user.type(within(form).getByRole('textbox', { name: 'One package holds' }), '2');
    await user.type(within(form).getByRole('textbox', { name: 'One is called' }), 'tub');
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    expect(within(form).getByText('Enter what one package costs, from $0.10 to $500.')).toBeTruthy();
    expect(within(form).getByRole('alert').textContent).toBe('Can’t add yet: enter what one package costs');
  });

  it('Scout_SeesWhichFieldIsBad_WhenAddingAnIncompleteIngredient', async () => {
    const user = userEvent.setup();
    existing();
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'Gochujang');
    await user.click(screen.getByRole('option', { name: 'Add “Gochujang” as a new ingredient' }));
    const form = screen.getByRole('group', { name: 'New ingredient' });
    const add = within(form).getByRole('button', { name: 'Add ingredient' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    await user.click(add);
    expect(within(form).getByRole('textbox', { name: 'One is called' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByRole('textbox', { name: 'One package holds' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByRole('textbox', { name: 'Price' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByRole('alert').textContent).toBe('Can’t add yet: say what one is called (+2 more)');
    expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'One is called' }));
    expect(within(form).getByText('How big is one package?')).toBeTruthy();
  });

  it('Save_SendsTheNewIngredient_InTheRecipeUnit', async () => {
    const user = userEvent.setup();
    existing();
    await addNew(user);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save.mock.calls[0][0].newIngredients[0]).toMatchObject({ name: 'Gochujang', kind: 'weight', avoid: ['gf'], price: 6.99, size: 16 });
  });

  it('Save_SwapsTheNewKeyForTheRealId', async () => {
    const user = userEvent.setup();
    existing();
    await addNew(user);
    const key = () => (save.mock.calls.at(-1)![0].lines as { ingredientId: string }[]).at(-1)!.ingredientId;
    save.mockImplementationOnce(async (d: { newIngredients: { key: string }[] }) => ({ ok: true, id: 'S-0000abcd', updatedAt: STAMP, ids: { [d.newIngredients[0].key]: 'x-00000001' } }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(key()).toBe('x-00000001');
  });
});

// Gear is picked from the troop's list, never typed in (Patrick, 2026-10-05). This replaces the Phase 4C tests
// for "Often used" chips and the "Something else…" free-text box, both removed.
describe('RecipeEditor gear (picked from the master list)', () => {
  const item = (id: number, name: string, retiredAt: string | null = null) => ({ id, name, home: 'trailer' as const, perPerson: false, retiredAt });
  const MASTER = [item(1, 'Tongs'), item(2, 'Skillet'), item(3, 'Dutch oven (12 in)'), item(4, 'Ladle'), item(5, 'Old whisk', '2026-09-01T00:00:00Z')];
  const withGear = (initial = READY) => render(<RecipeEditor catalog={CATALOG} id="S-0000abcd" initial={initial} status="draft" credit={null} updatedAt={STAMP} gearList={MASTER} />);
  const options = () => screen.queryAllByRole('option').map((o) => o.textContent);

  it('TheOptions_AreTheMasterItems_AToZ_NoRetiredOnes', async () => {
    withGear();
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Search gear' }));
    expect(options()).toEqual(['Dutch oven (12 in)', 'Ladle', 'Skillet', 'Tongs']);
  });

  it('ANameTheListLacks_CannotBeAdded_AndNothingOffersTo', async () => {
    withGear();
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Search gear' }), 'spork{Enter}');
    expect([options(), screen.queryByRole('list', { name: 'Gear' }), screen.queryByRole('button', { name: /Something else|Often used/ })]).toEqual([[], null, null]);
  });

  it('Picking_AddsAChip_AndTheItemLeavesTheOptions', async () => {
    const user = userEvent.setup();
    withGear();
    await user.type(screen.getByRole('combobox', { name: 'Search gear' }), 'ton{Enter}');
    expect(within(screen.getByRole('list', { name: 'Gear' })).getByText('Tongs')).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: 'Search gear' }));
    expect(options()).not.toContain('Tongs');
  });

  it('TheChips_AreAToZ', () => {
    withGear({ ...READY, equipment: ['Tongs', 'Skillet'] });
    expect(within(screen.getByRole('list', { name: 'Gear' })).getAllByRole('listitem').map((li) => li.textContent?.replace(/[^A-Za-z]/g, '').slice(0, 6))).toEqual(['Skille', 'Tongs']);
  });

  it('TheCountStepper_AddsOne_AndTheChipSaysSo', async () => {
    const user = userEvent.setup();
    withGear({ ...READY, equipment: ['Skillet'] });
    await user.click(screen.getByRole('button', { name: 'More Skillet' }));
    expect(within(screen.getByRole('list', { name: 'Gear' })).getByText('Skillet × 2')).toBeTruthy();
  });

  it('Gear_CanBeRemoved', async () => {
    const user = userEvent.setup();
    withGear({ ...READY, equipment: ['Skillet'] });
    await user.click(screen.getByRole('button', { name: 'Remove Skillet' }));
    expect(screen.queryByRole('list', { name: 'Gear' })).toBeNull();
  });

  it('Gear_IsSaved_WithItsCount', async () => {
    const user = userEvent.setup();
    withGear();
    await user.type(screen.getByRole('combobox', { name: 'Search gear' }), 'ton{Enter}');
    await user.click(screen.getByRole('button', { name: 'More Tongs' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save.mock.calls[0][0].equipment).toEqual(['Tongs × 2']);
  });

  it('AName_TheServerDropped_IsSaid_AndTakenOffTheForm', async () => {
    const user = userEvent.setup();
    save.mockResolvedValue({ ok: true, id: 'S-0000abcd', updatedAt: STAMP, dropped: ['Spork'] });
    withGear({ ...READY, equipment: ['Spork', 'Tongs'] });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Recipe name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByText(/Not on the gear list, so not kept: Spork/)).textContent).toContain('Spork');
    expect(within(screen.getByRole('list', { name: 'Gear' })).queryByText('Spork')).toBeNull();
  });
});

describe('RecipeEditor line units', () => {
  it('Save_CarriesTheLinesUnit', async () => {
    const user = userEvent.setup();
    existing('draft', { ...READY, lines: [{ ingredientId: 'pancake-mix', qtyPerPerson: 1, unitKey: null }] });
    await user.click(screen.getByRole('button', { name: 'Change Pancake mix' }));
    await user.click(screen.getByRole('button', { name: 'Change amount' }));
    const box = screen.getByRole('textbox', { name: /Amount per person of Pancake mix/ });
    await user.clear(box);
    await user.type(box, '4 tbsp{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save.mock.calls[0][0].lines).toEqual([{ ingredientId: 'pancake-mix', qtyPerPerson: 4, unitKey: 'tbsp' }]);
  });
});
