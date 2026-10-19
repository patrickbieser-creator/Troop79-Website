import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorePage } from '../src/app/(public)/wreaths/_components/store-page';
import { GoalBar } from '../src/app/_components/goal-bar';
import { MyWreathOrdersView } from '../src/app/(public)/member/wreaths/wreath-orders-view';
import { OrdersPanel } from '../src/app/admin/(workspace)/finance/wreaths/orders-panel';
import { buildSellerView } from '../src/lib/wreaths/my-orders';
import { goalProgress } from '../src/lib/wreaths/scout-entry';
import type { AdminOrder } from '../src/lib/wreaths/admin-data';
import type { PublicSale, ScoutLink, StoreItem } from '../src/lib/wreaths/public';
import type { StorePageData } from '../src/lib/wreaths/store-page';

/**
 * Scout-entered orders as people see and drive them: the scout's public page (switch, goal bar, delivery message),
 * Members › Wreath sale (inline edit, locked rows, goal / message form, read-only for a proxying leader) and the
 * admin Orders list. Server actions are the mock boundary; what they enforce is tests/wreath-scout-entry*.test.ts.
 */
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => '/member/wreaths' }));
const actions = vi.hoisted(() => ({
  save: vi.fn(async () => ({ ok: true as const })),
  cancel: vi.fn(async () => ({ ok: true as const })),
  settings: vi.fn(async () => ({ ok: true as const }))
}));
vi.mock('../src/app/(public)/member/wreaths/actions', () => ({
  saveScoutOrderAction: actions.save,
  cancelScoutOrderAction: actions.cancel,
  setScoutSettingsAction: actions.settings
}));
const adminActions = vi.hoisted(() => ({ markPaid: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const })) }));
vi.mock('../src/app/admin/(workspace)/finance/wreaths/actions', () => ({
  cancelOrder: vi.fn(),
  markPaid: adminActions.markPaid,
  editOrder: vi.fn(),
  refundCardOrder: vi.fn(async () => ({ ok: true })),
  setPaymentNote: vi.fn(async () => ({ ok: true }))
}));

const items: StoreItem[] = [
  { id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: '', price: 26, imageUrl: null, section: 'wreaths', donatable: true },
  { id: 12, catalogNumber: 3, name: 'Wreath', size: '36″', description: '', price: 42, imageUrl: null, section: 'wreaths', donatable: false }
];
const sale = {
  id: 1, year: 2026, status: 'open', distributionDate: '2026-11-21', distributionWindow: '2:30 to 4:30 PM', distributionPlace: 'Northwoods lot', scoutShare: 0.3,
  round1Cutoff: '2026-10-26T04:59:00.000Z', round2Cutoff: '2026-11-16T05:59:00.000Z', deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49
} as PublicSale;

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  Object.values(actions).forEach((a) => a.mockClear());
  refresh.mockClear();
});

/* ── the scout's page ─────────────────────────────────────────────────────── */

const scoutLink = (over: Partial<ScoutLink> = {}): ScoutLink => ({ slug: 'oliver-p', name: 'Oliver P.', firstName: 'Oliver', personId: 5, goal: null, deliveryMessage: null, ...over });
const pageData = (scout: ScoutLink | null): StorePageData => ({
  state: { kind: 'open', sale, items, round: 1, cutoff: sale.round1Cutoff, daysLeft: 5, graceCutoff: null },
  scout,
  linkFellBack: false
});
const placeAction = vi.fn(async (...args: unknown[]) => (void args, { ok: true as const, token: 't', orderNumber: 'W-1234', created: true, confirmedTo: ['dana@example.test'] }));

