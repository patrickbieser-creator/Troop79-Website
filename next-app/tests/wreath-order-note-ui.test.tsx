import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersPanel } from '../src/app/admin/(workspace)/finance/wreaths/orders-panel';
import { MyWreathOrdersView } from '../src/app/(public)/member/wreaths/wreath-orders-view';
import { buildSellerView } from '../src/lib/wreaths/my-orders';
import type { AdminOrder } from '../src/lib/wreaths/admin-data';
import type { PublicSale } from '../src/lib/wreaths/public';

/**
 * W-1 and W-2 on screen (Patrick, 2026-10-19): the troop-only order note in admin and on Members › Wreath sale, and the
 * short / over on the payment pill. Server actions are the mock boundary; tests/wreath-order-note.test.ts covers what
 * they enforce.
 */
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => '/member/wreaths' }));
const memberActions = vi.hoisted(() => ({ note: vi.fn(async (...args: unknown[]) => (void args, { ok: true as const })) }));
vi.mock('../src/app/(public)/member/wreaths/actions', () => ({
  saveScoutOrderAction: vi.fn(),
  cancelScoutOrderAction: vi.fn(),
  setScoutSettingsAction: vi.fn(),
  setOrderNoteAction: memberActions.note
}));
const adminActions = vi.hoisted(() => ({ note: vi.fn(async (...args: unknown[]) => (void args, { ok: true as const })) }));
vi.mock('../src/app/admin/(workspace)/finance/wreaths/actions', () => ({
  cancelOrder: vi.fn(),
  markPaid: vi.fn(),
  editOrder: vi.fn(),
  refundCardOrder: vi.fn(),
  setPaymentNote: vi.fn(),
  setOrderNote: adminActions.note
}));

const ME = 100;
const sale = {
  id: 1, year: 2026, status: 'open', distributionDate: '2026-11-21', distributionWindow: '2:30 to 4:30 PM', distributionPlace: 'Northwoods lot', scoutShare: 0.3, donationShare: 0.15,
  round1Cutoff: '2026-10-26T04:59:00.000Z', round2Cutoff: '2026-11-16T05:59:00.000Z', deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49
} as PublicSale;

function order(id: number, over: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id, orderNumber: `W-${3000 + id}`, placedAt: '2026-10-12T15:00:00.000Z', round: 1, source: 'scout_link', fulfillment: 'pickup',
    creditedPersonId: ME, creditedName: 'Anjali S', deliveringPersonId: null, customerName: `Buyer ${id}`, customerEmail: 'buyer@example.test',
    customerPhone: '414-555-0100', customerAddress: '', customerCity: '', customerZip: '', outsideAreaRelative: false,
    itemsSubtotal: 52, deliveryFee: 0, feeCovered: 0, gift: 0, total: 52, paymentStatus: 'unpaid', paidMethod: null, paidAt: null, paidAmount: null,
    status: 'placed', stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false, enteredByPersonId: null, enteredByName: null,
    collectedByScout: false, paymentNote: '', customerNote: '', orderNote: '', orderNoteBy: null, orderNoteAt: null,
    lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 }],
    ...over
  };
}
const noted = { orderNote: 'Gate code 4412, leave by the garage', orderNoteBy: 'Dan V', orderNoteAt: '2026-10-19T20:00:00.000Z' };
const paidShort = { paymentStatus: 'paid' as const, paidMethod: 'venmo', paidAmount: 47, paidAt: '2026-10-18T15:00:00.000Z' };
const panel = (orders: AdminOrder[]) => render(<OrdersPanel orders={orders} history={{}} sellers={[]} items={[]} rules={sale} />);
const family = (orders: AdminOrder[], canEdit = false) => render(<MyWreathOrdersView data={{ sale, items: [], sellers: [buildSellerView(ME, 'Anjali S', orders, 0.3)] }} canEdit={canEdit} />);

beforeEach(() => {
  adminActions.note.mockClear();
  memberActions.note.mockClear();
  refresh.mockClear();
});

describe('admin orders: the payment pill', () => {
  it('AdminPill_ReadsPaidMethodAndShort', () => {
    panel([order(1, paidShort)]);
    expect(screen.getByText('Paid · Venmo · $5 short')).toBeTruthy();
  });
  it('AdminPill_ReadsOver_WhenMoreCameIn', () => {
    panel([order(1, { ...paidShort, paidMethod: 'cash', paidAmount: 62 })]);
    expect(screen.getByText('Paid · Cash · $10 over')).toBeTruthy();
  });
  it('AdminPill_ReadsJustTheMethod_WhenExact', () => {
    panel([order(1, { ...paidShort, paidAmount: 52 })]);
    expect(screen.getByText('Paid · Venmo')).toBeTruthy();
  });
  it('AdminPill_ReadsJustCard_OnACardOrder', () => {
    panel([order(1, { ...paidShort, paidMethod: 'card', paidAmount: 50 })]);
    expect(screen.getByText('Paid · Card')).toBeTruthy();
  });
  it('AdminPill_ShowsNoAmount_WhenUnpaid', () => {
    panel([order(1)]);
    expect(screen.queryByText(/short|over/)).toBeNull();
  });
});

