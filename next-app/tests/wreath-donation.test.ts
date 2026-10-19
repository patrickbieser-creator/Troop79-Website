import { describe, it, expect } from 'vitest';
import {
  donationNet,
  donationPart,
  paidLedgerRows,
  parseDonation,
  priceCart,
  sellerEarnings,
  splitCardFee,
  type DonationOrder,
  type SaleRules
} from '../src/lib/wreaths/rules';
import { cardLedger, cardRefundRows, checkoutLineItems, withCardFeeCover } from '../src/lib/wreaths/card-checkout';
import { NO_GOODS_OR_SERVICES, RECEIPT_ORG, arrivalParagraphs, donationReceiptLines } from '../src/lib/wreaths/copy';
import { customerConfirmationEmail, type OrderEmailContext } from '../src/lib/wreaths/emails';
import { validateCheckout } from '../src/lib/wreaths/checkout-validate';
import { buildSalesDashboard } from '../src/lib/wreaths/dashboard';
import type { AdminOrder } from '../src/lib/wreaths/admin-data';

/**
 * W-3, "Donate to Troop 79" (Plans/Wreath-Sale.md, Patrick 2026-10-19) — the pure half: the amount, the donation-only
 * cart, no fee on the donation, the scouts' share after the card fee, the ledger split, the short-payment rule and the
 * receipt. The database half is tests/wreath-donation-db.test.ts.
 */
const rules: SaleRules = { deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 2.9, feeFixed: 0.3, round1Cutoff: '2026-10-21T04:59:00.000Z', round2Cutoff: '2026-11-16T05:59:00.000Z' };
const catalog = [{ id: 1, catalogNumber: 1, price: 26, unitCost: 16, active: true, donatable: true }];

const paidCard = (over: Partial<DonationOrder> = {}): DonationOrder => ({ gift: 25, total: 25, paymentStatus: 'paid', paidMethod: 'card', paidAmount: 25, stripeFee: 1.03, ...over });

describe('the donation amount', () => {
  it('Customer_CanGiveAPresetOrOtherAmount_InDollarsAndCents', () => {
    expect([parseDonation('10'), parseDonation('25'), parseDonation('$50'), parseDonation('12.50'), parseDonation(' 7.5 ')]).toEqual([10, 25, 50, 12.5, 7.5]);
  });

  it('Customer_CannotGiveZeroNegativeJunkOrOverTheMax', () => {
    expect(['0', '-5', 'abc', '', '1.234', '500.01', '1e3'].map(parseDonation)).toEqual([null, null, null, null, null, null, null]);
  });

  // qa-lead, 2026-10-19: $1 at least (Stripe's floor is $0.50).
  it('Customer_CannotGiveLessThanOneDollar', () => {
    expect([parseDonation('0.99'), parseDonation('0.50'), parseDonation('1')]).toEqual([null, null, 1]);
  });

  it('Customer_CanGiveUpToTheMax', () => {
    expect(parseDonation('500')).toBe(500);
  });
});

describe('a donation-only cart', () => {
  it('DonationOnly_PricesWithNoWreathNoDeliveryAndNoFee', () => {
    const r = priceCart(rules, catalog, [], { fulfillment: 'none', gift: 25, coverFee: true, allowDonationOnly: true });
    expect(r.ok && [r.order.itemsSubtotal, r.order.deliveryFee, r.order.feeCovered, r.order.gift, r.order.total]).toEqual([0, 0, 0, 25, 25]);
  });

  it('DonationOnly_IsStillEmpty_WhereNotAllowed_OrWithoutADonation', () => {
    const scoutEntry = priceCart(rules, catalog, [], { fulfillment: 'scout', gift: 25, coverFee: false });
    const noGift = priceCart(rules, catalog, [], { fulfillment: 'none', gift: 0, coverFee: false, allowDonationOnly: true });
    expect([scoutEntry.ok || scoutEntry.problem.code, noGift.ok || noGift.problem.code]).toEqual(['empty', 'empty']);
  });

  it('DonationOnly_RefusesAnAmountOverTheMax', () => {
    const r = priceCart(rules, catalog, [], { fulfillment: 'none', gift: 501, coverFee: false, allowDonationOnly: true });
    expect(r.ok || r.problem.code).toBe('gift');
  });

  it('DonationOnlyCheckout_NeedsNoMethodZipAddressOrPhone', () => {
    const draft = { hasLines: false, allDonated: false, scoutFirstName: null, method: '' as const, deliveryZipPrefix: '532', zip: '', relative: false, name: 'Ann Giver', email: 'ann@example.test', phone: '', street: '', city: '', giftOther: false, giftAmount: 25 };
    expect(validateCheckout(draft)).toEqual([]);
  });

  it('DonationOnlyCheckout_StillChecksAPhoneThatWasTyped_AndTheAmount', () => {
    const draft = { hasLines: false, allDonated: false, scoutFirstName: null, method: '' as const, deliveryZipPrefix: '532', zip: '', relative: false, name: 'Ann', email: 'ann@example.test', phone: '123', street: '', city: '', giftOther: true, giftAmount: 0 };
    expect(validateCheckout(draft).map((p) => p.field)).toEqual(['gift', 'phone']);
  });

  it('DonationOnly_ArrivalSaysThereIsNothingToDeliver', () => {
    const p = arrivalParagraphs({ fulfillment: 'none', scoutName: null, scoutFirstName: null, outsideAreaRelative: false, hasDonated: false, distribution: { date: null, window: '', place: '' } });
    expect(p).toEqual(['There is nothing to deliver or pick up: your order is a donation to Troop 79.']);
  });
});

