import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Attention, type AttentionCounts } from '../src/app/admin/(workspace)/library/menu-monster/attention';
import { Purchases } from '../src/app/admin/(workspace)/library/menu-monster/purchases';
import type { PurchaseOuting } from '../src/lib/menu-monster/purchases';

/** Release 6: admin › Menu Monster › Needs attention and Purchases — what a leader reads, and where each line leads. */

const ZERO: AttentionCounts = { heldPrices: 0, heldPackages: 0, ingredients: 0, editedRecipes: 0, unpriced: 0, drafts: 0, unfinishedOutings: 0 };
const brand = { id: 'b1', name: 'Rice Chex', ingredientId: 'cold-cereal', ingredientName: 'Cold cereal', addedBy: 'Sam K.', createdAt: '2026-10-03T15:00:00.000Z', unpriced: true };

describe('Attention', () => {
  it('NothingWaiting_SaysSo', () => {
    render(<Attention counts={ZERO} brands={[]} />);
    expect(screen.getByText('Nothing needs you right now.')).toBeTruthy();
  });

  it('OnlyKindsWithSomethingWaiting_AreListed', () => {
    render(<Attention counts={{ ...ZERO, heldPrices: 2, unpriced: 1 }} brands={[]} />);
    expect(within(screen.getByRole('list', { name: 'Waiting on a leader' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('EachLine_LinksToTheTabThatHandlesIt', () => {
    render(<Attention counts={{ ...ZERO, unfinishedOutings: 1 }} brands={[]} />);
    expect(screen.getByRole('link', { name: 'Purchases →' }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=purchases');
  });

  it('OneOfAKind_ReadsInTheSingular', () => {
    render(<Attention counts={{ ...ZERO, unpriced: 1 }} brands={[]} />);
    expect(screen.getByText('ingredient has no price')).toBeTruthy();
  });

  it('ATypedBrand_LinksToItsIngredientInThePriceBook', () => {
    render(<Attention counts={ZERO} brands={[brand]} />);
    expect(screen.getByRole('link', { name: 'Rice Chex' }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=prices&ingredient=cold-cereal');
  });

  it('ATypedBrand_ShowsWhoAndThatItHasNoPrice', () => {
    render(<Attention counts={ZERO} brands={[brand]} />);
    const row = screen.getByRole('link', { name: 'Rice Chex' }).closest('tr')!;
    expect([within(row).getByText('Sam K.') != null, within(row).getByText('No price yet') != null]).toEqual([true, true]);
  });
});

const totals = (over: Record<string, unknown> = {}) => ({ planned: 40, paid: 42.5, bought: 3, notBought: 0, unconfirmed: 1, total: 4, projected: true, ...over });
const outing = (menus: PurchaseOuting['menus'], over: Partial<PurchaseOuting> = {}): PurchaseOuting => ({
  id: 7,
  title: 'Fall Camporee',
  startDate: '2026-10-09',
  endDate: '2026-10-11',
  menus,
  planned: 40,
  paid: 42.5,
  projected: true,
  ...over
});
const menu = (over: Record<string, unknown> = {}) => ({ id: 'menu-1', label: 'Screaming Eagles', name: 'Camporee food', planner: 'Charlie W.', totals: totals(), done: null, recordedBy: ['Maya R.'], ...over });

describe('Purchases', () => {
  it('NoOutings_ExplainsHowOneAppears', () => {
    render(<Purchases outings={[]} />);
    expect(screen.getByText(/No menu is linked to an outing yet/)).toBeTruthy();
  });

  it('AMenu_LinksToItsWhatWeBoughtTab', () => {
    render(<Purchases outings={[outing([menu()])]} />);
    expect(screen.getByRole('link', { name: 'Screaming Eagles' }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/bought');
  });

  it('AMenu_ShowsHowManyLinesAreRecorded_AndByWhom', () => {
    render(<Purchases outings={[outing([menu()])]} />);
    expect(screen.getByRole('link', { name: 'Screaming Eagles' }).closest('tr')!.textContent).toContain('3 of 4 · Maya R.');
  });

  it.each([
    ['Not finished', menu()],
    ['Nothing recorded', menu({ totals: totals({ unconfirmed: 4, bought: 0 }), recordedBy: [] })],
    ['Done', menu({ totals: totals({ unconfirmed: 0, projected: false }), done: { by: 'Maya R.', personId: 5, at: '2026-10-12T15:00:00.000Z' } })]
  ])('Status_%s', (label, m) => {
    render(<Purchases outings={[outing([m])]} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('TheOuting_SaysProjected_UntilEveryMenuIsDone', () => {
    render(<Purchases outings={[outing([menu()])]} />);
    expect(screen.getByRole('heading', { name: 'Fall Camporee' }).parentElement!.textContent).toContain('projected $42.50');
  });

  it('TheOuting_LinksToItsShoppingList', () => {
    render(<Purchases outings={[outing([menu()])]} />);
    expect(screen.getByRole('link', { name: 'Outing shopping list →' }).getAttribute('href')).toBe('/library/menu-monster/outings/7');
  });
});