describe('the scout’s public page', () => {
  it('ScoutPage_ShowsTheDeliveryMessage_WhenItIsSet', () => {
    render(<StorePage data={pageData(scoutLink({ deliveryMessage: 'I’ll bring your wreath the week of Nov 22' }))} />);
    expect(screen.getByText('I’ll bring your wreath the week of Nov 22').tagName).toBe('P');
  });
  it('ScoutPage_DropsTheStandardLine_WhenADeliveryMessageIsSet', () => {
    render(<StorePage data={pageData(scoutLink({ deliveryMessage: 'I’ll bring your wreath the week of Nov 22' }))} />);
    expect(screen.queryByText(/delivers your order in person/)).toBeNull();
  });
  it('ScoutPage_ShowsTheStandardLine_WhenTheDeliveryMessageIsEmpty', () => {
    render(<StorePage data={pageData(scoutLink())} />);
    expect(screen.getByText(/delivers your order in person/).textContent).toBe('Oliver delivers your order in person, after distribution day, Saturday, November 21, 2026.');
  });
  it('ScoutPage_HasNoSwitch_ForASignedOutVisitor', () => {
    render(<StorePage data={pageData(scoutLink())} />);
    expect(screen.queryByRole('switch')).toBeNull();
  });
  it('ScoutPage_ShowsTheGoalBar_WhenAGoalIsSet', () => {
    render(<StorePage data={pageData(scoutLink({ goal: 25 }))} goal={goalProgress(25, 12, 'Oliver')} />);
    expect(screen.getByRole('progressbar', { name: '12 of 25 wreaths toward Oliver’s goal' }).getAttribute('aria-valuenow')).toBe('12');
  });
  it('ScoutPage_HidesTheGoalBar_WhenNoGoalIsSet', () => {
    render(<StorePage data={pageData(scoutLink())} goal={goalProgress(null, 12, 'Oliver')} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  describe('GoalBar over the goal', () => {
    beforeEach(() => {
      render(<GoalBar progress={goalProgress(25, 27, 'Oliver')} />);
    });
    it('GoalBar_CapsTheBarValueAtTheGoal', () => {
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    });
    it('GoalBar_KeepsTheMaxAtTheGoal', () => {
      expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('25');
    });
    it('GoalBar_KeepsCountingTheText', () => {
      expect(screen.getByText('27 of 25 wreaths').tagName).toBe('STRONG');
    });
  });
  it('GoalBar_SetsNoInlineWidth', () => {
    const { container } = render(<GoalBar progress={goalProgress(25, 12, 'Oliver')} />);
    expect(container.querySelector('[style]')).toBeNull();
  });

  describe('the switch', () => {
    const open = async () => {
      window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 2 }, seller: null }));
      const user = userEvent.setup();
      render(<StorePage data={pageData(scoutLink())} entry={{ action: placeAction, initialOn: false }} />);
      return user;
    };
    it('ScoutPage_OffersTheSwitch_ToTheScoutOrAParent', async () => {
      await open();
      expect(screen.getByRole('switch', { name: /Order for someone I know/ }).getAttribute('aria-checked')).toBe('false');
    });
    it('ScoutPage_KeepsTheNormalCheckout_WhileTheSwitchIsOff', async () => {
      await open();
      expect(screen.getAllByRole('link', { name: 'Checkout' }).length).toBeGreaterThan(0);
    });
    it('ScoutPage_ReplacesCheckout_WhenTheSwitchIsOn', async () => {
      const user = await open();
      await user.click(screen.getByRole('switch'));
      expect(screen.queryByRole('link', { name: 'Checkout' })).toBeNull();
    });
    it('ScoutPage_ShowsTheCustomerNameField_WhenTheSwitchIsOn', async () => {
      const user = await open();
      await user.click(screen.getByRole('switch'));
      expect(screen.getByLabelText('Customer name').tagName).toBe('INPUT');
    });
    it.each([/street/i, /zip/i, /delivery fee/i, /venmo/i, /processing fee/i])('ScoutPage_ShowsNoAddressFeeOrPaymentInstructions_%s', async (absent) => {
      const user = await open();
      await user.click(screen.getByRole('switch'));
      expect(screen.queryByText(absent)).toBeNull();
    });
  });
  describe('the entry form', () => {
    const fillCart = () => window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 2 }, seller: null }));
    it('EntryForm_MarksAMissingNameInPlace_WithTheReason', async () => {
      fillCart();
      const user = userEvent.setup();
      render(<StorePage data={pageData(scoutLink())} entry={{ action: placeAction, initialOn: true }} />);
      await user.click(await screen.findByRole('button', { name: /Place order/ }));
      expect(screen.getAllByText(/Add the customer’s name/).length).toBeGreaterThan(0);
    });
    it('EntryForm_OutlinesTheNameField_WhenItIsMissing', async () => {
      fillCart();
      const user = userEvent.setup();
      render(<StorePage data={pageData(scoutLink())} entry={{ action: placeAction, initialOn: true }} />);
      await user.click(await screen.findByRole('button', { name: /Place order/ }));
      expect(screen.getByLabelText('Customer name').getAttribute('aria-invalid')).toBe('true');
    });
    it('EntryForm_SendsNothing_WhenTheNameIsMissing', async () => {
      fillCart();
      const user = userEvent.setup();
      placeAction.mockClear();
      render(<StorePage data={pageData(scoutLink())} entry={{ action: placeAction, initialOn: true }} />);
      await user.click(await screen.findByRole('button', { name: /Place order/ }));
      expect(placeAction).not.toHaveBeenCalled();
    });
    describe('after a good submit', () => {
      beforeEach(async () => {
        fillCart();
        const user = userEvent.setup();
        placeAction.mockClear();
        render(<StorePage data={pageData(scoutLink())} entry={{ action: placeAction, initialOn: true }} />);
        await user.type(await screen.findByLabelText('Customer name'), 'Grandma Sue');
        await user.click(screen.getByRole('button', { name: 'Collected' }));
        await user.type(screen.getByLabelText(/Payment note/), 'Cash at the meeting');
        await user.click(screen.getByRole('button', { name: /Place order/ }));
        await waitFor(() => expect(placeAction).toHaveBeenCalled());
      });
      it('EntryForm_SendsTheNameCollectedPaymentNoteAndLines', () => {
        expect((placeAction.mock.calls as unknown[][])[0][0]).toMatchObject({ sellerSlug: 'oliver-p', customer: { name: 'Grandma Sue' }, collected: true, paymentNote: 'Cash at the meeting', lines: [{ itemId: 11, quantity: 2, donated: false }] });
      });
      it('EntryForm_ShowsTheOrderNumber_OnTheConfirmation', async () => {
        expect((await screen.findByText('Order W-1234 is in')).tagName).toBe('H1');
      });
      it('EntryForm_SaysTheCustomerWasNotEmailed', async () => {
        expect((await screen.findByText(/No email went to Grandma Sue/)).tagName).toBe('STRONG');
      });
    });
  });
});

