/**
 * Wreath sale › Reconciliation and the family Statement (Patrick, 2026-10-19): the account for each credited scout,
 * line by line — items, list price, price paid, cost, gross profit, the scout's and the troop's share — plus each order's
 * card fee, donation, delivery fee and what came in against its total.
 *
 * Pure, and NOT a second money calculus: every figure comes from lib/wreaths/rules (orderProfit, scoutEarnings,
 * donationNet, splitCardFee, acceptedShort, shortOnWreaths), and the counting rule is the dashboard's (isCounted: placed
 * and not refunded; unpaid orders count as pledged). Cancelled and refunded orders are listed and count in nothing.
 * The grand totals are checked against buildSalesDashboard on the same input; `check` names any difference.
 *
 * Per-line shares: the scout's share is rounded once on the section's whole profit (scoutEarnings, as sellerEarnings
 * does), so each line takes the running total's increment — the lines add up to the scout's figure to the cent.
 * Donations the same, on the running net. Delivery fees are troop income outside the split; the card fee's wreath part
 * is shown but not taken from the split (the dashboard's profit is price less cost), and its donation part comes off
 * the donation (donationNet).
 */
import type { AdminOrder, AdminSeller } from './admin-data';
import { buildSalesDashboard } from './dashboard';
import { isCounted } from './my-orders';
import { acceptedShort, donationNet, donationPart, fromCents, orderProfit, paymentDifferenceText, scoutEarnings, shortOnWreaths, splitCardFee, toCents } from './rules';

export interface ReconSale {
  year: number;
  scoutShare: number;
  donationShare: number;
  feePercent: number;
  feeFixed: number;
  round1Cutoff: string;
  round2Cutoff: string;
}

export interface ReconLine {
  label: string;
  quantity: number;
  donated: boolean;
  /** Today's catalog price × qty (the snapshot price when the item is gone). */
  listPrice: number;
  /** The line's snapshot unit price × qty. */
  paid: number;
  cost: number;
  profit: number;
  scoutPct: number;
  scout: number;
  troopPct: number;
  troop: number;
}

export interface ReconDonation {
  gift: number;
  /** What a short payment took out of it (it absorbs a shortfall first). */
  shortAbsorbed: number;
  /** Its share of the card fee. */
  cardFee: number;
  net: number;
  scoutPct: number;
  scout: number;
  troopPct: number;
  troop: number;
}

export interface ReconOrder {
  id: number;
  orderNumber: string;
  placedAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** False for a cancelled or refunded order: listed, struck through, counted in nothing. */
  counted: boolean;
  /** 'Cancelled' / 'Refunded' for an uncounted order; null otherwise. */
  notCountedReason: string | null;
  paid: boolean;
  paidMethod: string | null;
  lines: ReconLine[];
  itemsSubtotal: number;
  deliveryFee: number;
  feeCovered: number;
  /** Stripe's fee and its split (W-3); null when there is none. */
  cardFee: { total: number; wreaths: number; donation: number } | null;
  donation: ReconDonation | null;
  /** The accepted shortfall that came off the wreaths' profit (the troop absorbs it). */
  shortOnWreaths: number;
  total: number;
  /** What came in on a paid order; null on an unpaid (pledged) one. */
  received: number | null;
  /** "$5 short" / "$10 over" on an order paid by hand; null when it matches. */
  difference: string | null;
  scout: number;
  troop: number;
}

export interface ReconTotals {
  orders: number;
  paidOrders: number;
  unpaidOrders: number;
  notCounted: number;
  items: number;
  listSales: number;
  sales: number;
  cost: number;
  /** Price less cost, before any shortfall. */
  grossProfit: number;
  shortOnWreaths: number;
  /** The dashboard's profit: gross profit less the shortfall on the wreaths. */
  profit: number;
  gifts: number;
  donationsNet: number;
  cardFees: number;
  feesCovered: number;
  deliveryFees: number;
  grandTotal: number;
  /** Came in on paid orders. */
  collected: number;
  /** Pledged: the totals of unpaid orders. */
  owed: number;
  shortAccepted: number;
  scout: number;
  /** Profit plus net donations, less the scout's share. Delivery fees are not in it. */
  troop: number;
}