describe('no card fee on the donation', () => {
  it('CardTotal_HasNoFeeOnTheDonationPart', () => {
    // $26 wreath + $25 donation, fee covered: the cover is on the $26 only.
    const r = priceCart(rules, catalog, [{ itemId: 1, quantity: 1, donated: false }], { fulfillment: 'pickup', gift: 25, coverFee: true });
    const wreathOnly = priceCart(rules, catalog, [{ itemId: 1, quantity: 1, donated: false }], { fulfillment: 'pickup', gift: 0, coverFee: true });
    expect(r.ok && wreathOnly.ok && [r.order.feeCovered, r.order.total]).toEqual([wreathOnly.ok && wreathOnly.order.feeCovered, 26 + 25 + (wreathOnly.ok ? wreathOnly.order.feeCovered : 0)]);
  });

  it('CardCheckout_DonationOnly_ChargesExactlyTheDonation_EvenWithTheCoverTicked', () => {
    expect(withCardFeeCover({ itemsSubtotal: 0, deliveryFee: 0, gift: 25 }, rules, true)).toEqual({ feeCovered: 0, total: 25 });
  });

  it('CardCheckout_DonationOnly_SendsStripeOneDonationLine', () => {
    const items = checkoutLineItems({ id: 1, orderNumber: 'W-1', itemsSubtotal: 0, deliveryFee: 0, gift: 25, feeCovered: 0, total: 25, lines: [] });
    expect(items).toEqual([{ name: 'Donation to Troop 79', unitAmount: 2500, quantity: 1 }]);
  });
});

