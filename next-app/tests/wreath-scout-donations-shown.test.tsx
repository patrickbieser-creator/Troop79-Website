import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StorePage } from '../src/app/(public)/wreaths/_components/store-page';
import { MyWreathOrdersView } from '../src/app/(public)/member/wreaths/wreath-orders-view';
import { buildSellerView, orderItemsText } from '../src/lib/wreaths/my-orders';
import { moneyBlockLines } from '../src/lib/wreaths/copy';
import { goalProgress } from '../src/lib/wreaths/scout-entry';
import type { AdminOrder } from '../src/lib/wreaths/admin-data';
import type { PublicSale, ScoutLink, StoreItem } from '../src/lib/wreaths/public';
import type { StorePageData } from '../src/lib/wreaths/store-page';

/**
 * Patrick, 2026-10-19: "The donation information needs to show up on the Scout's Personal page." Lily had a $100
 * donation-only order and her page showed nothing of it. The goal stays in wreaths; donations raised show under it,
 * the money box names the donation share, and Members › My wreath orders totals donations. Amounts only, no donors.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/member/wreaths' }));
vi.mock('../src/app/(public)/member/wreaths/actions', () => ({ saveScoutOrderAction: vi.fn(), cancelScoutOrderAction: vi.fn(), setScoutSettingsAction: vi.fn() }));

const items: StoreItem[] = [{ id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: '', price: 26, imageUrl: null, section: 'wreaths', donatable: false }];
const sale = {
  id: 1, year: 2026, status: 'open', distributionDate: '2026-11-21', distributionWindow: '2:30 to 4:30 PM', distributionPlace: 'Lot', scoutShare: 0.3, donationShare: 0.15,
  round1Cutoff: '2026-10-26T04:59:00.000Z', round2Cutoff: '2026-11-16T05:59:00.000Z', deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49
} as PublicSale;
const lily: ScoutLink = { slug: 'lily-p', name: 'Lily P.', firstName: 'Lily', personId: 2, goal: null, deliveryMessage: null };
const page = (scout: ScoutLink | null): StorePageData => ({ state: { kind: 'open', sale, items, round: 1, cutoff: sale.round1Cutoff, daysLeft: 5, graceCutoff: null }, scout, linkFellBack: false });

describe('the scout’s personal page', () => {
  it('ScoutPage_ShowsDonationsRaised_EvenWithNoGoal', () => {
    render(<StorePage data={page(lily)} goal={null} donations={100} />);
    expect(screen.getByText('$100 in donations so far')).toBeTruthy();
  });

  it('ScoutPage_ShowsDonationsUnderTheGoalBar', () => {
    render(<StorePage data={page({ ...lily, goal: 20 })} goal={goalProgress(20, 3, 'Lily')} donations={100} />);
    expect([screen.getByText(/3 of 20 wreaths/) !== null, screen.getByText('Plus $100 in donations') !== null]).toEqual([true, true]);
  });

  it('ScoutPage_SaysNothingAboutDonations_WhenThereAreNone', () => {
    render(<StorePage data={page(lily)} goal={null} donations={0} />);
    expect(screen.queryByText(/in donations/)).toBeNull();
  });

  it('ScoutPage_MoneyBox_NamesTheDonationShare_FromTheSaleSetting', () => {
    render(<StorePage data={page(lily)} goal={null} donations={0} />);
    expect(screen.getByText('Donations to Troop 79: 15% goes into Lily’s scout account, after card fees.')).toBeTruthy();
  });

  it('GeneralStore_MoneyBox_HasNoScoutDonationLine', () => {
    expect(moneyBlockLines(null, { scoutShare: 0.3, donationShare: 0.15 }).some((l) => l.startsWith('Donations to Troop 79'))).toBe(false);
  });
});

const ME = 100;
function order(id: number, over: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id, orderNumber: `W-${1000 + id}`, placedAt: '2026-10-12T15:00:00.000Z', round: 1, source: 'scout_link', fulfillment: 'scout', creditedPersonId: ME, creditedName: 'Lily P',
    deliveringPersonId: ME, customerName: `Buyer ${id}`, customerEmail: '', customerPhone: '414-555-0100', customerAddress: `${id} Maple St`, customerCity: 'Milwaukee', customerZip: '53211',
    outsideAreaRelative: false, itemsSubtotal: 26, deliveryFee: 0, feeCovered: 0, gift: 0, total: 26, paymentStatus: 'unpaid', paidMethod: null, paidAt: null, paidAmount: null, status: 'placed',
    stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false, enteredByPersonId: null, enteredByName: null, collectedByScout: false, paymentNote: '', customerNote: '',
    orderNote: '', orderNoteBy: null, orderNoteAt: null,
    lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 1, donated: false, amount: 26, unitPrice: 26, unitCost: 16 }],
    ...over
  };
}
const donationOnly = (id: number, over: Partial<AdminOrder> = {}) => order(id, { fulfillment: 'none', deliveringPersonId: null, itemsSubtotal: 0, gift: 100, total: 100, lines: [], ...over });

describe('Members › My wreath orders', () => {
  it('Totals_ShowDonations_NextToSold', () => {
    const seller = buildSellerView(ME, 'Lily P', [order(1), donationOnly(2), donationOnly(3, { status: 'cancelled' })], { profit: 0.3, donation: 0.15 });
    render(<MyWreathOrdersView data={{ sale, items: [], sellers: [seller] }} />);
    const totals = screen.getByText('Donations').closest('div')!;
    expect([seller.summary.donations, within(totals).getByText('$100.00') !== null]).toEqual([100, true]);
  });

  it('DonationOnlyRow_ReadsAsADonation_WithNothingToDeliver', () => {
    expect([orderItemsText({ lines: [], gift: 100 }), orderItemsText({ lines: [{ label: '20″ Wreath', quantity: 1, donated: false }], gift: 10 })]).toEqual(['$100 donation', '1 × 20″ Wreath, $10 donation']);
  });

  it('DonationOnlyOrders_StayOffTheDeliveryList', () => {
    const seller = buildSellerView(ME, 'Lily P', [donationOnly(4), donationOnly(5, { source: 'paper', fulfillment: 'scout', deliveringPersonId: ME })], 0.3);
    expect(seller.deliveries).toEqual([]);
  });

  it('ScoutEnteredDonationOnlyRow_ShowsTheDonation', () => {
    const seller = buildSellerView(ME, 'Lily P', [donationOnly(6, { source: 'paper', customerName: 'Aunt Jo' })], 0.3);
    render(<MyWreathOrdersView data={{ sale, items: [], sellers: [seller] }} />);
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Aunt Jo · $100 donation')).toBeTruthy();
  });
});