export interface ReconSection {
  /** null = Unassigned (orders credited to no scout). */
  personId: number | null;
  name: string;
  firstName: string;
  scoutPct: number;
  donationPct: number;
  orders: ReconOrder[];
  totals: ReconTotals;
}

export interface ReconMismatch {
  label: string;
  reconciliation: number;
  dashboard: number;
}

export interface Reconciliation {
  year: number;
  settings: { scoutPct: number; donationPct: number; feePercent: number; feeFixed: number };
  sections: ReconSection[];
  totals: ReconTotals;
  check: { ok: boolean; mismatches: ReconMismatch[] };
}

/** 0.3 → 30, 0.155 → 15.5. */
export const pct = (share: number): number => Math.round(share * 1000) / 10;

const add = (a: number, b: number) => fromCents(toCents(a) + toCents(b));
const sub = (a: number, b: number) => fromCents(toCents(a) - toCents(b));

const ZERO: ReconTotals = {
  orders: 0, paidOrders: 0, unpaidOrders: 0, notCounted: 0, items: 0, listSales: 0, sales: 0, cost: 0, grossProfit: 0, shortOnWreaths: 0, profit: 0,
  gifts: 0, donationsNet: 0, cardFees: 0, feesCovered: 0, deliveryFees: 0, grandTotal: 0, collected: 0, owed: 0, shortAccepted: 0, scout: 0, troop: 0
};

function totalsOf(orders: ReconOrder[], source: Map<number, AdminOrder>): ReconTotals {
  const t = { ...ZERO };
  for (const r of orders) {
    if (!r.counted) {
      t.notCounted += 1;
      continue;
    }
    const o = source.get(r.id)!;
    t.orders += 1;
    if (r.paid) t.paidOrders += 1;
    else t.unpaidOrders += 1;
    for (const l of r.lines) {
      t.items += l.quantity;
      t.listSales = add(t.listSales, l.listPrice);
      t.cost = add(t.cost, l.cost);
    }
    t.sales = add(t.sales, r.itemsSubtotal);
    t.grossProfit = add(t.grossProfit, orderProfit(o.lines));
    t.shortOnWreaths = add(t.shortOnWreaths, r.shortOnWreaths);
    t.gifts = add(t.gifts, o.gift);
    t.donationsNet = add(t.donationsNet, r.donation?.net ?? 0);
    t.cardFees = add(t.cardFees, o.stripeFee ?? 0);
    t.feesCovered = add(t.feesCovered, r.feeCovered);
    t.deliveryFees = add(t.deliveryFees, r.deliveryFee);
    t.grandTotal = add(t.grandTotal, r.total);
    if (r.paid) t.collected = add(t.collected, r.received ?? r.total);
    else t.owed = add(t.owed, r.total);
    t.shortAccepted = add(t.shortAccepted, acceptedShort(o));
    t.scout = add(t.scout, r.scout);
    t.troop = add(t.troop, r.troop);
  }
  t.profit = sub(t.grossProfit, t.shortOnWreaths);
  return t;
}

