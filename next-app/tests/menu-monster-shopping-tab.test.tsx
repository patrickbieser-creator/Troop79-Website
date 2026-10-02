import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG as BASE } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import { buildSnapshot, type MenuSnapshot } from '../src/lib/menu-monster/menu-snapshot';

/**
 * Scout Workspace slice 5: the Shopping tab. One merged list for the whole
 * menu, grouped by store section, a quiet row per ingredient whose click opens
 * an inset (where it's used, the package in effect, and the choices), a
 * dirty-gated Save + Discard changes on the title line, and a quiet "Prices
 * have changed" line with Update prices when the price book has moved.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { ShoppingTab } from '../src/app/(public)/library/menu-monster/menus/_components/shopping-tab';

// Oatmeal is a troop staple in this catalog; orange juice has no usable package.
const CATALOG = { ...BASE, ingredients: BASE.ingredients.map((i) => (i.id === 'oatmeal' ? { ...i, staple: true } : i)) };

const VERSION = '2026-10-02T12:00:00.000Z';
const LANDED = { ok: true, updatedAt: '2026-10-02T13:00:00.000Z' };

const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B014', 'B023'], recipeEdits: {} },
    { id: 'm2', day: 1, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} },
    { id: 'm3', day: 1, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }
  ],
  ...over
});

const tab = (m: Menu = menu(), snapshot: MenuSnapshot | null = buildSnapshot(m, CATALOG), catalog = CATALOG) => (
  <ShoppingTab catalog={catalog} menuId="menu-1" menu={m} updatedAt={VERSION} snapshot={snapshot} tabs={<nav aria-label="Menu sections" />} />
);

const rowFor = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  return rowFor(name);
};
const sent = () => saveMenuAction.mock.calls[0][1] as Menu;

describe('ShoppingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  describe('page', () => {
    it('Title_IsTheMenuName_WithTheShoppingListHeadingUnderIt', () => {
      render(tab());
      expect(screen.getByRole('heading', { level: 1, name: 'Camporee food' })).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: 'Shopping list' })).toBeTruthy();
    });

    it('Summary_ShowsTheMergedTotalPeopleAndBudgetReadout', () => {
      render(tab());
      // 96 bacon slices... 8 x 3 x 2 = 48 -> Kirkland $18.15, bread $1.99 => $20.14.
      const line = screen.getByText(/for 8 people/).closest('p') as HTMLElement;
      expect(line.textContent).toContain('$20.14');
      expect(line.textContent).toMatch(/a person per meal/);
      expect(line.textContent).toMatch(/budget|Under|Over|Close/);
    });

    it('Print_IsAQuietLinkOnTheSummaryLine', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => {});
      render(tab());
      await userEvent.setup().click(screen.getByRole('button', { name: 'Print' }));
      expect(print).toHaveBeenCalledTimes(1);
    });

    it('PerPersonSwitch_DividesEachRowByThePeople', async () => {
      const user = userEvent.setup();
      render(tab());
      expect(within(rowFor('Bacon')).getByText('$18.15')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Per person' }));
      expect(within(rowFor('Bacon')).getByText('$2.27')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Per person' }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('rows', () => {
    it('Rows_AreGroupedUnderQuietStoreSectionHeadings', () => {
      render(tab());
      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(headings).toEqual(['Meat', 'Dairy & eggs', 'Bakery', 'Dry goods & pantry']);
    });

    it('Row_ShowsTheQuantityTimesThePackage_AndOnlyTheDollarAmount', () => {
      render(tab());
      const row = rowFor('Bacon');
      expect(within(row).getByText('1 × Kirkland Hickory Smoked Bacon, 4 x 1 lb')).toBeTruthy();
      expect(row.textContent).not.toMatch(/≈|each/);
    });

    it('Staple_ReadsTroopStapleNoNeedToBuy_WithADash', () => {
      render(tab());
      const row = rowFor('Instant oatmeal');
      expect(within(row).getByText('Troop staple, no need to buy')).toBeTruthy();
      expect(within(row).getByText('—')).toBeTruthy();
    });

    it('Unpriced_ShowsAQuietNoPriceYetTag', () => {
      render(tab());
      expect(within(rowFor('Orange juice')).getByText('No price yet')).toBeTruthy();
    });

    it('Footnote_SaysWhatShoppingOnceSaves_WhenMealsShare', () => {
      render(tab());
      expect(screen.getByText(/Shopping once for every meal saves \$11\.81/)).toBeTruthy();
    });

    it('Footnote_IsAbsent_WhenNothingIsShared', () => {
      const m = menu({ meals: [menu().meals[0]] });
      render(tab(m));
      expect(screen.queryByText(/Shopping once for every meal saves/)).toBeNull();
    });

    it('Empty_PointsBackToThePlanTab_WhenNoMealHasItems', () => {
      const m = menu({ meals: [] });
      render(tab(m));
      const link = screen.getByRole('link', { name: 'Plan tab' });
      expect(link.getAttribute('href')).toBe('/library/menu-monster/menus/menu-1');
      expect(link.closest('p')?.textContent).toMatch(/Add a meal on the Plan tab/);
    });
  });

  describe('inset disclosure', () => {
    it('Row_StartsClosed_AndOpensOnClick', async () => {
      const user = userEvent.setup();
      render(tab());
      const btn = screen.getByRole('button', { name: /^Bacon/ });
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      await user.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      await user.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('Row_OpensFromTheKeyboard_WithEnterAndSpace', async () => {
      const user = userEvent.setup();
      render(tab());
      const btn = screen.getByRole('button', { name: /^Bacon/ });
      btn.focus();
      await user.keyboard('{Enter}');
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      await user.keyboard(' ');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('Row_OpensWhenTheRowItselfIsClicked_NotOnlyTheName', async () => {
      const user = userEvent.setup();
      render(tab());
      await user.click(within(rowFor('Bacon')).getByText(/Kirkland/));
      expect(screen.getByRole('button', { name: /^Bacon/ }).getAttribute('aria-expanded')).toBe('true');
    });

    it('Inset_SaysHowMuchIsNeeded_AndWhichMealsUseIt', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      expect(within(row).getByText('Needs 48 slices for Day 1 breakfast, Day 2 breakfast.')).toBeTruthy();
    });

    it('Inset_NamesMealsByWeekday_WhenTheMenuHasADate', async () => {
      const user = userEvent.setup();
      render(tab(menu({ startDate: '2026-10-10' })));
      const row = await open(user, 'Bacon');
      expect(within(row).getByText(/for Saturday breakfast, Sunday breakfast\./)).toBeTruthy();
    });

    it('Inset_OfAStaple_HasNoShoppingChoices', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Instant oatmeal');
      expect(within(row).queryByRole('button', { name: /Bringing from home/ })).toBeNull();
    });
  });

  describe('choices', () => {
    it('PackageChips_MarkThePackageInEffect', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      expect(within(row).getByRole('button', { name: /Kirkland.*\$18\.15/ }).getAttribute('aria-pressed')).toBe('true');
      expect(within(row).getByRole('button', { name: /Oscar Mayer.*\$7\.49/ }).getAttribute('aria-pressed')).toBe('false');
    });

    it('PickingAnotherPackage_UpdatesTheRow_AndTurnsSaveOn', async () => {
      const user = userEvent.setup();
      render(tab());
      expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
      expect(within(rowFor('Bacon')).getByText('3 × Oscar Mayer Bacon, 16 oz')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('Save_SendsTheMenuWithItsShoppingChoice_AndTheVersionToken', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.anything(), VERSION);
      expect(sent().shopping.packageChoice).toEqual({ bacon: 'p-bac-om' });
      expect(sent().meals).toHaveLength(3);
      expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
    });

    it('Save_UsesTheNewVersionToken_OnTheNextSave', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByRole('button', { name: 'Saved' });
      await user.click(within(rowFor('Bacon')).getByRole('button', { name: /Kirkland/ }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saveMenuAction.mock.calls[1][2]).toBe(LANDED.updatedAt);
    });

    it('Save_ShowsTheError_WhenTheServerRefuses', async () => {
      saveMenuAction.mockResolvedValue({ ok: false, error: 'This menu was changed in another window.' });
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/changed in another window/);
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('Discard_RestoresTheLastSavedChoices', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(within(rowFor('Bacon')).getByText('1 × Kirkland Hickory Smoked Bacon, 4 x 1 lb')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('Quantity_CanBeTyped_AndResetToTheRecommendation', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: 'One more Bacon package' }));
      expect(within(rowFor('Bacon')).getByText('2 × Kirkland Hickory Smoked Bacon, 4 x 1 lb')).toBeTruthy();
      expect(within(rowFor('Bacon')).getByText('$36.30')).toBeTruthy();
      await user.click(within(rowFor('Bacon')).getByRole('button', { name: 'Reset to 1' }));
      expect(within(rowFor('Bacon')).getByText('1 × Kirkland Hickory Smoked Bacon, 4 x 1 lb')).toBeTruthy();
    });

    it('Quantity_BackToTheRecommendation_IsNotADirtyDraft', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: 'One more Bacon package' }));
      await user.click(within(rowFor('Bacon')).getByRole('button', { name: 'One fewer Bacon package' }));
      expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('BringingFromHome_TakesTheLineOffTheTotal_AndSavesWithItsNote', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: 'Bringing from home' }));
      const r = rowFor('Bacon');
      expect(within(r).getAllByText('—').length).toBeGreaterThan(0);
      await user.type(within(r).getByRole('textbox', { name: 'Note' }), 'Dad has some');
      expect(within(r).getByText(/Bringing from home · Dad has some/)).toBeTruthy();
      const line = screen.getByText(/for 8 people/).closest('p') as HTMLElement;
      expect(line.textContent).toContain('$1.99');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(sent().shopping.lineSource).toEqual({ bacon: { source: 'home', note: 'Dad has some' } });
    });

    it('FromTheTroopPantry_ReadsThatWay', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: 'From the troop pantry' }));
      expect(within(rowFor('Bacon')).getAllByText('From the troop pantry')).toHaveLength(2); // the choice chip and the row's meta
    });

    it('BuyingItAgain_ClearsTheBringChoice', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: 'Bringing from home' }));
      await user.click(within(rowFor('Bacon')).getByRole('button', { name: 'Buying it' }));
      expect(within(rowFor('Bacon')).getByText('1 × Kirkland Hickory Smoked Bacon, 4 x 1 lb')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('NoteInput_Is16px_AndCapped_ByItsMaxLength', async () => {
      const user = userEvent.setup();
      render(tab());
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: 'Bringing from home' }));
      expect(within(rowFor('Bacon')).getByRole('textbox', { name: 'Note' }).getAttribute('maxlength')).toBe('120');
    });
  });

  describe('prices have changed', () => {
    const moved = { ...CATALOG, packages: CATALOG.packages.map((p) => (p.id === 'p-bac-kirk' ? { ...p, price: 20 } : p)) };

    it('Line_IsAbsent_WhenThePriceBookHasNotMoved', () => {
      render(tab());
      expect(screen.queryByText(/changed since you saved/)).toBeNull();
    });

    it('Line_IsAbsent_WhenTheMenuHasNoSnapshotYet', () => {
      render(tab(menu(), null));
      expect(screen.queryByText(/changed since you saved/)).toBeNull();
    });

    it('Line_ShowsSavedAndLiveTotals_QuietlyUnderTheList', () => {
      render(tab(menu(), buildSnapshot(menu(), CATALOG), moved));
      const line = screen.getByText(/Prices in the troop price book changed since you saved/).closest('p') as HTMLElement;
      expect(line.textContent).toContain('$20.14 → $21.99');
      expect(line.closest('[role="alert"]')).toBeNull();
    });

    it('UpdatePrices_ResavesTheMenu_AndAnnouncesIt', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(tab(menu(), buildSnapshot(menu(), CATALOG), moved));
      await user.click(screen.getByRole('button', { name: 'Update prices' }));
      expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ name: 'Camporee food' }), VERSION);
      expect(await screen.findByText('Prices updated to today’s price book.')).toBeTruthy();
      expect(screen.queryByText(/changed since you saved/)).toBeNull();
    });

    it('UpdatePrices_SavesTheLastSavedMenu_NotAnUnsavedDraft', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(tab(menu(), buildSnapshot(menu(), CATALOG), moved));
      const row = await open(user, 'Bacon');
      await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
      await user.click(screen.getByRole('button', { name: 'Update prices' }));
      expect(sent().shopping.packageChoice).toEqual({});
      // The scout's pick is still an unsaved draft.
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('UpdatePrices_KeepsTheLine_WhenTheSaveFails', async () => {
      saveMenuAction.mockResolvedValue({ ok: false, error: 'Nope.' });
      const user = userEvent.setup();
      render(tab(menu(), buildSnapshot(menu(), CATALOG), moved));
      await user.click(screen.getByRole('button', { name: 'Update prices' }));
      expect(await screen.findByText('Nope.')).toBeTruthy();
      expect(screen.getByText(/changed since you saved/)).toBeTruthy();
    });
  });
});
