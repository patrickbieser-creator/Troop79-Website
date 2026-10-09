import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Receipt — "Planned vs bought" (Plans/Menu-Monster-Receipt-Reconciliation.md, v1.208.0). Part A works the
 * receipt's lines one at a time (Jenna's model: one tight list, a disclosure per row, only the first unsettled line
 * open, writes on each Confirm); Part B shows every meal as planned beside as bought. The mock boundary is the
 * receipt actions.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const confirmReceiptLineAction = vi.fn();
const markReceiptLineExtraAction = vi.fn();
const reopenReceiptLineAction = vi.fn();
const skipReceiptLineAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/receipt-actions', () => ({
  confirmReceiptLineAction: (...a: unknown[]) => confirmReceiptLineAction(...a),
  markReceiptLineExtraAction: (...a: unknown[]) => markReceiptLineExtraAction(...a),
  reopenReceiptLineAction: (...a: unknown[]) => reopenReceiptLineAction(...a),
  skipReceiptLineAction: (...a: unknown[]) => skipReceiptLineAction(...a)
}));

import { ReceiptTab } from '../src/app/(public)/library/menu-monster/menus/_components/receipt-tab';
import type { Bought } from '../src/lib/menu-monster/bought';
import type { Receipt, ReceiptLine } from '../src/lib/menu-monster/reconcile';
import type { Brand, Catalog, Package } from '../src/lib/menu-monster/types';
import type { Menu } from '../src/lib/menu-monster/menus';