function buildSection(personId: number | null, name: string, orders: AdminOrder[], sale: ReconSale, listPriceOf: Map<number, number>): ReconSection {
  const profitShare = personId == null ? 0 : sale.scoutShare;
  const giftShare = personId == null ? 0 : sale.donationShare;
  const sorted = [...orders].sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.orderNumber.localeCompare(b.orderNumber));
  // Running totals for the per-line increments (see the header).
  let profitCum = 0;
  let scoutCum = 0;
  let netCum = 0;
  let giftScoutCum = 0;
  const step = (cum: number, add: number, prevShare: number, share: number) => {
    const next = scoutEarnings(fromCents(cum + add), share);
    return { cum: cum + add, share: next, inc: sub(next, prevShare) };
  };

  const rows: ReconOrder[] = sorted.map((o) => {
    const counted = isCounted(o);
    const paid = o.paymentStatus === 'paid';
    const lines: ReconLine[] = o.lines.map((l) => {
      const paidAmt = fromCents(toCents(l.unitPrice) * l.quantity);
      const cost = fromCents(toCents(l.unitCost) * l.quantity);
      const profit = orderProfit([l]);
      let scout = 0;
      if (counted) {
        const s = step(profitCum, toCents(profit), scoutCum, profitShare);
        profitCum = s.cum;
        scout = s.inc;
        scoutCum = s.share;
      }
      return {
        label: l.label,
        quantity: l.quantity,
        donated: l.donated,
        listPrice: fromCents(toCents(listPriceOf.get(l.itemId) ?? l.unitPrice) * l.quantity),
        paid: paidAmt,
        cost,
        profit,
        scoutPct: pct(profitShare),
        scout,
        troopPct: sub(100, pct(profitShare)),
        troop: counted ? sub(profit, scout) : 0
      };
    });

    const charged = o.paidAmount ?? o.total;
    const split = o.stripeFee != null && o.stripeFee > 0 ? splitCardFee(o.stripeFee, o.gift, charged) : null;
    let donation: ReconDonation | null = null;
    if (o.gift > 0) {
      const net = donationNet(o);
      const byCard = paid && o.paidMethod === 'card';
      const cardFee = byCard ? splitCardFee(o.stripeFee ?? 0, o.gift, charged).donation : 0;
      const shortAbsorbed = paid && !byCard && o.paidAmount != null ? sub(o.gift, donationPart(o.paidAmount, o.total, o.gift)) : 0;
      let scout = 0;
      if (counted) {
        const s = step(netCum, toCents(net), giftScoutCum, giftShare);
        netCum = s.cum;
        scout = s.inc;
        giftScoutCum = s.share;
      }
      donation = { gift: o.gift, shortAbsorbed, cardFee, net, scoutPct: pct(giftShare), scout, troopPct: sub(100, pct(giftShare)), troop: counted ? sub(net, scout) : 0 };
    }

    const short = counted && paid ? shortOnWreaths(o) : 0;
    const scout = counted ? lines.reduce((n, l) => add(n, l.scout), donation?.scout ?? 0) : 0;
    const troop = counted ? sub(lines.reduce((n, l) => add(n, l.troop), donation?.troop ?? 0), short) : 0;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      placedAt: o.placedAt,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      customerPhone: o.customerPhone,
      counted,
      notCountedReason: counted ? null : o.status === 'cancelled' ? 'Cancelled' : 'Refunded',
      paid,
      paidMethod: o.paidMethod,
      lines,
      itemsSubtotal: o.itemsSubtotal,
      deliveryFee: o.deliveryFee,
      feeCovered: o.feeCovered,
      cardFee: split ? { total: o.stripeFee!, wreaths: split.rest, donation: split.donation } : null,
      donation,
      shortOnWreaths: short,
      total: o.total,
      received: paid ? (o.paidAmount ?? o.total) : null,
      difference: paymentDifferenceText(o),
      scout,
      troop
    };
  });

  const source = new Map(orders.map((o) => [o.id, o]));
  const display = personId == null ? 'Unassigned' : name;
  return {
    personId,
    name: display,
    firstName: personId == null ? 'Unassigned' : (display.split(' ')[0] ?? display),
    scoutPct: pct(profitShare),
    donationPct: pct(giftShare),
    orders: rows,
    totals: totalsOf(rows, source)
  };
}

function sumTotals(sections: ReconSection[]): ReconTotals {
  const t = { ...ZERO };
  for (const s of sections) {
    for (const k of Object.keys(t) as (keyof ReconTotals)[]) {
      const isCount = k === 'orders' || k === 'paidOrders' || k === 'unpaidOrders' || k === 'notCounted' || k === 'items';
      t[k] = isCount ? t[k] + s.totals[k] : add(t[k], s.totals[k]);
    }
  }
  return t;
}

