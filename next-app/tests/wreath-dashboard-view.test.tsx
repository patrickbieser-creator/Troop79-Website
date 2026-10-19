import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SalesDashboardView } from '../src/app/admin/(workspace)/finance/wreaths/sales-dashboard';
import { buildSalesDashboard } from '../src/lib/wreaths/dashboard';
import type { AdminOrder, AdminSeller } from '../src/lib/wreaths/admin-data';

/** Admin › Wreath Sale › Dashboard renders the rollup; "needs a hand" rows link to the Orders tab where the work is. */
const SALE = { scoutShare: 0.3, round1Cutoff: '2026-10-21T04:59:00.000Z', round2Cutoff: '2026-11-11T05:59:00.000Z' };
const NOW = Date.parse('2026-10-16T17:00:00.000Z');
const ANNA: AdminSeller = { id: 1, personId: 100, name: 'Anna A', slug: 'anna', active: true, orders: 1, goal: 10, deliveryMessage: null };
const BEN: AdminSeller = { id: 2, personId: 200, name: 'Ben B', slug: 'ben', active: true, orders: 0, goal: null, deliveryMessage: null };

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 1,
  orderNumber: 'W-1001',
  placedAt: '2026-10-14T15:00:00.000Z',
  round: 1,
  source: 'scout_link',
  fulfillment: 'pickup',
  creditedPersonId: 100,
  creditedName: 'Anna A',
  deliveringPersonId: null,
  customerName: 'C',
  customerEmail: '',
  customerPhone: '',
  customerAddress: '',
  customerCity: '',
  customerZip: '',
  outsideAreaRelative: false,
  itemsSubtotal: 52,
  deliveryFee: 0,
  feeCovered: 0,
  gift: 0,
  total: 52,
  paymentStatus: 'unpaid',
  paidMethod: null,
  paidAt: null,
  paidAmount: null,
  status: 'placed',
  stripeFee: null,
  refundedAt: null,
  needsRefund: null,
  cardStarted: false,
  enteredByPersonId: null,
  enteredByName: null,
  collectedByScout: false,
  paymentNote: '',
  customerNote: '',
  orderNote: '',
  orderNoteBy: null,
  orderNoteAt: null,
  lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16 }],
  ...over
});

const view = (orders: AdminOrder[]) => render(<SalesDashboardView d={buildSalesDashboard({ orders, sellers: [ANNA, BEN], sale: SALE, nowMs: NOW })} />);

describe('SalesDashboardView', () => {
  it('Treasurer_SeesUnpaidOrders_AsALinkToTheFilteredOrdersTab', () => {
    view([order()]);
    expect(screen.getByRole('link', { name: /1 order not paid/ }).getAttribute('href')).toBe('/admin/finance/wreaths?pay=unpaid');
  });

  it('Treasurer_SeesNothingWaiting_WhenEveryOrderIsPaid', () => {
    view([order({ paymentStatus: 'paid', paidMethod: 'venmo' })]);
    expect(screen.getByText(/Nothing waiting/)).toBeTruthy();
  });

  it('Treasurer_SeesHowManyScoutsHaveSold', () => {
    view([order()]);
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('Treasurer_SeesAScoutsGoalProgress', () => {
    view([order()]);
    expect(screen.getByText(/2 of 10/)).toBeTruthy();
  });

  it('Treasurer_SeesDaysLeftInTheRound', () => {
    view([]);
    expect(screen.getByText(/4 days left/)).toBeTruthy();
  });

  it('Treasurer_SeesEmptyStates_BeforeTheFirstOrder', () => {
    view([]);
    expect(screen.getByText('Nothing sold yet.')).toBeTruthy();
  });
});