/* ── Members › Wreath sale ────────────────────────────────────────────────── */

const ME = 100;
function order(id: number, over: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id, orderNumber: `W-${2000 + id}`, placedAt: '2026-10-12T15:00:00.000Z', round: 1, source: 'paper', fulfillment: 'scout', creditedPersonId: ME, creditedName: 'Oliver P',
    deliveringPersonId: ME, customerName: `Customer ${id}`, customerEmail: '', customerPhone: '', customerAddress: '', customerCity: '', customerZip: '', outsideAreaRelative: false,
    itemsSubtotal: 52, deliveryFee: 0, feeCovered: 0, gift: 0, total: 52, paymentStatus: 'unpaid', paidMethod: null, paidAt: null, paidAmount: null, status: 'placed', stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false,
    enteredByPersonId: ME, enteredByName: 'Oliver Prescott', collectedByScout: false, paymentNote: '', customerNote: '',
 orderNote: '',
 orderNoteBy: null,
 orderNoteAt: null,
    lines: [{ itemId: 11, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 }],
    ...over
  };
}
const NOW = Date.parse('2026-10-20T15:00:00.000Z');
const lock = { sale: { status: 'open' as const, round1Cutoff: sale.round1Cutoff, round2Cutoff: sale.round2Cutoff }, nowMs: NOW };
const data = (orders: AdminOrder[], extra: { goal?: number | null; deliveryMessage?: string | null; nowMs?: number } = {}) => ({
  sale,
  items,
  sellers: [buildSellerView(ME, 'Oliver Prescott', orders, 0.3, { slug: 'oliver-p', goal: extra.goal ?? null, deliveryMessage: extra.deliveryMessage ?? null, lock: { ...lock, nowMs: extra.nowMs ?? NOW } })]
});

