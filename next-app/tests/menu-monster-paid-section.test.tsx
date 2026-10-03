import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG as BASE } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import { buildSnapshot } from '../src/lib/menu-monster/menu-snapshot';

/**
 * Shopping tab, "What you paid" (Phase 2 release B, P2.4): one row per line being
 * bought, an inset with the package bought / how many / price paid each and a live
 * verdict, held lines first, and its OWN dirty-gated Save + Discard separate from
 * the shopping-choices Save. The action is a stub; the band math is the real one.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saveMenuAction = vi.fn();
const saveActualsAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a),
  saveActualsAction: (...a: unknown[]) => saveActualsAction(...a)
}));

import { ShoppingTab } from '../src/app/(public)/library/menu-monster/menus/_components/shopping-tab';

const CATALOG = { ...BASE, ingredients: BASE.ingredients.map((i) => (i.id === 'oatmeal' ? { ...i, staple: true } : i)) };
const VERSION = '2026-10-02T12:00:00.000Z';

// Bacon: 1 × Kirkland ($18.15) is the recommended package; bread: 1 × Kroger ($1.99).
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
  actuals: {},
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B014', 'B023'], recipeEdits: {} },
    { id: 'm2', day: 1, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} },
    { id: 'm3', day: 1, slot: 'lunch', headcount: null, recipeIds: ['L001'], recipeEdits: {} }
  ],
  ...over
});

const tab = (m: Menu = menu()) => (
  <ShoppingTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} snapshot={buildSnapshot(m, CATALOG)} tabs={<nav aria-label="Menu sections" />} />
);

const paidSection = () => screen.getByRole('heading', { level: 2, name: 'What you paid' }).closest('section') as HTMLElement;
const paidRow = (name: string) => within(paidSection()).getByRole('button', { name: `What you paid for ${name}` }).closest('li') as HTMLElement;
const openPaid = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(within(paidSection()).getByRole('button', { name: `What you paid for ${name}` }));
  return paidRow(name);
};
const typePrice = async (user: ReturnType<typeof userEvent.setup>, row: HTMLElement, price: string) => {
  const box = within(row).getByLabelText('Price paid, each');
  await user.clear(box);
  await user.type(box, price);
};
const saveBtn = () => within(paidSection()).getByRole('button', { name: /^(Save what I paid|Prices saved|Saving…)$/ }) as HTMLButtonElement;
const discardBtn = () => within(paidSection()).getByRole('button', { name: 'Discard price changes' }) as HTMLButtonElement;
const rowOrder = () => within(paidSection()).getAllByRole('listitem').map((li) => li.textContent ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  saveActualsAction.mockResolvedValue({ ok: true, applied: 0, held: 0, results: {} });
});

describe('What you paid: the section', () => {
  it('Scout_SeesTheSection_BelowTheShoppingList', () => {
    render(tab());
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Shopping list', 'What you paid']);
  });

  it('Scout_SeesPlannedAndNothingEntered_BeforeTypingAnything', () => {
    render(tab());
    expect(within(paidSection()).getByText('Planned $20.14 · nothing entered yet')).toBeTruthy();
  });

  it('Scout_SeesOneRowPerBoughtLine_NotStaplesOrUnpricedOrBroughtLines', () => {
    render(tab());
    const names = within(paidSection()).getAllByRole('button', { name: /^What you paid for / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['What you paid for Bacon', 'What you paid for Bread']);
  });

  it('Scout_SeesWhatWasPlanned_OnEachRow', () => {
    render(tab());
    expect(within(paidRow('Bacon')).getByText('planned 1 × $18.15')).toBeTruthy();
    expect(within(paidRow('Bacon')).getByText('—')).toBeTruthy();
  });

  it('Scout_SeesThePriceBookFootnote', () => {
    render(tab());
    expect(within(paidSection()).getByText(/within 50% of the price book update it for every scout/)).toBeTruthy();
  });

  it('Scout_SeesWhatWasSavedBefore_OnTheRow', () => {
    render(tab(menu({ actuals: { bacon: { packageId: 'p-bac-kirk', qty: 2, pricePaid: 18.15 } } })));
    expect(within(paidRow('Bacon')).getByText('2 × $18.15')).toBeTruthy();
    expect(within(paidSection()).getByText('Planned $18.15 · paid $36.30 on 1 of 2 lines')).toBeTruthy();
  });

  it('ShoppingList_StillHasOneButtonNamedForEachIngredient', () => {
    render(tab());
    expect(screen.getAllByRole('button', { name: /^Bacon/ })).toHaveLength(1);
  });
});

describe('What you paid: the open row', () => {
  it('Scout_OpensARow_ToAnInsetWithTheThreeQuestions', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    expect(within(row).getByText('What did you buy?')).toBeTruthy();
    expect(within(row).getByLabelText('Price paid, each')).toBeTruthy();
    expect(within(row).getByRole('group', { name: 'How many Bacon packages you bought' })).toBeTruthy();
  });

  it('Scout_SeesTheLinesUsablePackages_AsChips', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    const chips = within(row).getAllByRole('button', { pressed: true }).concat(within(row).getAllByRole('button', { pressed: false }));
    expect(chips.map((c) => c.textContent).sort()).toEqual(['Kirkland Hickory Smoked Bacon, 4 x 1 lb · $18.15', 'Oscar Mayer Bacon, 16 oz · $7.49']);
  });

  it('Scout_StartsWithThePlannedPackageSelected', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    expect(within(row).getByRole('button', { name: /Kirkland/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Scout_PicksADifferentPackage_AndTheVerdictFollowsThatPackage', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '7.49');
    await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
    expect(within(row).getByText('Matches the price book ($7.49).')).toBeTruthy();
  });

  it('Scout_ClosesTheRow_WhenClickingItsNameAgain', async () => {
    const user = userEvent.setup();
    render(tab());
    await openPaid(user, 'Bacon');
    await user.click(within(paidSection()).getByRole('button', { name: 'What you paid for Bacon' }));
    expect(within(paidSection()).queryByLabelText('Price paid, each')).toBeNull();
  });

  it('Scout_ShowsThePlannedPriceAsThePlaceholder', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    expect((within(row).getByLabelText('Price paid, each') as HTMLInputElement).placeholder).toBe('18.15');
  });
});

describe('What you paid: the verdict line', () => {
  it('Scout_SeesNotEnteredYet_UntilAPriceIsTyped', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    expect(within(row).getByText('Not entered yet')).toBeTruthy();
  });

  it('Scout_SeesItMatches_WhenThePriceIsTheBooks', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '18.15');
    expect(within(row).getByText('Matches the price book ($18.15).')).toBeTruthy();
  });

  it('Scout_SeesTheBookWillChange_WhenThePriceIsInsideTheBand', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    expect(within(row).getByText('When you save, the troop price book changes $18.15 → $19.25, credited to you.')).toBeTruthy();
    expect(within(row).getByText('↻ Updates the book')).toBeTruthy();
  });

  it('Scout_SeesALeaderWillCheck_WhenThePriceIsFarOut', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '40');
    expect(within(row).getByText('$40.00 is far from the usual $18.15. A leader will check it. Bought a different package? Pick it above.')).toBeTruthy();
    expect(within(row).getByText('⚑ Held')).toBeTruthy();
  });

  it('Scout_SeesThePaidAmountOnTheRow_WhileTyping', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    expect(within(row).getByText('1 × $19.25')).toBeTruthy();
  });

  it('Scout_SeesPlannedAndPaidInTheHeading_AfterTyping', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    expect(within(paidSection()).getByText('Planned $18.15 · paid $19.25 on 1 of 2 lines')).toBeTruthy();
  });

  it('Scout_SeesTheTotalFollowTheQuantity', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    await user.click(within(row).getByRole('button', { name: 'One more Bacon bought' }));
    expect(within(paidSection()).getByText('Planned $18.15 · paid $38.50 on 1 of 2 lines')).toBeTruthy();
  });
});

describe('What you paid: held lines sort first', () => {
  it('Scout_SeesAHeldLineMoveToTheTop_WhenItsPriceIsFarOut', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bread');
    await typePrice(user, row, '9.99');
    expect(rowOrder()[0]).toMatch(/^Bread/);
  });

  it('Scout_KeepsListOrder_WhenNothingIsHeld', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bread');
    await typePrice(user, row, '1.99');
    expect(rowOrder()[0]).toMatch(/^Bacon/);
  });
});

describe('What you paid: its own Save and Discard', () => {
  it('Scout_CannotSave_UntilAPriceIsTyped', () => {
    render(tab());
    expect(saveBtn().disabled).toBe(true);
    expect(discardBtn().disabled).toBe(true);
  });

  it('Scout_CanSave_OnceAPriceIsTyped', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    expect(saveBtn().disabled).toBe(false);
    expect(saveBtn().textContent).toBe('Save what I paid');
    expect(discardBtn().disabled).toBe(false);
  });

  it('Scout_CannotSaveAgain_AfterClearingThePriceBack', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    await user.clear(within(row).getByLabelText('Price paid, each'));
    expect(saveBtn().disabled).toBe(true);
  });

  it('Scout_DoesNotDirtyTheShoppingSave_ByTypingAPrice', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveMenuAction).not.toHaveBeenCalled();
  });

  it('Scout_SavesOnlyThePricedLines_ThroughTheActualsAction', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    await user.click(saveBtn());
    expect(saveActualsAction).toHaveBeenCalledWith('menu-1', { bacon: { packageId: 'p-bac-kirk', qty: 1, pricePaid: 19.25 } });
    expect(saveMenuAction).not.toHaveBeenCalled();
  });

  it('Scout_SavesTheChosenPackageAndQuantity', async () => {
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await user.click(within(row).getByRole('button', { name: /Oscar Mayer/ }));
    await user.click(within(row).getByRole('button', { name: 'One more Bacon bought' }));
    await typePrice(user, row, '7.99');
    await user.click(saveBtn());
    expect(saveActualsAction).toHaveBeenCalledWith('menu-1', { bacon: { packageId: 'p-bac-om', qty: 2, pricePaid: 7.99 } });
  });

  it('Scout_IsToldWhatHappened_AfterSaving', async () => {
    saveActualsAction.mockResolvedValue({ ok: true, applied: 2, held: 1, results: { bacon: 'applied', bread: 'held' } });
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    await user.click(saveBtn());
    expect(await screen.findByText('Saved. 2 prices updated for every patrol, credited to you; 1 held for a leader.')).toBeTruthy();
    expect(saveBtn().textContent).toBe('Prices saved');
    expect(saveBtn().disabled).toBe(true);
  });

  it('Scout_SeesUpdatedAndHeldTags_AfterSaving', async () => {
    saveActualsAction.mockResolvedValue({ ok: true, applied: 1, held: 1, results: { bacon: 'applied', bread: 'held' } });
    const user = userEvent.setup();
    render(tab());
    await typePrice(user, await openPaid(user, 'Bacon'), '19.25');
    await typePrice(user, await openPaid(user, 'Bread'), '9.99');
    await user.click(saveBtn());
    await screen.findByText(/^Saved\./, { selector: 'p' });
    expect(within(paidRow('Bacon')).getByText('✓ Updated')).toBeTruthy();
    expect(within(paidRow('Bread')).getByText('⚑ Held')).toBeTruthy();
  });

  it('Scout_DoesNotSeePricesChanged_AfterTheirOwnPriceApplied', async () => {
    saveActualsAction.mockResolvedValue({ ok: true, applied: 1, held: 0, results: { bacon: 'applied' } });
    const user = userEvent.setup();
    render(tab());
    await typePrice(user, await openPaid(user, 'Bacon'), '19.25');
    await user.click(saveBtn());
    await screen.findByText(/^Saved\./, { selector: 'p' });
    expect(screen.queryByText(/Prices in the troop price book changed/)).toBeNull();
  });

  it('Scout_SeesTheShoppingListUseTheNewPrice_AfterItApplied', async () => {
    saveActualsAction.mockResolvedValue({ ok: true, applied: 1, held: 0, results: { bacon: 'applied' } });
    const user = userEvent.setup();
    render(tab());
    await typePrice(user, await openPaid(user, 'Bacon'), '19.25');
    await user.click(saveBtn());
    await screen.findByText(/^Saved\./, { selector: 'p' });
    expect(screen.getByText('$19.25', { selector: 'div' })).toBeTruthy();
  });

  it('Scout_KeepsTheirEntries_WhenTheSaveFails', async () => {
    saveActualsAction.mockResolvedValue({ ok: false, error: 'That menu isn’t one of yours.' });
    const user = userEvent.setup();
    render(tab());
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    await user.click(saveBtn());
    expect(await screen.findByText('That menu isn’t one of yours.')).toBeTruthy();
    expect(saveBtn().disabled).toBe(false);
    expect(within(row).getByText('1 × $19.25')).toBeTruthy();
  });

  it('Scout_GetsAFriendlyError_WhenTheActionThrows', async () => {
    saveActualsAction.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(tab());
    await typePrice(user, await openPaid(user, 'Bacon'), '19.25');
    await user.click(saveBtn());
    expect(await screen.findByText('Something went wrong saving what you paid. Try again.')).toBeTruthy();
  });

  it('Scout_GoesBackToTheLastSaved_WhenDiscarding', async () => {
    const user = userEvent.setup();
    render(tab(menu({ actuals: { bacon: { packageId: 'p-bac-kirk', qty: 1, pricePaid: 18.15 } } })));
    const row = await openPaid(user, 'Bacon');
    await typePrice(user, row, '19.25');
    await user.click(discardBtn());
    expect(within(row).getByText('1 × $18.15')).toBeTruthy();
    expect((within(row).getByLabelText('Price paid, each') as HTMLInputElement).value).toBe('18.15');
    expect(discardBtn().disabled).toBe(true);
  });

  it('Scout_CanClearALine_AndSaveItWithoutAPrice', async () => {
    const user = userEvent.setup();
    render(tab(menu({ actuals: { bacon: { packageId: 'p-bac-kirk', qty: 1, pricePaid: 18.15 } } })));
    const row = await openPaid(user, 'Bacon');
    await user.clear(within(row).getByLabelText('Price paid, each'));
    expect(saveBtn().disabled).toBe(false);
    await user.click(saveBtn());
    expect(saveActualsAction).toHaveBeenCalledWith('menu-1', {});
  });
});