describe('admin orders: the order note', () => {
  it('AdminList_ShowsTheNoteAsAQuietLine', () => {
    panel([order(1, noted)]);
    expect(screen.getByText('Note: Gate code 4412, leave by the garage')).toBeTruthy();
  });
  it('AdminList_ShowsNoNoteLine_WithoutANote', () => {
    panel([order(1)]);
    expect(screen.queryByText(/^Note:/)).toBeNull();
  });
  it('AdminDetail_ShowsTheNote_AndWhoEditedIt', async () => {
    const user = userEvent.setup();
    panel([order(1, noted)]);
    await user.click(screen.getByRole('button', { name: 'W-3001' }));
    expect([(screen.getByLabelText('Order note') as HTMLTextAreaElement).value, screen.getByText(/Edited by Dan V · Oct 19/).textContent]).toEqual([
      'Gate code 4412, leave by the garage',
      'Edited by Dan V · Oct 19. The scout’s family sees it too; the customer never does.'
    ]);
  });
  it('AdminDetail_NoteSave_IsGreyedUntilChanged', async () => {
    const user = userEvent.setup();
    panel([order(1, noted)]);
    await user.click(screen.getByRole('button', { name: 'W-3001' }));
    const form = screen.getByLabelText('Order note').closest('form')!;
    expect((form.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('AdminDetail_NoteSave_SendsTheNewText', async () => {
    const user = userEvent.setup();
    panel([order(1, { ...paidShort, paidMethod: 'card', paidAmount: 52 })]);
    await user.click(screen.getByRole('button', { name: 'W-3001' }));
    await user.type(screen.getByLabelText('Order note'), 'Customer called');
    const form = screen.getByLabelText('Order note').closest('form')!;
    await user.click(form.querySelector('button') as HTMLButtonElement);
    expect(adminActions.note.mock.calls[0]).toEqual([1, 'Customer called']);
  });
  it('AdminDetail_NoteDiscard_ReturnsTheSavedText', async () => {
    const user = userEvent.setup();
    panel([order(1, noted)]);
    await user.click(screen.getByRole('button', { name: 'W-3001' }));
    await user.type(screen.getByLabelText('Order note'), ' and ring');
    await user.click(screen.getAllByRole('button', { name: 'Discard changes' }).at(-1)!);
    expect((screen.getByLabelText('Order note') as HTMLTextAreaElement).value).toBe('Gate code 4412, leave by the garage');
  });
});

describe('the scout’s order list', () => {
  it('ScoutList_PaidPill_SaysShort', () => {
    family([order(1, paidShort)]);
    expect(screen.getByText('Paid · $5 short')).toBeTruthy();
  });
  it('ScoutList_PaidPill_IsJustPaid_WhenExact', () => {
    family([order(1, { ...paidShort, paidAmount: 52 })]);
    expect(screen.getByText('Paid', { selector: 'span' })).toBeTruthy();
  });
  it('ScoutList_ShowsTheNoteAndStamp_ReadOnly', () => {
    family([order(1, noted)]);
    expect([screen.getByText(/Gate code 4412/).textContent, screen.getByText('Edited by Dan V · Oct 19').tagName]).toEqual(['Troop note: Gate code 4412, leave by the garage', 'P']);
  });
  it('ScoutList_ReadOnly_OffersNoNoteControl', () => {
    family([order(1, noted)]);
    expect(screen.queryByRole('button', { name: /troop note/i })).toBeNull();
  });
  it('ScoutList_Family_CanAddANote', async () => {
    const user = userEvent.setup();
    family([order(1)], true);
    await user.click(screen.getByRole('button', { name: 'Add a troop note to order W-3001' }));
    const form = screen.getByRole('form', { name: 'Troop note on order W-3001' });
    await user.type(within(form).getByRole('textbox', { name: 'Troop note' }), 'Grandma pays at pickup');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(memberActions.note.mock.calls[0]).toEqual([1, 'Grandma pays at pickup']);
  });
  it('ScoutList_NoteSave_IsGreyedUntilChanged', async () => {
    const user = userEvent.setup();
    family([order(1, noted)], true);
    await user.click(screen.getByRole('button', { name: 'Edit the troop note on order W-3001' }));
    const form = screen.getByRole('form', { name: 'Troop note on order W-3001' });
    expect((within(form).getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('ScoutList_NoteControl_IsOnAScoutEnteredOrderToo', () => {
    family([order(1, { source: 'paper', fulfillment: 'scout', deliveringPersonId: ME, ...paidShort })], true);
    expect(screen.getByRole('button', { name: 'Add a troop note to order W-3001' })).toBeTruthy();
  });
  it('ScoutList_NoNoteControl_OnACancelledOrder', () => {
    family([order(1, { status: 'cancelled' })], true);
    expect(screen.queryByRole('button', { name: /troop note/i })).toBeNull();
  });
});