describe('the scouts’ share of donations', () => {
  const order = (over: Partial<DonationOrder> & { lines?: { quantity: number; unitPrice: number; unitCost: number }[] } = {}) => ({
    gift: 20,
    total: 46,
    paymentStatus: 'paid',
    paidMethod: 'venmo',
    paidAmount: 46,
    stripeFee: null,
    lines: [{ quantity: 1, unitPrice: 26, unitCost: 16 }],
    ...over
  });

  it('ScoutShare_AtTheDefault15Percent_AddsToTheProfitShare', () => {
    // 30% of $10 profit = $3, plus 15% of the $20 donation = $3.
    expect(sellerEarnings([order()], { profit: 0.3, donation: 0.15 })).toBe(6);
  });

  it('ScoutShare_FollowsAChangedSetting', () => {
    expect(sellerEarnings([order()], { profit: 0.3, donation: 0.25 })).toBe(8);
  });

  it('ScoutShare_IsTakenAfterTheCardFee', () => {
    // A $25 donation-only card payment: Stripe's $1.03 fee is all the donation's, so 15% of $23.97 = $3.60.
    const o = { ...paidCard(), lines: [] };
    expect([donationNet(o), sellerEarnings([o], { profit: 0.3, donation: 0.15 })]).toEqual([23.97, 3.6]);
  });

  it('ScoutShare_OnAMixedCardOrder_CarriesTheDonationsProportionOfTheFee', () => {
    // $26 wreath + $25 donation = $51 charged; fee $1.78 split by share of the charge: 1.78 × 25/51 = $0.87.
    expect(splitCardFee(1.78, 25, 51)).toEqual({ donation: 0.87, rest: 0.91 });
    expect(donationNet(paidCard({ total: 51, paidAmount: 51, stripeFee: 1.78 }))).toBe(24.13);
  });

  it('ScoutShare_CountsTheGrossDonation_UntilTheCardFeeSettles', () => {
    expect(donationNet(paidCard({ stripeFee: null }))).toBe(25);
  });

  // Retroactive (Patrick): a round 1 gift already paid before W-3 shipped counts once the code is live.
  it('ScoutShare_CountsAnExistingPaidGift', () => {
    expect(sellerEarnings([order({ lines: [] , total: 20, paidAmount: 20 })], { profit: 0.3, donation: 0.15 })).toBe(3);
  });

  it('ShortPayment_TheDonationAbsorbsTheShortfallFirst', () => {
    // $26 wreath + $20 donation = $46; $40 came in: the wreath is paid in full and the donation is $14.
    expect([donationPart(40, 46, 20), donationNet({ gift: 20, total: 46, paymentStatus: 'paid', paidMethod: 'cash', paidAmount: 40, stripeFee: null })]).toEqual([14, 14]);
  });

  it('ShortPayment_BeyondTheDonation_LeavesNoDonation', () => {
    expect(donationPart(20, 46, 20)).toBe(0);
  });

  it('NoCredit_MeansNothingToScouts_AndTheWholeDonationToTheTroop', () => {
    const o: AdminOrder = {
      id: 1, orderNumber: 'W-1', placedAt: '2026-10-13T15:00:00.000Z', round: 1, source: 'store', fulfillment: 'none', creditedPersonId: null, creditedName: 'Troop store',
      deliveringPersonId: null, customerName: 'Ann', customerEmail: '', customerPhone: '', customerAddress: '', customerCity: '', customerZip: '', outsideAreaRelative: false,
      itemsSubtotal: 0, deliveryFee: 0, feeCovered: 0, gift: 25, total: 25, paymentStatus: 'paid', paidMethod: 'venmo', paidAt: null, paidAmount: 25, status: 'placed',
      stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false, lines: [], enteredByPersonId: null, enteredByName: null, collectedByScout: false,
      paymentNote: '', customerNote: '', orderNote: '', orderNoteBy: null, orderNoteAt: null
    };
    const d = buildSalesDashboard({ orders: [o], sellers: [], sale: { scoutShare: 0.3, donationShare: 0.15, round1Cutoff: rules.round1Cutoff, round2Cutoff: rules.round2Cutoff } });
    expect([d.totals.gifts, d.totals.donationsNet, d.totals.scoutShare, d.totals.troopShare]).toEqual([25, 25, 0, 25]);
  });

  it('Dashboard_FoldsTheDonationShareIntoTheScoutsEarnings', () => {
    const base = {
      id: 2, orderNumber: 'W-2', placedAt: '2026-10-13T15:00:00.000Z', round: 1 as const, source: 'scout_link' as const, fulfillment: 'scout' as const, creditedPersonId: 100, creditedName: 'Anna A',
      deliveringPersonId: 100, customerName: 'Bo', customerEmail: '', customerPhone: '', customerAddress: '', customerCity: '', customerZip: '', outsideAreaRelative: false,
      itemsSubtotal: 26, deliveryFee: 0, feeCovered: 0, gift: 20, total: 46, paymentStatus: 'unpaid' as const, paidMethod: null, paidAt: null, paidAmount: null, status: 'placed' as const,
      stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false, enteredByPersonId: null, enteredByName: null, collectedByScout: false,
      paymentNote: '', customerNote: '', orderNote: '', orderNoteBy: null, orderNoteAt: null,
      lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 1, donated: false, amount: 26, unitPrice: 26, unitCost: 16 }]
    };
    const d = buildSalesDashboard({ orders: [base], sellers: [{ id: 1, personId: 100, name: 'Anna A', slug: null, active: true, orders: 1, goal: null, deliveryMessage: null }], sale: { scoutShare: 0.3, donationShare: 0.15, round1Cutoff: rules.round1Cutoff, round2Cutoff: rules.round2Cutoff } });
    expect([d.sellers[0].earnings, d.totals.scoutShare, d.totals.troopShare]).toEqual([6, 6, 24]);
  });
});

