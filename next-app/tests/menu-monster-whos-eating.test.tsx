import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Outing } from '../src/lib/menu-monster/menu-view';

/**
 * Who's eating, on its own screen (Patrick, 2026-10-06: "make Who's Eating its own step on its own screen and not
 * merged together" with the meals). PeopleTab is PlanTab's "people" page: the form is always open — no summary
 * line, no Edit button — and it is plan state like the meals: the dirty-gated Save in the summary rail, "Next:
 * Meals ›" when clean, the leave guard. Next's router and the server actions are the only things faked.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const createMenuAction = vi.fn();
const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a),
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { PeopleTab } from '../src/app/(public)/library/menu-monster/menus/_components/people-tab';

const OUTINGS: Outing[] = [
  { id: 7, title: 'Fall Camporee', startDate: '2026-10-09', endDate: '2026-10-11', category: 'Campout / Overnight' },
  { id: 8, title: 'Winter Camp', startDate: '2026-12-04', endDate: '2026-12-06', category: 'Campout / Overnight' }
];

const base = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 5, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }],
  ...over
});

const VERSION = '2026-10-02T12:00:00.000Z';
const CFG = { people: '/p/people', plan: '/p', gear: '/p/gear', shopping: '/p/shopping' };
const existing = (menu: Menu = base()) => <PeopleTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} steps={CFG} />;
const blank = (over: Partial<Menu> = {}) => base({ name: '', meals: [], restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, ...over });
const fresh = () => <PeopleTab catalog={CATALOG} menuId={null} menu={blank()} updatedAt={null} outings={OUTINGS} />;
const newMenu = (over: Partial<Menu> = {}, extra: { myPatrol?: string | null } = {}) => <PeopleTab catalog={CATALOG} menuId={null} menu={blank(over)} updatedAt={null} outings={OUTINGS} {...extra} />;
const withSteps = existing;

const num = (name: RegExp | string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
async function typeInto(el: HTMLInputElement, text: string) {
  const user = userEvent.setup();
  await user.clear(el);
  await user.type(el, text);
  await user.tab();
}
const rail = () => screen.getByRole('region', { name: 'Menu summary' });
const summary = () => within(rail()).getByRole('button', { name: /people?/ });
const strip = () => screen.getByRole('navigation', { name: 'Menu steps' });
const texts = () => within(strip()).getAllByRole('link').map((a) => a.textContent);

describe('PeopleTab — Who’s eating on its own screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('WhosEating_IsAlwaysExpanded_OnASavedMenu_WithNoSummaryLineAndNoEditButton', () => {
    render(existing());
    expect([
      screen.getByRole('textbox', { name: 'Menu name' }) != null,
      screen.queryByRole('button', { name: 'Edit menu basics' }),
      screen.queryByRole('button', { name: 'Edit' }),
      screen.queryByText(/^Camporee food · 8 people/)
    ]).toEqual([true, null, null, null]);
  });

  it('WhosEating_ShowsEveryField_Name_Place_Outing_Patrol_People_Diets_Budget', () => {
    render(existing(base({ patrol: 'FireQuacker' })));
    expect([
      screen.getByRole('textbox', { name: 'Menu name' }) != null,
      screen.getByRole('combobox', { name: /Where you.re cooking/ }) != null,
      screen.getByRole('combobox', { name: 'Outing' }) != null,
      screen.getByRole('combobox', { name: 'Patrol' }) != null,
      num(/^People/).value,
      num(/^Gluten-free/).value,
      screen.getByRole('button', { name: 'Add a diet' }) != null,
      num(/^Budget/).value
    ]).toEqual([true, true, true, true, '8', '5', true, '4.00']);
  });

  it('WhosEating_IsExpanded_OnANewMenu_Too', () => {
    render(fresh());
    expect(screen.getByRole('textbox', { name: 'Menu name' })).toBeTruthy();
  });

  it('WhosEating_HasNoMealsOnIt_NoMealsHeading_NoAddADay', () => {
    render(existing());
    expect([screen.queryByRole('heading', { level: 2, name: 'Meals' }), screen.queryByRole('button', { name: 'Add a day' }), screen.queryByRole('button', { name: /^Breakfast/ })]).toEqual([null, null, null]);
  });

  it('WhosEating_NamesItsStep_WithAnH2', () => {
    render(existing());
    expect(screen.getByRole('heading', { level: 2, name: 'Who’s eating' })).toBeTruthy();
  });

  it('Save_IsGreyedAndSaysSaved_NoMore_ItIsNextMeals_WhenClean', () => {
    render(existing());
    expect(within(rail()).getByRole('link', { name: 'Next: Meals ›' }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1');
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });

  it('Save_BecomesTheOnePrimary_WhenTheDraftIsDirty_AndNextMealsGoesAway', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect([within(rail()).getByRole('button', { name: 'Save changes' }) != null, screen.queryByRole('link', { name: 'Next: Meals ›' })]).toEqual([true, null]);
  });

  it('NewMenu_FirstSave_LandsOnTheMealsStep_OfTheCreatedMenu', async () => {
    createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    const user = userEvent.setup();
    render(fresh());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), 'Spring hike');
    await user.click(screen.getByRole('button', { name: 'Save menu' }));
    expect(router.replace).toHaveBeenCalledWith('/library/menu-monster/menus/new-id');
  });

  it('WhosEating_PeopleStep_IsMarkedCurrent_AndMealsIsNot', () => {
    render(existing());
    const cur = within(strip()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'step');
    expect(cur.map((a) => a.textContent)).toEqual(['✓Who’s eating (done)']);
  });

  it('Strip_TwoFirstSteps_PointAtTwoRoutes', () => {
    render(existing());
    expect(within(strip()).getAllByRole('link').slice(0, 2).map((a) => a.getAttribute('href'))).toEqual(['/p/people', '/p']);
  });

  it('Rail_WhosEatingFix_LinksToThePeopleStep', () => {
    render(<PeopleTab catalog={CATALOG} menuId="menu-1" menu={base({ name: '' })} updatedAt={VERSION} outings={OUTINGS} steps={CFG} />);
    fireEvent.click(summary());
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /Name the menu/ }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/people');
  });

  it('ReadOnlyViewer_SeesTheValuesAsText_NoFormNoSave', () => {
    render(<PeopleTab catalog={CATALOG} menuId="menu-1" menu={base({ patrol: 'FireQuacker' })} updatedAt={VERSION} outings={OUTINGS} readOnly />);
    expect(screen.getByText('People: 8 · Gluten-free: 5')).toBeTruthy();
    expect(screen.getByText('Camp · FireQuacker')).toBeTruthy();
    expect(screen.getByText('$4.00 budget a person, per meal')).toBeTruthy();
    expect([screen.queryByRole('textbox'), screen.queryByRole('spinbutton'), screen.queryByRole('button', { name: /^Save/ })]).toEqual([null, null, null]);
  });

  it('ReadOnlyViewer_HasNextMeals_InTheRail', () => {
    render(<PeopleTab catalog={CATALOG} menuId="menu-1" menu={base()} updatedAt={VERSION} outings={OUTINGS} readOnly />);
    expect(within(rail()).getByRole('link', { name: 'Next: Meals ›' })).toBeTruthy();
  });

  it('Diets_ShowOnlyThoseAboveZero_WithAddADietForTheRest', async () => {
    const user = userEvent.setup();
    render(existing());
    expect(screen.queryByRole('spinbutton', { name: /^Nut-free/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a diet' }));
    expect(within(screen.getByRole('group', { name: 'Diets the menu does not count yet' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Vegetarian', 'Nut-free', 'Dairy-free']);
    await user.click(screen.getByRole('button', { name: 'Nut-free' }));
    expect(num(/^Nut-free/).value).toBe('0');
  });

  it('Diets_AddADietIsGone_WhenEveryDietShows', () => {
    render(existing(base({ restrictions: { gf: 1, nut: 1, dairy: 1, veg: 1 } })));
    expect(screen.queryByRole('button', { name: 'Add a diet' })).toBeNull();
  });

  it('Save_FocusesTheNameField_WhenTheNameIsEmpty', async () => {
    const user = userEvent.setup();
    render(existing(base({ name: 'x' })));
    await user.clear(screen.getByRole('textbox', { name: 'Menu name' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert').textContent).toContain('Give your menu a name');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Menu name' }));
    expect(saveMenuAction).not.toHaveBeenCalled();
  });

  it('Budget_IsSaved_WithTheMenu', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(existing());
    await typeInto(num(/^Budget/), '6');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ budgetPerPersonMeal: 6 }), VERSION);
  });

  it('LeavingByReload_IsNotBlocked_WhenTheMenuIsSaved', () => {
    render(existing());
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('InAppLink_DoesNotAsk_WhenTheMenuIsSaved', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(existing());
    fireEvent.click(screen.getByRole('link', { name: /^Meals/ }));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('MenuNameInTheTitle_FallsBackToUntitled_ForASavedMenuWithNoName', () => {
    render(existing(base({ name: '' })));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Untitled menu');
  });

  it('Discard_IsGone_WhenNothingChanged_AndEnabledOnceItIsDirty', async () => {
    render(existing());
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Save_SaysSaveChangesAndEnables_WhenTheNameChanges', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('NewMenu_OffersSaveMenu', () => {
    render(fresh());
    expect(screen.getByRole('button', { name: 'Save menu' })).toBeTruthy();
  });

  it('Diets_ClampToPeople_WhenPeopleDropsBelowThem', async () => {
    render(existing());
    await typeInto(num(/^People/), '3');
    expect(num(/^Gluten-free/).value).toBe('3');
  });

  it('Diets_CannotExceedPeople_WhenTyped', async () => {
    render(existing());
    // Gluten-free, not Nut-free: only diets above zero show a dialer (2026-10-06); the cap is the same for each.
    await typeInto(num(/^Gluten-free/), '20');
    expect(num(/^Gluten-free/).value).toBe('8');
  });

  it('People_StopAtFifty', async () => {
    render(existing());
    await typeInto(num(/^People/), '99');
    expect(num(/^People/).value).toBe('50');
  });

  it('People_StartAtTwo', async () => {
    render(existing());
    await typeInto(num(/^People/), '1');
    expect(num(/^People/).value).toBe('2');
  });

  it('Dialers_ReadPeopleThenDietsInTheApprovedOrder', () => {
    // Every diet above zero, so every dialer shows (a diet at zero is behind "Add a diet…").
    render(existing(base({ restrictions: { gf: 1, nut: 1, dairy: 1, veg: 1 } })));
    const names = screen.getAllByRole('spinbutton').map((e) => e.getAttribute('id'));
    const labels = names.map((id) => document.querySelector(`label[for="${id}"]`)?.textContent);
    expect(labels.slice(0, 5)).toEqual(['People:', 'Gluten-free:', 'Vegetarian:', 'Nut-free:', 'Dairy-free:']);
  });

  it('Dialers_ShareOneRow_WithNoSeparatorDotsOrNestedLines', () => {
    render(existing(base({ restrictions: { gf: 1, nut: 1, dairy: 0, veg: 0 } })));
    const row = num(/^People/).closest('div[class*="dialers"]') as HTMLElement;
    expect(row).toBeTruthy();
    // People, Gluten-free, Nut-free steppers and "Add a diet" are direct children: one flex row, nothing wrapping a pair.
    expect(row.textContent).not.toContain('·');
    expect(Array.from(row.children).every((c) => c.querySelector('[class*="line"]') == null)).toBe(true);
    expect(row.children.length).toBe(4);
  });

  it('Context_IsASelect', () => {
    render(existing());
    expect(screen.getByRole('combobox', { name: /Where you.re cooking/ }).tagName).toBe('SELECT');
  });

  it('Outing_IsASelect_WithNoOutingLast', () => {
    render(existing());
    const sel = screen.getByRole('combobox', { name: 'Outing' });
    const opts = within(sel).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Fall Camporee · Oct 9–11, 2026', 'Winter Camp · Dec 4–6, 2026', 'No outing']);
  });

  it('Outing_NamesAnUnnamedMenu_WhenPicked', async () => {
    render(fresh());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value).toBe('Fall Camporee');
  });

  it('Outing_KeepsAnExistingName_WhenPicked', async () => {
    render(existing());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value).toBe('Camporee food');
  });

  it('Outing_SetsOneDayPerOutingDate_WhenTheMenuHasNoMeals', async () => {
    createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    render(fresh());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save menu' }));
    expect(createMenuAction).toHaveBeenCalledWith(expect.objectContaining({ dayCount: 3, startDate: '2026-10-09' }));
  });

  it('Outing_SavesItsSpanAsTheDayCount', async () => {
    createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    const user = userEvent.setup();
    render(fresh());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save menu' }));
    expect(createMenuAction).toHaveBeenCalledWith(expect.objectContaining({ dayCount: 3 }));
  });

  it('Title_IsOneH1_ThatFollowsTheMenuName', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Camporee food!']);
  });

  it('Discard_IsAbsent_OnABrandNewMenu', () => {
    render(fresh());
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
  });

  it('Saving_IsAnnounced_WhileTheSaveRuns', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMenuAction.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    const { container } = render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Saving…');
    finish({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    expect(await screen.findByRole('link', { name: 'Next: Meals ›' })).toBeTruthy();
  });

  it('Save_IsBlockedWithTheNameError_WhenTheNameIsEmpty', async () => {
    render(fresh());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save menu' }));
    expect(screen.getByRole('alert').textContent).toContain('Give your menu a name');
  });

  it('Save_DoesNotCallTheServer_WhenTheNameIsEmpty', async () => {
    render(fresh());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save menu' }));
    expect(createMenuAction).not.toHaveBeenCalled();
  });

  it('NewMenu_CreatesThenReplacesTheUrlWithTheNewId', async () => {
    createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    const user = userEvent.setup();
    render(fresh());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), 'Spring hike');
    await user.click(screen.getByRole('button', { name: 'Save menu' }));
    expect(router.replace).toHaveBeenCalledWith('/library/menu-monster/menus/new-id');
  });

  it('Save_SendsTheVersionTokenItLoaded', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ name: 'Camporee food!' }), VERSION);
  });

  it('Save_ReturnsToSaved_AfterItLands', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('link', { name: 'Next: Meals ›' })).toBeTruthy();
  });

  it('Save_ShowsTheServersError_InAnAlert', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'This menu was changed in another window since you opened it.' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another window');
  });

  it('Save_StaysDirty_WhenTheServerRefuses', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'nope' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('Discard_RestoresTheLastSavedMenu', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value).toBe('Camporee food');
  });

  it('LeavingByReload_AsksToConfirm_WhenTheMenuIsDirty', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('InAppLink_StaysPut_WhenDirtyAndTheScoutDeclines', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    const proceeded = fireEvent.click(screen.getByRole('link', { name: /^Meals/ }));
    expect(proceeded).toBe(false);
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('InAppLink_Proceeds_WhenDirtyAndTheScoutConfirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect(fireEvent.click(screen.getByRole('link', { name: /^Meals/ }))).toBe(true);
    confirm.mockRestore();
  });

    it('Rail_ReplacesTheSaveBar_OneSavePrimary', async () => {
      render(existing());
        await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
      expect(within(rail()).getByRole('button', { name: 'Save changes' })).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(1);
    });

    it('Rail_FollowsTheUnsavedDraft_AndSaysUnsaved', async () => {
      render(existing());
      expect(screen.queryByText('unsaved')).toBeNull();
        await userEvent.setup().click(screen.getByRole('button', { name: 'One more person' }));
      expect(summary().textContent).toMatch(/^9 people/);
      expect(screen.getByText('unsaved')).toBeTruthy();
    });

    it('Rail_GoesBackToSaved_AndUnsavedGoes_AfterDiscard', async () => {
      const user = userEvent.setup();
      render(existing());
        await user.click(screen.getByRole('button', { name: 'One more person' }));
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(summary().textContent).toMatch(/^8 people/);
      expect(screen.queryByText('unsaved')).toBeNull();
    });

    it('Rail_NewMenu_KeepsSaveMenu_AsItsPrimary', () => {
      render(fresh());
      expect(within(rail()).getByRole('button', { name: 'Save menu' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: /^Next:/ })).toBeNull();
    });

    it('Rail_NeverFillsInHeadcount_ItShowsWhatWasGiven', () => {
      render(<PeopleTab catalog={CATALOG} menuId={null} menu={base({ name: '', headcount: 0, meals: [] })} updatedAt={null} outings={OUTINGS} />);
      expect(summary().textContent).toMatch(/^0 people/);
    });

    it('Strip_TicksFollowTheDraft_NotTheSavedMenu', async () => {
      render(withSteps(base({ name: '' })));
      expect(texts()[0]).toBe('Who’s eating');
        await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), 'Camp');
      expect(texts()[0]).toBe('✓Who’s eating (done)');
    });

  describe('defaults', () => {
    const context = () => (screen.getByRole('combobox', { name: /Where you.re cooking/ }) as HTMLSelectElement).value;

    it('PickingAnOuting_SetsCampByDefault', async () => {
      render(newMenu({ context: 'home' }));
      await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
      expect(context()).toBe('camp');
    });

    it('PickingAnOuting_KeepsWhatTheScoutChose', async () => {
      const user = userEvent.setup();
      render(newMenu({ context: 'home' }));
      await user.selectOptions(screen.getByRole('combobox', { name: /Where you.re cooking/ }), 'trail');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
      expect(context()).toBe('trail');
    });

    it('PickingAnOuting_LeavesASavedMenusContextAlone', async () => {
      render(existing(base({ context: 'home' })));
        await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
      expect(context()).toBe('home');
    });

    it('Patrol_DefaultsToTheScoutsOwn', () => {
      render(newMenu({}, { myPatrol: 'FireQuacker' }));
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLSelectElement).value).toBe('FireQuacker');
    });

    it('Patrol_Default_IsSentOnTheFirstSave', async () => {
      createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
      const user = userEvent.setup();
      render(newMenu({}, { myPatrol: 'FireQuacker' }));
      await user.type(screen.getByRole('textbox', { name: 'Menu name' }), 'Hike');
      await user.click(screen.getByRole('button', { name: 'Save menu' }));
      expect(createMenuAction).toHaveBeenCalledWith(expect.objectContaining({ patrol: 'FireQuacker' }));
    });

    it('Patrol_KeepsTheMenusOwn_OverTheScoutsPatrol', () => {
      render(newMenu({ patrol: 'Screaming Eagles' }, { myPatrol: 'FireQuacker' }));
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLSelectElement).value).toBe('Screaming Eagles');
    });

    it('Patrol_IsBlank_WhenThereIsNoPatrolToDefaultTo', () => {
      render(newMenu());
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLSelectElement).value).toBe('');
    });

    it('Patrol_IsNotDefaulted_OnASavedMenu', () => {
      render(<PeopleTab catalog={CATALOG} menuId="menu-1" menu={base()} updatedAt={VERSION} outings={OUTINGS} myPatrol="FireQuacker" />);
        expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLSelectElement).value).toBe('');
    });
  });
});

describe('PlanTab patrol (release 5)', () => {
  const withPatrols = (menu: Menu) => <PeopleTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} patrols={['FireQuacker', 'Screaming Eagles', 'Whole troop']} />;

  // Patrick, 2026-10-06: Patrol is a pull-down of the troop's patrols (a leader keeps the list), not a free-text field.
  it('Patrol_IsAPullDown_OfThePickOptionThenTheTroopsPatrols', () => {
    render(withPatrols(base()));
    const sel = screen.getByRole('combobox', { name: 'Patrol' });
    expect(sel.tagName).toBe('SELECT');
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['— pick —', 'FireQuacker', 'Screaming Eagles', 'Whole troop']);
  });

  it('Patrol_KeepsASavedPatrolThatIsNoLongerOnTheList', () => {
    render(withPatrols(base({ patrol: 'Old Patrol' })));
    const sel = screen.getByRole('combobox', { name: 'Patrol' }) as HTMLSelectElement;
    expect([sel.value, within(sel).getAllByRole('option').map((o) => o.textContent).pop()]).toEqual(['Old Patrol', 'Old Patrol']);
  });

  it('Patrol_PickingNone_RemovesThePatrolFromTheMenu', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(withPatrols(base({ patrol: 'FireQuacker' })));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Patrol' }), '');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction.mock.calls[0][1]).not.toHaveProperty('patrol');
  });

  it('Patrol_ShowsWhatIsSaved', () => {
    render(withPatrols(base({ patrol: 'FireQuacker' })));
    expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLSelectElement).value).toBe('FireQuacker');
  });

  it('Patrol_IsSaved_WithTheMenu', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(withPatrols(base()));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Patrol' }), 'Whole troop');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ patrol: 'Whole troop' }), VERSION);
  });
});

describe('PlanTab outing: who can open the menu (2026-10-04)', () => {
  const HINT = /Signed-in scouts and leaders can open this menu from the outing/;

  it('NoOuting_SaysNothing', () => {
    render(fresh());
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('PickingAnOuting_SaysTheCrewCanOpenIt', async () => {
    render(fresh());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect(screen.getByText(HINT)).toBeTruthy();
  });
});