const pkg = (id: string, ingredientId: string, brandId: string | null, price: number, y: number, size: string): Package => ({
  id, ingredientId, name: id, store: null, price, anchorPrice: price, yield: y, yieldUnitLabel: null, noun: 'box',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-10-01', brandId, sizeLabel: size
});
const brand = (id: string, ingredientId: string, name: string): Brand => ({ id, ingredientId, name, avoid: null });
const cup = { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' as const };
const CATALOG: Catalog = {
  ingredients: [
    { id: 'cereal', name: 'Cold cereal', unit: cup, section: 'dry', staple: false, avoid: [] },
    { id: 'milk', name: 'Milk', unit: cup, section: 'dairy', staple: false, avoid: [] },
    { id: 'oj', name: 'Orange juice', unit: cup, section: 'dairy', staple: false, avoid: [] }
  ],
  packages: [
    pkg('p-chex', 'cereal', 'b-chex', 6.5, 18, '18 oz'),
    pkg('p-milk', 'milk', null, 5, 16, 'gallon'),
    pkg('p-oj', 'oj', 'b-tropicana', 4.5, 8, '64 oz')
  ],
  conversions: [],
  recipes: [
    {
      id: 'cereal', name: 'Cold cereal', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
      lines: [
        { ingredientId: 'cereal', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: 'milk', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
      ]
    },
    {
      id: 'oj', name: 'Orange juice', status: 'published', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 1,
      lines: [{ ingredientId: 'oj', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
    }
  ],
  brands: [brand('b-chex', 'cereal', 'Rice Chex'), brand('b-tropicana', 'oj', 'Tropicana')]
};
const MENU: Menu = {
  name: 'Fall Campout', context: 'camp', calendarEntryId: 35, startDate: '2026-10-10', headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands: { cereal: [{ brandId: 'b-chex', qty: null }], oj: [{ brandId: 'b-tropicana', qty: null }] } },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['cereal', 'oj'], recipeEdits: {} }]
};
const NONE: Bought = { lines: {}, done: null };

const line = (id: number, rawName: string, over: Partial<ReceiptLine> = {}): ReceiptLine => ({
  id, position: id, rawName, storeCode: null, unitPrice: 4.15, qty: 1, taxCode: null, proposedIngredientId: null,
  status: 'pending', ingredientId: null, mealId: null, label: null, confirmedBy: null, confirmedAt: null, ...over
});
const LINES: ReceiptLine[] = [
  line(1, 'FC OJ No Pulp', { qty: 6, proposedIngredientId: 'oj' }),
  line(2, 'Corn/Rice Squares', { unitPrice: 3.19, qty: 2, proposedIngredientId: 'cereal' }),
  line(3, 'Whole Milk', { unitPrice: 3.05, proposedIngredientId: 'milk' }),
  line(4, 'Gluten Free Mix', { unitPrice: 3.99, qty: 6 }),
  line(5, 'Cheerios Mid', { unitPrice: 4.99, status: 'confirmed', ingredientId: 'cereal', confirmedBy: 'Mindy S.', confirmedAt: '2026-10-08T23:30:00Z' }),
  line(6, 'Fr Grn Beans', { unitPrice: 1.89, status: 'extra', mealId: 'm1', label: 'French green beans', confirmedBy: 'Mindy S.', confirmedAt: '2026-10-08T23:31:00Z' })
];
const RECEIPT: Receipt = { id: 'r1', menuId: 'menu-1', store: 'Aldi #40', boughtAt: '2026-10-09T00:03:00Z', subtotal: 95, tax: 5, total: 100, itemCount: 18, lines: LINES };
const withLines = (f: (l: ReceiptLine) => ReceiptLine): Receipt => ({ ...RECEIPT, lines: LINES.map(f) });

const tab = (over: Partial<Parameters<typeof ReceiptTab>[0]> = {}) => (
  <ReceiptTab catalog={CATALOG} menuId="menu-1" menu={MENU} receipt={RECEIPT} bought={NONE} canRecord {...over} />
);
const rowFor = (name: string) => document.querySelector(`li[data-line="${LINES.find((l) => l.rawName === name)!.id}"]`) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  confirmReceiptLineAction.mockImplementation(async () => ({
    ok: true,
    receipt: withLines((l) => (l.id === 1 ? { ...l, status: 'confirmed', ingredientId: 'oj', confirmedBy: 'Mindy S.' } : l)),
    bought: NONE
  }));
  markReceiptLineExtraAction.mockImplementation(async () => ({
    ok: true,
    receipt: withLines((l) => (l.id === 1 ? { ...l, status: 'extra', mealId: 'm1', label: 'FC OJ No Pulp', confirmedBy: 'Mindy S.' } : l)),
    bought: NONE
  }));
  reopenReceiptLineAction.mockImplementation(async () => ({ ok: true, receipt: withLines((l) => (l.id === 5 ? { ...l, status: 'pending', ingredientId: null, confirmedBy: null } : l)), bought: NONE }));
});