describe('the ledger’s Donation line', () => {
  const base = { orderNumber: 'W-1001', customerName: 'Sara Zirbel', method: 'venmo' as const, saleYear: 2026, today: '2026-10-20' };

  it('MarkPaid_BooksTheDonationAsItsOwnRow_InTheSalesBucket', () => {
    const { payment, donation } = paidLedgerRows({ ...base, received: 46, total: 46, gift: 20 });
    expect([payment?.amount, payment?.kind, donation?.amount, donation?.kind, donation?.bucket, donation?.memo]).toEqual([26, 'fundraiser', 20, 'donation', "Wreaths '26", 'Donation · Wreath order W-1001 · Sara Zirbel · Venmo']);
  });

  it('MarkPaid_DonationOnly_BooksOnlyTheDonationRow', () => {
    const { payment, donation } = paidLedgerRows({ ...base, received: 25, total: 25, gift: 25 });
    expect([payment, donation?.amount]).toEqual([null, 25]);
  });

  it('MarkPaid_Short_TakesTheShortfallOffTheDonation', () => {
    const { payment, donation } = paidLedgerRows({ ...base, received: 40, total: 46, gift: 20 });
    expect([payment?.amount, donation?.amount]).toEqual([26, 14]);
  });

  it('Card_BooksTheDonationNetOfItsShareOfTheFee_AndTheRowsMatchTheBank', () => {
    const rows = cardLedger({ ...base, total: 51, gift: 25, fee: 1.78 });
    const sum = [rows.income, rows.donation, rows.feeRow].reduce((n, r) => n + Math.round((r?.amount ?? 0) * 100), 0) / 100;
    expect([rows.income?.amount, rows.donation?.amount, rows.donation?.kind, rows.feeRow?.amount, sum]).toEqual([26, 24.13, 'donation', -0.91, 49.22]);
  });

  it('Card_DonationOnly_HasNoWreathRowAndNoSeparateFeeRow', () => {
    const rows = cardLedger({ ...base, total: 25, gift: 25, fee: 1.03 });
    expect([rows.income, rows.donation?.amount, rows.feeRow]).toEqual([null, 23.97, null]);
  });

  it('Card_FeeNotSettled_BooksTheDonationGross', () => {
    expect(cardLedger({ ...base, total: 25, gift: 25, fee: null }).donation?.amount).toBe(25);
  });

  it('CardRefund_ReversesTheWreathsAndTheWholeDonation', () => {
    const r = cardRefundRows({ ...base, amount: 51, gift: 25 });
    expect([r.refund?.amount, r.donationRefund?.amount, r.donationRefund?.kind]).toEqual([-26, -25, 'donation']);
  });
});

describe('the donation receipt', () => {
  const ctx = (over: Partial<OrderEmailContext> = {}): OrderEmailContext => ({
    orderNumber: 'W-1050',
    customerName: 'Ann Giver',
    items: [],
    itemsSubtotal: 0,
    deliveryFee: 0,
    feeCovered: 0,
    gift: 25,
    total: 25,
    arrival: 'There is nothing to deliver or pick up: your order is a donation to Troop 79.',
    creditedTo: null,
    orderUrl: 'https://wreaths.test/wreaths/order/x',
    changesBy: 'Tuesday, October 20, 2026',
    placedAt: '2026-10-19T17:00:00.000Z',
    ...over
  });

  it('Receipt_DonationOnly_NamesTheTroopAmountDate_AndNoGoodsOrServices', () => {
    expect(donationReceiptLines({ gift: 25, donationOnly: true, placedAt: '2026-10-19T17:00:00.000Z' })).toEqual([
      `Your donation to ${RECEIPT_ORG}`,
      'Donation: $25.00, October 19, 2026',
      NO_GOODS_OR_SERVICES
    ]);
  });

  it('Receipt_MixedOrder_StatesTheDonationApart_WithoutTheNoGoodsLine', () => {
    const lines = donationReceiptLines({ gift: 10, donationOnly: false, placedAt: '2026-10-19T17:00:00.000Z' });
    expect([lines[1].startsWith('Donation: $10.00, October 19, 2026.'), lines.includes(NO_GOODS_OR_SERVICES)]).toEqual([true, false]);
  });

  // qa-lead, 2026-10-19: the email goes out before payment, so it is never called a receipt.
  it('Receipt_IsNotCalledAReceipt_WhileUnpaid', () => {
    expect(donationReceiptLines({ gift: 25, donationOnly: true, placedAt: '2026-10-19T17:00:00.000Z' }).some((l) => /receipt/i.test(l))).toBe(false);
  });

  it('Receipt_NoDonation_NoLines', () => {
    expect(donationReceiptLines({ gift: 0, donationOnly: false, placedAt: '2026-10-19T17:00:00.000Z' })).toEqual([]);
  });

  it('ConfirmationEmail_DonationOnly_IsADonationReceipt', () => {
    const m = customerConfirmationEmail(ctx());
    expect([m.subject, m.text.includes(NO_GOODS_OR_SERVICES), m.text.includes('Thank you, Ann, for your donation to Troop 79.'), m.text.includes('Donation: $25.00, October 19, 2026')]).toEqual([
      'Your donation to Troop 79, W-1050',
      true,
      true,
      true
    ]);
  });

  it('ConfirmationEmail_MixedOrder_ShowsTheDonationLineAndAmountSeparately', () => {
    const m = customerConfirmationEmail(ctx({ items: [{ label: '20″ Wreath', quantity: 1, donated: false, amount: 26 }], itemsSubtotal: 26, gift: 10, total: 36 }));
    expect([m.text.includes('Donation to Troop 79 — $10.00'), m.text.includes('Donation: $10.00, October 19, 2026.'), m.text.includes(NO_GOODS_OR_SERVICES)]).toEqual([true, true, false]);
  });
});