describe('Members › Wreath sale', () => {
  it('MemberWreaths_ShowsNoControlAtAll_ToAProxyingLeader', () => {
    const { container } = render(<MyWreathOrdersView data={data([order(1)], { goal: 25 })} />);
    expect(container.querySelector('form, input, textarea, select')).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit|Mark collected|Save/ })).toBeNull();
  });
  describe('a collected order with a payment note', () => {
    beforeEach(() => {
      render(<MyWreathOrdersView data={data([order(1, { collectedByScout: true, paymentNote: 'Cash at the 10/18 meeting' })])} canEdit />);
    });
    it('MemberWreaths_ShowsTheOrderAsCollected', () => {
      expect(screen.getByText('Collected', { selector: 'span' }).textContent).toBe('Collected');
    });
    it('MemberWreaths_ShowsThePaymentNote', () => {
      expect(screen.getByText('Payment: Cash at the 10/18 meeting').tagName).toBe('P');
    });
  });
  it.each(['Mark collected', 'Edit'])('MemberWreaths_Offers_%s_OnAnEditableOrder', (name) => {
    render(<MyWreathOrdersView data={data([order(1)])} canEdit />);
    expect(screen.getByRole('button', { name }).textContent).toBe(name);
  });
  it('MemberWreaths_SaysWhyARowIsLocked_Paid', () => {
    render(<MyWreathOrdersView data={data([order(1, { paymentStatus: 'paid' })])} canEdit />);
    expect(screen.getByText('Paid. Ask a troop leader to change it.').tagName).toBe('SPAN');
  });
  it('MemberWreaths_OffersNoEdit_OnALockedRow', () => {
    render(<MyWreathOrdersView data={data([order(1, { paymentStatus: 'paid' })])} canEdit />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
  it('MemberWreaths_LocksARow_AfterItsRoundsCutoff', () => {
    render(<MyWreathOrdersView data={data([order(1)], { nowMs: Date.parse('2026-10-28T15:00:00.000Z') })} canEdit />);
    expect(screen.getByText(/^Round 1 closed/).textContent).toBe('Round 1 closed Sun, Oct 25. Ask a troop leader to change it.');
  });
  describe('the open editor', () => {
    const openEditor = async () => {
      const user = userEvent.setup();
      render(<MyWreathOrdersView data={data([order(1)])} canEdit />);
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      return { user, form: screen.getByRole('form', { name: /Edit order/ }) };
    };
    it('MemberWreaths_Save_IsGreyedAndSaysSaved_UntilTheDraftChanges', async () => {
      const { form } = await openEditor();
      expect(within(form).getByRole('button', { name: 'Saved' })).toHaveProperty('disabled', true);
    });
    it('MemberWreaths_Save_SaysSaveChangesAndIsEnabled_OnceTheDraftChanges', async () => {
      const { user, form } = await openEditor();
      await user.type(within(form).getByLabelText(/Payment note/), 'Venmo 10/20');
      expect(within(form).getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false);
    });
    it('MemberWreaths_Discard_RestoresTheLastSavedValue', async () => {
      const { user, form } = await openEditor();
      await user.type(within(form).getByLabelText(/Payment note/), 'Venmo 10/20');
      await user.click(within(form).getByRole('button', { name: 'Discard changes' }));
      expect((within(form).getByLabelText(/Payment note/) as HTMLInputElement).value).toBe('');
    });
    it('MemberWreaths_Discard_GreysSaveAgain', async () => {
      const { user, form } = await openEditor();
      await user.type(within(form).getByLabelText(/Payment note/), 'Venmo 10/20');
      await user.click(within(form).getByRole('button', { name: 'Discard changes' }));
      expect(within(form).getByRole('button', { name: 'Saved' })).toHaveProperty('disabled', true);
    });
    describe('with the name cleared', () => {
      beforeEach(async () => {
        const { user, form } = await openEditor();
        await user.clear(within(form).getByLabelText('Customer name'));
        await user.click(within(form).getByRole('button', { name: 'Save changes' }));
      });
      it('MemberWreaths_Save_MarksTheBlankNameInPlace', () => {
        expect(screen.getByLabelText('Customer name').getAttribute('aria-invalid')).toBe('true');
      });
      it('MemberWreaths_Save_SaysWhyBesideTheButton', () => {
        expect(screen.getByRole('alert').textContent).toContain('Can’t save yet: Add the customer’s name');
      });
      it('MemberWreaths_Save_SendsNothing_WhenTheNameIsBlank', () => {
        expect(actions.save).not.toHaveBeenCalled();
      });
    });
  });
  it('MemberWreaths_Save_SendsTheEditedOrder', async () => {
    const user = userEvent.setup();
    render(<MyWreathOrdersView data={data([order(1)])} canEdit />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: /Edit order/ });
    await user.click(within(form).getByRole('button', { name: 'Collected' }));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    expect((actions.save.mock.calls as unknown[][])[0][0]).toMatchObject({ orderId: 1, collected: true, customer: { name: 'Customer 1' } });
  });
  it('MemberWreaths_MarkCollected_OpensTheEditorWithCollectedChosen', async () => {
    const user = userEvent.setup();
    render(<MyWreathOrdersView data={data([order(1)])} canEdit />);
    await user.click(screen.getByRole('button', { name: 'Mark collected' }));
    const form = screen.getByRole('form', { name: /Edit order/ });
    expect(within(form).getByRole('button', { name: 'Collected' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('MemberWreaths_CancelOrder_AsksFirst', async () => {
    const user = userEvent.setup();
    render(<MyWreathOrdersView data={data([order(1)])} canEdit />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(actions.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, cancel the order' }));
    await waitFor(() => expect(actions.cancel).toHaveBeenCalledWith(1));
  });
  it('MemberWreaths_ShowsTheGoalBar_OnlyWhenAGoalIsSet_AndCountsLiveOrdersOnly', () => {
    const { rerender } = render(<MyWreathOrdersView data={data([order(1), order(2, { status: 'cancelled' })], { goal: 25 })} />);
    expect(screen.getByRole('progressbar', { name: '2 of 25 wreaths toward Oliver’s goal' })).toBeTruthy();
    rerender(<MyWreathOrdersView data={data([order(1)])} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  it('MemberWreaths_GoalAndMessageForm_SaveIsDirtyGated_AndSendsBothFields', async () => {
    const user = userEvent.setup();
    render(<MyWreathOrdersView data={data([], { goal: 10, deliveryMessage: 'Sunday' })} canEdit />);
    const form = screen.getByRole('form', { name: /goal and delivery message/ });
    expect(within(form).getByRole('button', { name: 'Saved' })).toHaveProperty('disabled', true);
    await user.clear(within(form).getByLabelText(/^Goal/));
    await user.type(within(form).getByLabelText(/^Goal/), '30');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(actions.settings).toHaveBeenCalledWith(ME, { goal: '30', deliveryMessage: 'Sunday' }));
  });
  it('MemberWreaths_GoalAndMessageForm_IsAbsent_ForAProxyingLeader', () => {
    render(<MyWreathOrdersView data={data([], { goal: 10, deliveryMessage: 'Sunday' })} />);
    expect(screen.queryByRole('form', { name: /goal and delivery message/ })).toBeNull();
  });
});

/* ── Admin › Wreath Sale › Orders ─────────────────────────────────────────── */

describe('Admin orders', () => {
  const orders = [order(1, { collectedByScout: true, paymentNote: 'Cash at the 10/18 meeting' })];
  it('AdminOrders_ShowsACollectedByScoutBadge', () => {
    render(<OrdersPanel orders={orders} history={{}} sellers={[]} items={[]} rules={sale} />);
    expect(screen.getAllByText('Collected by scout')[0].textContent).toBe('Collected by scout');
  });
  it('AdminOrders_NamesWhoEnteredTheOrder_InTheDetail', async () => {
    const user = userEvent.setup();
    render(<OrdersPanel orders={orders} history={{}} sellers={[]} items={[]} rules={sale} />);
    await user.click(screen.getByRole('button', { name: 'W-2001' }));
    expect(screen.getByText('Scout-entered by Oliver Prescott').tagName).toBe('DD');
  });
  // Patrick, 2026-10-18: the open order says who gets the credit and how it is delivered.
  it('AdminOrders_DetailShowsTheCreditedScoutAndTheDelivery', async () => {
    const user = userEvent.setup();
    render(<OrdersPanel orders={[order(1, { source: 'store', fulfillment: 'delivery', deliveringPersonId: null })]} history={{}} sellers={[]} items={[]} rules={sale} />);
    await user.click(screen.getByRole('button', { name: 'W-2001' }));
    const dd = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
    expect([dd('Credited to'), dd('Delivery')]).toEqual(['Oliver P', 'Troop delivery']);
  });
  it('AdminOrders_ShowsThePaymentNote_InAnEditableField', async () => {
    const user = userEvent.setup();
    render(<OrdersPanel orders={orders} history={{}} sellers={[]} items={[]} rules={sale} />);
    await user.click(screen.getByRole('button', { name: 'W-2001' }));
    expect((screen.getByLabelText('Payment note') as HTMLInputElement).value).toBe('Cash at the 10/18 meeting');
  });
});

/* ── Admin › Orders: an order accepted a little short (Patrick, 2026-10-18, W-1022) ── */

describe('Admin orders — amount received', () => {
  const open = async (o: AdminOrder) => {
    const user = userEvent.setup();
    render(<OrdersPanel orders={[o]} history={{}} sellers={[]} items={[]} rules={sale} />);
    await user.click(screen.getByRole('button', { name: o.orderNumber }));
    return user;
  };

  it('AdminOrders_MarkPaid_StartsAtTheOrderTotal', async () => {
    await open(order(1, { source: 'store', total: 52 }));
    expect((screen.getByLabelText('Amount received') as HTMLInputElement).value).toBe('52.00');
  });

  it('AdminOrders_MarkPaid_SendsTheAmountReceived', async () => {
    adminActions.markPaid.mockClear();
    const user = await open(order(1, { source: 'store', total: 52 }));
    await user.clear(screen.getByLabelText('Amount received'));
    await user.type(screen.getByLabelText('Amount received'), '50');
    await user.click(screen.getByRole('button', { name: 'Mark $50.00 paid' }));
    expect(adminActions.markPaid.mock.calls[0]).toEqual([1, 'venmo', 50]);
  });

  it('AdminOrders_MarkPaid_NamesTheShortfallBeforeSaving', async () => {
    const user = await open(order(1, { source: 'store', total: 52 }));
    await user.clear(screen.getByLabelText('Amount received'));
    await user.type(screen.getByLabelText('Amount received'), '50');
    expect(screen.getByText(/\$2\.00 short/)).toBeTruthy();
  });

  it('AdminOrders_ShortPaidOrder_ReadsAsAcceptedNotStillDue', async () => {
    await open(order(1, { source: 'store', total: 52, paymentStatus: 'paid', paidMethod: 'venmo', paidAmount: 50 }));
    expect([screen.queryByText(/more is due/), screen.getByText(/Accepted \$2\.00 short/)].map(Boolean)).toEqual([false, true]);
  });
});

/* ── Admin › Orders: card payments (Release B, Plans/Wreath-Stripe-Checkout.md) ── */

describe('Admin orders — card payments', () => {
  const open = async (o: AdminOrder) => {
    const user = userEvent.setup();
    render(<OrdersPanel orders={[o]} history={{}} sellers={[]} items={[]} rules={sale} />);
    await user.click(screen.getByRole('button', { name: o.orderNumber }));
    return user;
  };

  // Patrick, 2026-10-16: an order whose customer walked away from Stripe read like any other unpaid order.
  it('AdminOrders_MarksAnUnpaidOrder_WhoseCardPaymentWasNotFinished', () => {
    render(<OrdersPanel orders={[order(1, { source: 'store', cardStarted: true })]} history={{}} sellers={[]} items={[]} rules={sale} />);
    expect(screen.getByText('Card not finished')).toBeTruthy();
  });

  it('AdminOrders_DoesNotMarkAPaidCardOrder_AsNotFinished', () => {
    render(<OrdersPanel orders={[order(1, { source: 'store', cardStarted: true, paymentStatus: 'paid', paidMethod: 'card' })]} history={{}} sellers={[]} items={[]} rules={sale} />);
    expect(screen.queryByText('Card not finished')).toBeNull();
  });

  it('AdminOrders_ShowsTheStripeFee_OnACardPaidOrder', async () => {
    await open(order(1, { paymentStatus: 'paid', paidMethod: 'card', paidAmount: 52, stripeFee: 1.81 }));
    expect(screen.getByText(/Stripe fee \$1\.81/)).toBeTruthy();
  });

  it('AdminOrders_FlaggedCardPayment_OffersTheRefundButton', async () => {
    await open(order(1, { needsRefund: 'Card payment arrived for an order already marked paid.' }));
    expect(screen.getByRole('button', { name: 'Refund the card payment' })).toBeTruthy();
  });

  it('AdminOrders_CancellingACardPaidOrder_SaysItRefundsTheCard', async () => {
    const user = await open(order(1, { paymentStatus: 'paid', paidMethod: 'card', paidAmount: 52 }));
    await user.click(screen.getByRole('button', { name: 'Cancel order…' }));
    expect(await screen.findByRole('button', { name: 'Refund $52.00 and cancel' })).toBeTruthy();
  });

  it('AdminOrders_RefundedOrder_SaysSo', async () => {
    await open(order(1, { paymentStatus: 'refunded', paidMethod: 'card', paidAmount: 52, status: 'cancelled', refundedAt: '2026-10-20T15:00:00Z' }));
    expect(screen.getByText(/Refunded \$52\.00 to the card/)).toBeTruthy();
  });
});