describe('Receipt — the lines, one at a time', () => {
  it('OnlyTheFirstPendingLine_IsOpen_OnLoad', () => {
    render(tab());
    const open = within(screen.getByRole('list', { name: 'Receipt lines' }))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-expanded') === 'true');
    expect(open.map((b) => b.textContent)).toEqual(['FC OJ No Pulp›']);
    expect(screen.getByText(/Looks like/).textContent).toContain('Orange juice');
    expect(screen.getByText(/Looks like/).textContent).toContain('planned 1 × $4.50');
  });

  it('Confirm_CollapsesTheRow_AndMovesFocusToTheNextPending', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(confirmReceiptLineAction).toHaveBeenCalledWith('menu-1', 1, 'oj');
    await waitFor(() => expect(rowFor('FC OJ No Pulp').textContent).toContain('Orange juice · confirmed by Mindy S.'));
    expect(within(rowFor('FC OJ No Pulp')).getByRole('button', { name: /^FC OJ No Pulp/ }).getAttribute('aria-expanded')).toBe('false');
    const next = within(rowFor('Corn/Rice Squares')).getByRole('button', { name: 'Confirm' });
    expect(document.activeElement).toBe(next);
    expect(screen.getByRole('status').textContent).toContain('Orange juice confirmed. Next: Corn/Rice Squares.');
  });

  it('AnUnidentifiedLine_OpensOnTheFoodPicker_WithNoConfirm', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(within(rowFor('Gluten Free Mix')).getByRole('button', { name: /^Gluten Free Mix/ }));
    const li = rowFor('Gluten Free Mix');
    expect(within(li).getByText('Needs a food')).toBeTruthy();
    expect(within(li).getByLabelText('Which food is this?')).toBeTruthy();
    expect(within(li).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(li).queryByText(/Looks like/)).toBeNull();
  });

  it('NotOnThePlan_AsksForTheMeal_ThenAddsAnExtra', async () => {
    const user = userEvent.setup();
    render(tab());
    await user.click(screen.getByRole('button', { name: 'Not on the plan' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('FC OJ No Pulp');
    await user.selectOptions(screen.getByLabelText('Which meal did it join?'), 'm1');
    await user.click(screen.getByRole('button', { name: 'Add to this meal' }));
    expect(markReceiptLineExtraAction).toHaveBeenCalledWith('menu-1', 1, 'm1', 'FC OJ No Pulp');
    await waitFor(() => expect(rowFor('FC OJ No Pulp').textContent).toMatch(/\+ ?FC OJ No Pulp · Saturday breakfast · Mindy S\./));
  });

  it('ASettledRow_HasUndo', async () => {
    const user = userEvent.setup();
    render(tab());
    expect(rowFor('Cheerios Mid').textContent).toContain('Cold cereal · confirmed by Mindy S.');
    await user.click(within(rowFor('Cheerios Mid')).getByRole('button', { name: /Undo/ }));
    expect(reopenReceiptLineAction).toHaveBeenCalledWith('menu-1', 5);
  });

  it('AViewer_SeesRows_WithoutButtons', () => {
    render(tab({ canRecord: false }));
    const list = screen.getByRole('list', { name: 'Receipt lines' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(list.textContent).toContain('Gluten Free Mix');
    expect(list.textContent).toContain('Cold cereal · confirmed by Mindy S.');
    expect(screen.queryByText('Each line saves as you confirm it.')).toBeNull();
  });
});

describe('Receipt — planned vs bought', () => {
  const swapped: Bought = { lines: { cereal: { status: 'bought', items: [{ brandId: null, packageId: null, qty: 1, pricePaid: 5.5 }], by: 'Mindy S.', personId: 1, at: '2026-10-08T23:30:00Z' } }, done: null };

  it('PlannedVsBought_TagsAChangedLine_InWords', () => {
    render(tab({ bought: swapped }));
    const table = screen.getByRole('table', { name: /Saturday breakfast/ });
    const cereal = within(table).getByText('Cold cereal').closest('tr') as HTMLElement;
    expect(cereal.textContent).toContain('1 × $5.50 = $5.50');
    expect(cereal.textContent).toContain('swapped');
    // An untouched food reads as planned and carries no tag.
    const oj = within(table).getByText('Orange juice').closest('tr') as HTMLElement;
    expect(oj.textContent).toContain('as planned · not confirmed');
    expect(oj.textContent).not.toMatch(/swapped|more|fewer|cheaper|dearer|add-on/);
  });

  it('PlannedVsBought_ListsAnExtra_OnItsMeal', () => {
    render(tab());
    const table = screen.getByRole('table', { name: /Saturday breakfast/ });
    const extra = within(table).getByText('French green beans').closest('tr') as HTMLElement;
    expect(extra.textContent).toContain('1 × $1.89 = $1.89');
    expect(extra.textContent).toContain('add-on');
  });

  it('TheTotalsRow_NamesTheGap_WhenLinesAreUnsettled', () => {
    render(tab());
    expect(screen.getByText(/Receipt \$100\.00/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '4 lines not settled' });
    expect(link.getAttribute('href')).toMatch(/^#/);
  });
});