export function buildReconciliation(input: {
  orders: AdminOrder[];
  sellers: AdminSeller[];
  /** The sale's items, for today's list price; a line whose item is missing uses its snapshot price. */
  items: { id: number; price: number }[];
  sale: ReconSale;
  nowMs?: number;
}): Reconciliation {
  const { orders, sellers, items, sale } = input;
  const listPriceOf = new Map(items.map((i) => [i.id, i.price]));
  const nameOf = new Map(sellers.map((s) => [s.personId, s.name]));
  const byPerson = new Map<number | null, AdminOrder[]>();
  for (const o of orders) byPerson.set(o.creditedPersonId, [...(byPerson.get(o.creditedPersonId) ?? []), o]);

  const sections = [...byPerson.entries()]
    .map(([pid, xs]) => buildSection(pid, pid == null ? 'Unassigned' : (nameOf.get(pid) ?? xs[0].creditedName), xs, sale, listPriceOf))
    // Scouts by name; Unassigned last.
    .sort((a, b) => Number(a.personId == null) - Number(b.personId == null) || a.name.localeCompare(b.name));
  const totals = sumTotals(sections);

  const d = buildSalesDashboard({ orders, sellers, sale, nowMs: input.nowMs });
  const pairs: [string, number, number][] = [
    ['Orders', totals.orders, d.totals.orders],
    ['Wreath sales', totals.sales, d.totals.sales],
    ['Profit', totals.profit, d.totals.profit],
    ['Donations', totals.gifts, d.totals.gifts],
    ['Donations after fees', totals.donationsNet, d.totals.donationsNet],
    ['Delivery fees', totals.deliveryFees, d.totals.deliveryFees],
    ['Card fees', totals.cardFees, d.totals.cardFees],
    ['Fees covered', totals.feesCovered, d.totals.feesCovered],
    ['Order totals', totals.grandTotal, d.totals.grandTotal],
    ['Collected', totals.collected, d.totals.collected],
    ['Pledged', totals.owed, d.totals.owed],
    ['Accepted short', totals.shortAccepted, d.totals.shortAccepted],
    ['Scouts’ share', totals.scout, d.totals.scoutShare],
    ['Troop’s share', totals.troop, d.totals.troopShare]
  ];
  for (const s of sections) {
    if (s.personId == null) continue;
    const seller = d.sellers.find((x) => x.personId === s.personId);
    pairs.push([`${s.name}’s share`, s.totals.scout, seller?.earnings ?? 0]);
  }
  const mismatches = pairs.filter(([, a, b]) => toCents(a) !== toCents(b)).map(([label, reconciliation, dashboard]) => ({ label, reconciliation, dashboard }));

  return {
    year: sale.year,
    settings: { scoutPct: pct(sale.scoutShare), donationPct: pct(sale.donationShare), feePercent: sale.feePercent, feeFixed: sale.feeFixed },
    sections,
    totals,
    check: { ok: mismatches.length === 0, mismatches }
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (n: number) => n.toFixed(2);

/** The visible rows as CSV: one row per line, donation, card fee and delivery fee. */
export function reconciliationCsv(sections: ReconSection[]): string {
  const head = ['Scout', 'Order', 'Customer', 'Status', 'Row', 'Qty', 'List price', 'Price paid', 'Cost', 'Gross profit', 'Scout %', 'Scout $', 'Troop %', 'Troop $'];
  const out: (string | number)[][] = [head];
  for (const s of sections) {
    for (const o of s.orders) {
      const status = o.notCountedReason ?? (o.paid ? 'Paid' : 'Unpaid');
      const base = [s.name, o.orderNumber, o.customerName, status];
      for (const l of o.lines) {
        out.push([...base, `${l.label}${l.donated ? ' (donated)' : ''}`, l.quantity, money(l.listPrice), money(l.paid), money(l.cost), money(l.profit), l.scoutPct, money(l.scout), l.troopPct, money(l.troop)]);
      }
      if (o.donation) {
        const g = o.donation;
        out.push([...base, 'Donation (net)', '', '', money(g.gift), money(sub(g.gift, g.net)), money(g.net), g.scoutPct, money(g.scout), g.troopPct, money(g.troop)]);
      }
      if (o.cardFee) out.push([...base, 'Card fee', '', '', '', money(o.cardFee.total), '', '', '', '', '']);
      if (o.deliveryFee > 0) out.push([...base, 'Delivery fee (troop)', '', '', money(o.deliveryFee), '', '', '', '', '', money(o.deliveryFee)]);
    }
  }
  return out.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
