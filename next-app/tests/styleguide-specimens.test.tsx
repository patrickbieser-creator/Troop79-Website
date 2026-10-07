import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * The styleguide pages (/admin/styleguide/public and /admin/styleguide/admin) render the REAL
 * components, so a missing specimen means the guide lies (AGENTS.md: keep the styleguide in the same
 * commit as the change). One assertion per backfilled specimen: each renders its distinguishing text.
 * The specimens are rendered from their own wrappers — the pages themselves pull in the whole shell.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/' }));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  keepScoutFood: vi.fn(),
  putFoodOnMenu: vi.fn()
}));
vi.mock('../src/app/admin/(workspace)/news/_components/media-picker', () => ({ MediaPicker: () => null }));

import { PublicBlockedSaveSpecimen, PublicDietRowsSpecimen, PublicFinishLineSpecimen, PublicGearSpecimen } from '../src/app/admin/(workspace)/styleguide/public/specimens';
import { StepStrip } from '../src/app/(public)/library/menu-monster/menus/_components/step-strip';
import { BlockedSaveDemo } from '../src/app/admin/(workspace)/styleguide/admin/save-demo';
import { FoodListRowsSpecimen } from '../src/app/admin/(workspace)/styleguide/admin/food-list-rows-specimen';
import { AdminAddRowSpecimen, ComboboxSpecimen, DangerConfirmSpecimen, GearPickerNoMatchSpecimen } from '../src/app/admin/(workspace)/styleguide/admin/specimens';
import { EditorPromptsSpecimen } from '../src/app/admin/(workspace)/styleguide/admin/editor-prompts-specimen';

describe('Public styleguide specimens', () => {
  it('DietRows_ShowScopeTagsAndTheIdleReason_WhenRendered', () => {
    render(<PublicDietRowsSpecimen />);
    expect(screen.getByText('Gluten-free scouts only')).toBeTruthy();
    expect(screen.getByText('except gluten-free')).toBeTruthy();
    expect(screen.getByText('no dairy-free scouts on this meal')).toBeTruthy();
  });

  it('AddForChoice_OffersEveryoneAndEachDietOnTheMeal_WhenRendered', () => {
    render(<PublicDietRowsSpecimen />);
    fireEvent.click(screen.getByRole('button', { name: '+ Ingredient' }));
    const select = screen.getByLabelText('Add for') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Everyone', 'Gluten-free scouts', 'Vegetarian scouts']);
  });

  it('StepStripReview_IsTheFifthStepAndCurrent_WhenConfigHasReview', () => {
    render(<StepStrip config={{ people: '#', plan: '#', gear: '#', shopping: '#', review: '#' }} done={{ eating: true }} current="review" />);
    const review = screen.getByRole('link', { name: 'Review' });
    expect(review.getAttribute('aria-current')).toBe('step');
  });

  it('FinishLine_ShowsReadyWithShare_AndAnNToFixLink_WhenRendered', () => {
    render(<PublicFinishLineSpecimen />);
    expect(screen.getByText('Ready to shop')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Share' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '2 to fix before shopping' })).toBeTruthy();
  });

  it('GearPickerAndChips_ShowSearchAndCountedChips_WhenRendered', () => {
    render(<PublicGearSpecimen />);
    expect(screen.getByLabelText('Search gear')).toBeTruthy();
    expect(screen.getByText('Skillet × 2')).toBeTruthy();
  });

  it('AdminAddRow_ShowsALinkAtRest_AndTheSearchWithCancel_WhenTapped', () => {
    render(<AdminAddRowSpecimen />);
    fireEvent.click(screen.getByRole('button', { name: '+ Ingredient' }));
    expect([screen.getByRole('combobox', { name: 'Add an ingredient (specimen)' }) != null, screen.getByRole('button', { name: 'Cancel' }) != null]).toEqual([true, true]);
  });

  it('Combobox_FiltersByContains_WhenTyped', () => {
    render(<ComboboxSpecimen />);
    const box = screen.getByRole('combobox', { name: 'Ingredient' });
    fireEvent.change(box, { target: { value: 'flou' } });
    expect(screen.getAllByRole('option').map((o) => o.firstChild?.textContent)).toEqual(['All purpose flour', 'Almond flour']);
  });

  it('BlockedSave_MarksTheFieldAndSaysWhy_WhenAddIsPressedIncomplete', () => {
    render(<PublicBlockedSaveSpecimen />);
    fireEvent.click(screen.getByRole('button', { name: 'Add food' }));
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Give it a name.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Can’t add yet: give it a name');
  });
});

describe('Admin styleguide specimens', () => {
  it('ProblemMarker_MarksTheFieldAndNamesTheProblem_WhenSaveIsBlocked', () => {
    render(<BlockedSaveDemo />);
    const field = screen.getByLabelText('Demo title (clear it)');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(screen.getByText('Title is required.')).toBeTruthy();
  });

  it('FoodListRows_ShowIngredientAndScoutFoodActions_WhenRendered', () => {
    render(<FoodListRowsSpecimen />);
    expect(screen.getByRole('button', { name: 'Put it on the menu by itself' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep for the troop' })).toBeTruthy();
  });

  it('FoodListRows_ShowTheDraftRow_WhenRendered', () => {
    render(<FoodListRowsSpecimen />);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('EditorPrompts_ShowGalleryLinkAndVideoForms_WhenOpenedOnABlock', () => {
    render(<EditorPromptsSpecimen />);
    expect(screen.getByText('Editing existing gallery link')).toBeTruthy();
    expect(screen.getByText('Editing existing video')).toBeTruthy();
  });

  it('EditorPrompts_ShowTheImageFormWithLinkToRadios_WhenOpenedOnABlock', () => {
    render(<EditorPromptsSpecimen />);
    expect(screen.getByText('Editing existing image')).toBeTruthy();
    expect(screen.getAllByRole('radio').length).toBe(3);
  });

  it('GearPickerNoMatch_ShowsTheSentenceAndTheAddLink_WhenTextIsNotOnTheList', () => {
    render(<GearPickerNoMatchSpecimen />);
    expect(screen.getByText(/is not on the gear list/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Add it to the gear list/ })).toBeTruthy();
  });

  it('DangerConfirm_NamesTheConsequence_WhenOpenedFromTheDemoButton', () => {
    render(<DangerConfirmSpecimen />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove brand…' }));
    expect(screen.getByText(/its prices are kept in the price history/)).toBeTruthy();
  });
});
