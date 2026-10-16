/**
 * Admin › Wreath Sale › Dashboard (Patrick, 2026-10-16): the sale at a glance — what's sold, what's collected, what
 * needs a hand, how it's trending, who's selling. Pure: the page passes the orders and sellers it already loads.
 * "Counted" is the same rule as the scout's page (lib/wreaths/my-orders isCounted): placed and not refunded. Profit and
 * the scouts' share follow lib/wreaths/rules; the books at close (Release C) are the binding numbers, this is a view.
 */
import { instantToCentral } from '@/lib/dates';
import type { AdminOrder, AdminSeller } from './admin-data';
import { isCounted } from './my-orders';
import { fromCents, orderProfit, scoutEarnings, toCents } from './rules';

export interface DashTotals {
  orders: number;
  cancelled: number;
  /** Wreaths and add-ons, donated ones included. */
  items: number;
  donated: number;
  /** Items subtotal: the wreaths' price, before delivery, gifts and fees. */
  sales: number;
  gifts: number;
  deliveryFees: number;
  /** Everything customers owe or paid (order totals). */
  grandTotal: number;
  collected: number;
  owed: number;
  profit: number;
  scoutShare: number;
  troopShare: number;
  /** Stripe's fees on card payments, and what customers chose to cover. */
  cardFees: number;
  feesCovered: number;
  sellersSelling: number;
  sellersActive: number;
}

export interface DashAttention {
  unpaid: number;
  oldestUnpaidDays: number | null;
  cardUnfinished: number;
  needsRefund: number;
  /** Scout-entered unpaid orders: money the scout has (to turn in) or hasn't collected yet. */
  toTurnIn: number;
  toCollect: number;
}

export interface DashDay {
  /** Central calendar day, 'YYYY-MM-DD'. */
  date: string;
  orders: number;
  sales: number;
}

export interface DashSlice<K extends string> {
  key: K;
  orders: number;
  amount: number;
}

export interface DashMethod {
  method: string;
  orders: number;
  amount: number;
}

export interface DashItem {
  catalogNumber: number;
  label: string;
  quantity: number;
  donated: number;
  sales: number;
  profit: number;
}

export interface DashSeller {
  /** null = the troop store (orders credited to no scout). */
  personId: number | null;
  name: string;
  orders: number;
  items: number;
  sales: number;
  owed: number;
  earnings: number;
  goal: number | null;
  /** items / goal, uncapped; null without a goal. */
  goalPct: number | null;
}

export interface SalesDashboard {
  totals: DashTotals;
  attention: DashAttention;
  byDay: DashDay[];
  byMethod: DashMethod[];
  byChannel: DashSlice<AdminOrder['source']>[];
  byFulfillment: DashSlice<AdminOrder['fulfillment']>[];
  /** Each round's orders and wreaths, when it closes, and whole days left (0 = closes today; null = closed). */
  byRound: { round: 1 | 2; orders: number; items: number; closes: string; daysLeft: number | null }[];
  items: DashItem[];
  sellers: DashSeller[];
}

const sum = (xs: number[]) => fromCents(xs.reduce((a, b) => a + toCents(b), 0));
const itemCount = (o: AdminOrder) => o.lines.reduce((n, l) => n + l.quantity, 0);
const DAY_MS = 86_400_000;

function slices<K extends string>(orders: AdminOrder[], keyOf: (o: AdminOrder) => K, amountOf: (o: AdminOrder) => number): DashSlice<K>[] {
  const by = new Map<K, AdminOrder[]>();
  for (const o of orders) by.set(keyOf(o), [...(by.get(keyOf(o)) ?? []), o]);
  return [...by.entries()]
    .map(([key, xs]) => ({ key, orders: xs.length, amount: sum(xs.map(amountOf)) }))
    .sort((a, b) => b.orders - a.orders || a.key.localeCompare(b.key));
}

/** Every Central day from the first order to today, empty days included, so the chart reads as a timeline. */
function days(counted: AdminOrder[], nowMs: number): DashDay[] {
  if (counted.length === 0) return [];
  const per = new Map<string, AdminOrder[]>();
  for (const o of counted) {
    const d = instantToCentral(o.placedAt).date;
    per.set(d, [...(per.get(d) ?? []), o]);
  }
  const first = [...per.keys()].sort()[0];
  const today = instantToCentral(new Date(nowMs).toISOString()).date;
  const last = today > first ? today : [...per.keys()].sort().at(-1)!;
  const out: DashDay[] = [];
  // Walk calendar days at UTC noon: no DST edge can skip or repeat a date.
  for (let ms = Date.parse(`${first}T12:00:00Z`); ; ms += DAY_MS) {
    const date = new Date(ms).toISOString().slice(0, 10);
    const xs = per.get(date) ?? [];
    out.push({ date, orders: xs.length, sales: sum(xs.map((o) => o.itemsSubtotal)) });
    if (date >= last) break;
  }
  return out;
}

