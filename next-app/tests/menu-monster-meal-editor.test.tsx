import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Link from 'next/link';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import { PLAN_STORAGE_KEY } from '../src/app/(public)/library/_tools/menu-monster/planner';
import type { Menu } from '../src/lib/menu-monster/menus';

/**
 * Scout Workspace slice 4: the meal drill-in. One meal of a saved menu runs
 * through the controlled planner; Save writes it back into menu.meals[i] via
 * saveMenuAction (a dirty-gated Save + Discard on the meal page — the
 * save-button standard — rather than save-on-leave).
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { MealEditor } from '../src/app/(public)/library/menu-monster/menus/_components/meal-editor';

const VERSION = '2026-10-02T12:00:00.000Z';
const menu = (): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], packageChoice: {}, qtyOverride: {}, lineSource: {} },
    { id: 'm2', day: 0, slot: 'lunch', headcount: null, recipeIds: [], packageChoice: {}, qtyOverride: {}, lineSource: {} }
  ]
});

const editor = (mealId = 'm1', m: Menu = menu()) => <MealEditor catalog={CATALOG} menuId="menu-1" menu={m} mealId={mealId} updatedAt={VERSION} />;
const people = () => screen.getByRole('spinbutton', { name: /^People/ }) as HTMLInputElement;

describe('MealEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('Meal_ShowsItsSavedPicks', () => {
    render(editor());
    expect(screen.getByRole('checkbox', { name: 'Bacon' })).toHaveProperty('checked', true);
  });

  it('Meal_ShowsTheMenusPeople', () => {
    render(editor());
    expect(people().value).toBe('8');
  });

  it('Save_IsDisabledAndSaid_WhenNothingChanged', () => {
    render(editor());
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save_Enables_WhenAnItemIsPicked', async () => {
    render(editor());
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Save_WritesThePickBackIntoThatMealOfTheMenu', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const sent = saveMenuAction.mock.calls[0][1] as Menu;
    expect(sent.meals[0].recipeIds).toEqual(['B003', 'B001']);
  });

  it('Save_LeavesTheOtherMealsAlone', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((saveMenuAction.mock.calls[0][1] as Menu).meals[1]).toEqual(menu().meals[1]);
  });

  it('Save_SendsTheMenuIdAndVersionToken', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect([saveMenuAction.mock.calls[0][0], saveMenuAction.mock.calls[0][2]]).toEqual(['menu-1', VERSION]);
  });

  it('Save_ReturnsToSaved_AfterItLands', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('Save_ShowsTheServersError_InAnAlert', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'That menu isn’t one of yours.' });
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('isn’t one of yours');
  });

  it('Discard_RestoresTheLastSavedPicks', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('checkbox', { name: 'Pancakes' })).toHaveProperty('checked', false);
  });

  it('People_CanBeOverridden_ForJustThisMeal', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(editor());
    await user.clear(people());
    await user.type(people(), '12');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((saveMenuAction.mock.calls[0][1] as Menu).meals[0].headcount).toBe(12);
  });

  it('People_OffersResetToTheMenusNumber_OnlyWhenOverridden', async () => {
    const user = userEvent.setup();
    render(editor());
    expect(screen.queryByRole('button', { name: 'Reset to 8' })).toBeNull();
    await user.clear(people());
    await user.type(people(), '12');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Reset to 8' })).toBeTruthy();
  });

  it('People_ResetClearsTheOverride', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(editor());
    await user.clear(people());
    await user.type(people(), '12');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Reset to 8' }));
    expect(people().value).toBe('8');
  });

  it('Title_IsTheMealsOwnH1', () => {
    render(editor());
    // (The planner's print-only sheet carries its own h1; it is display:none on screen.)
    expect(screen.getByRole('heading', { level: 1, name: 'Breakfast · Day 1' })).toBeTruthy();
  });

  it('BackLink_IsNotRenderedHere_TheKickerCarriesIt', () => {
    render(editor());
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull();
  });

  it('Diets_AreAQuietSourceNote_OnThePeopleLine', () => {
    const m = menu();
    m.restrictions = { gf: 2, nut: 0, dairy: 0, veg: 1 };
    render(editor('m1', m));
    const line = people().closest('div[class*="line"]') as HTMLElement;
    expect(line.textContent).toContain('Gluten-free: 2 · Vegetarian: 1 (from the menu)');
  });

  it('Diets_AreNotNoted_WhenTheMenuHasNone', () => {
    render(editor());
    expect(screen.queryByText(/from the menu/)).toBeNull();
  });

  it('LeavingByReload_AsksToConfirm_WhenThereAreUnsavedPicks', async () => {
    render(editor());
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('LeavingByReload_IsNotBlocked_WhenNothingChanged', () => {
    render(editor());
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('InAppLink_AsksToDiscard_WhenThereAreUnsavedPicks_AndStaysPutOnNo', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <>
        <Link href="/library/menu-monster/menus/menu-1">Camporee food</Link>
        {editor()}
      </>
    );
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    expect(fireEvent.click(screen.getByRole('link', { name: 'Camporee food' }))).toBe(false);
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('Meal_NeverTouchesTheBrowserDraft', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('checkbox', { name: 'Pancakes' }));
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull();
  });
});