export function buildSalesDashboard(input: {
  orders: AdminOrder[];
  sellers: AdminSeller[];
  sale: { scoutShare: number; round1Cutoff: string; round2Cutoff: string };
  nowMs?: number;
}): SalesDashboard {
  const { orders, sellers, sale, nowMs = Date.now() } = input;
  const scoutShare = sale.scoutShare;
  const counted = orders.filter(isCounted);
  const paidOrders = counted.filter((o) => o.paymentStatus === 'paid');
  const unpaidOrders = counted.filter((o) => o.paymentStatus !== 'paid');
  const lines = counted.flatMap((o) => o.lines);
  const profit = orderProfit(lines);

  // Sellers: every active scout (zero rows show who hasn't started), anyone credited who has since gone inactive, and the troop store.
  const byPerson = new Map<number | null, AdminOrder[]>();
  for (const o of counted) byPerson.set(o.creditedPersonId, [...(byPerson.get(o.creditedPersonId) ?? []), o]);
  const sellerOf = new Map(sellers.map((s) => [s.personId, s]));
  const people = new Set<number | null>([...sellers.filter((s) => s.active).map((s) => s.personId), ...byPerson.keys()]);
  const sellerRows: DashSeller[] = [...people].map((pid) => {
    const xs = byPerson.get(pid) ?? [];
    const s = pid == null ? null : sellerOf.get(pid);
    const items = xs.reduce((n, o) => n + itemCount(o), 0);
    const goal = s?.goal ?? null;
    return {
      personId: pid,
      name: pid == null ? 'Troop store' : (s?.name ?? xs[0]?.creditedName ?? `Person ${pid}`),
      orders: xs.length,
      items,
      sales: sum(xs.map((o) => o.itemsSubtotal)),
      owed: sum(xs.filter((o) => o.paymentStatus !== 'paid').map((o) => o.total)),
      earnings: pid == null ? 0 : scoutEarnings(orderProfit(xs.flatMap((o) => o.lines)), scoutShare),
      goal,
      goalPct: goal && goal > 0 ? items / goal : null
    };
  });
  // The troop store sits last; scouts by sales, then name.
  sellerRows.sort((a, b) => Number(a.personId == null) - Number(b.personId == null) || b.sales - a.sales || a.name.localeCompare(b.name));
  const scoutShareTotal = sum(sellerRows.map((s) => s.earnings));

  const itemsBy = new Map<number, DashItem>();
  for (const l of lines) {
    const row = itemsBy.get(l.catalogNumber) ?? { catalogNumber: l.catalogNumber, label: l.label, quantity: 0, donated: 0, sales: 0, profit: 0 };
    row.quantity += l.quantity;
    if (l.donated) row.donated += l.quantity;
    row.sales = fromCents(toCents(row.sales) + toCents(l.unitPrice) * l.quantity);
    row.profit = fromCents(toCents(row.profit) + (toCents(l.unitPrice) - toCents(l.unitCost)) * l.quantity);
    itemsBy.set(l.catalogNumber, row);
  }

  const methods = slices(paidOrders, (o) => o.paidMethod ?? 'other', (o) => o.total).map((s) => ({ method: s.key as string, orders: s.orders, amount: s.amount }));
  if (unpaidOrders.length) methods.push({ method: 'unpaid', orders: unpaidOrders.length, amount: sum(unpaidOrders.map((o) => o.total)) });

  const oldest = unpaidOrders.reduce<number | null>((min, o) => {
    const t = Date.parse(o.placedAt);
    return min == null || t < min ? t : min;
  }, null);
  const scoutHeld = unpaidOrders.filter((o) => o.source === 'paper');

  return {
    totals: {
      orders: counted.length,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
      items: lines.reduce((n, l) => n + l.quantity, 0),
      donated: lines.filter((l) => l.donated).reduce((n, l) => n + l.quantity, 0),
      sales: sum(counted.map((o) => o.itemsSubtotal)),
      gifts: sum(counted.map((o) => o.gift)),
      deliveryFees: sum(counted.map((o) => o.deliveryFee)),
      grandTotal: sum(counted.map((o) => o.total)),
      collected: sum(paidOrders.map((o) => o.total)),
      owed: sum(unpaidOrders.map((o) => o.total)),
      profit,
      scoutShare: scoutShareTotal,
      troopShare: fromCents(toCents(profit) - toCents(scoutShareTotal)),
      cardFees: sum(counted.map((o) => o.stripeFee ?? 0)),
      feesCovered: sum(counted.map((o) => o.feeCovered)),
      sellersSelling: sellerRows.filter((s) => s.personId != null && s.orders > 0).length,
      sellersActive: sellers.filter((s) => s.active).length
    },
    attention: {
      unpaid: unpaidOrders.length,
      oldestUnpaidDays: oldest == null ? null : Math.floor((nowMs - oldest) / DAY_MS),
      cardUnfinished: unpaidOrders.filter((o) => o.cardStarted).length,
      needsRefund: orders.filter((o) => o.needsRefund != null && o.refundedAt == null).length,
      toTurnIn: sum(scoutHeld.filter((o) => o.collectedByScout).map((o) => o.total)),
      toCollect: sum(scoutHeld.filter((o) => !o.collectedByScout).map((o) => o.total))
    },
    byDay: days(counted, nowMs),
    byMethod: methods,
    byChannel: slices(counted, (o) => o.source, (o) => o.itemsSubtotal),
    byFulfillment: slices(counted, (o) => o.fulfillment, (o) => o.itemsSubtotal),
    byRound: ([1, 2] as const).map((round) => {
      const xs = counted.filter((o) => o.round === round);
      const closes = round === 1 ? sale.round1Cutoff : sale.round2Cutoff;
      const left = Date.parse(closes) - nowMs;
      return { round, orders: xs.length, items: xs.reduce((n, o) => n + itemCount(o), 0), closes, daysLeft: left < 0 ? null : Math.floor(left / DAY_MS) };
    }),
    items: [...itemsBy.values()].sort((a, b) => b.quantity - a.quantity || a.catalogNumber - b.catalogNumber),
    sellers: sellerRows
  };
}
