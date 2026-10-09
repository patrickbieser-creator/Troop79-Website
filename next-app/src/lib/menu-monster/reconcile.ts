/**
 * Planned vs bought, meal by meal (Plans/Menu-Monster-Receipt-Reconciliation.md). Pure: no DB, no session.
 *
 * A shared shopping line (milk for three breakfasts) is one purchase, so its spend is allocated to the meals
 * that use it by each meal's share of the amount needed (`usedBy`). What a line cost "as bought" is what the
 * scouts recorded on it (items qty x price paid), the plan's spend while nobody has recorded it, and nothing
 * for a line marked not bought. Receipt lines placed on a meal as "not on the plan" are added to that meal.
 */

import type { Catalog } from './types';
import type { Menu } from './menus';
import { boughtRows, type Bought } from './bought';
import { buildMenuList } from './menu-view';
import { cleanScoutText } from './scout-text';
import { MEALS } from './units';

/** A menu's meals by day, then in the order of the day (breakfast … dessert), whatever order they were stored in. */
export function mealsInOrder<M extends { day: number; slot: Menu['meals'][number]['slot'] }>(menu: { meals: readonly M[] }): M[] {
  const order = new Map(MEALS.map((m, i) => [m.key, i]));
  return [...menu.meals].sort((a, b) => a.day - b.day || (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));
}

export type ReceiptLineStatus = 'pending' | 'confirmed' | 'extra' | 'skipped';

export interface ReceiptLine {
  id: number;
  position: number;
  rawName: string;
  storeCode: string | null;
  unitPrice: number;
  qty: number;
  taxCode: string | null;
  proposedIngredientId: string | null;
  status: ReceiptLineStatus;
  ingredientId: string | null;
  mealId: string | null;
  label: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface Receipt {
  id: string;
  menuId: string;
  store: string;
  boughtAt: string;
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
  lines: ReceiptLine[];
}

export interface PlannedItem {
  ingredientId: string;
  name: string;
  /** Packages on the whole shopping line (a shared line is one purchase). */
  qty: number;
  pkgName: string;
  /** This meal's share of the line's planned spend. */
  spent: number;
}

export interface BoughtMealItem {
  ingredientId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  /** This meal's share of the item's spend (all of it for an extra). */
  spent: number;
  kind: 'as_planned' | 'changed' | 'extra';
  note: string;
}

export interface MealReconciliation {
  mealId: string;
  planned: { cost: number; perPerson: number; items: PlannedItem[] };
  bought: { cost: number; perPerson: number; items: BoughtMealItem[]; notBought: { ingredientId: string; name: string }[] };
  /** bought.cost - planned.cost. */
  delta: number;
}

export interface Reconciliation {
  meals: MealReconciliation[];
  totals: {
    planned: number;
    bought: number;
    receiptTotal: number | null;
    /** Priced ingredients nobody has recorded yet (their "bought" is the plan's number). */
    unconfirmed: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function reconcileMeals(menu: Menu, catalog: Catalog, bought: Bought, receipt: Receipt | null): Reconciliation {
  const list = buildMenuList(menu, catalog).lines;
  const usedByIng = new Map(list.map((l) => [l.ing.id, l.usedBy]));
  const rows = boughtRows(list, bought);
  const meals = new Map<string, MealReconciliation>();
  const raw = new Map<string, { planned: number; bought: number }>();
  const headcount = (mealId: string) => menu.meals.find((m) => m.id === mealId)?.headcount ?? menu.headcount;
  for (const m of mealsInOrder(menu)) {
    meals.set(m.id, { mealId: m.id, planned: { cost: 0, perPerson: 0, items: [] }, bought: { cost: 0, perPerson: 0, items: [], notBought: [] }, delta: 0 });
    raw.set(m.id, { planned: 0, bought: 0 });
  }

  let unconfirmed = 0;
  for (const row of rows) {
    const id = row.line.ing.id;
    if (!bought.lines[id] && row.state !== 'no_price') unconfirmed++;
    const uses = (usedByIng.get(id) ?? []).filter((u) => meals.has(u.mealId));
    if (uses.length === 0) continue;
    const totalAmount = uses.reduce((n, u) => n + u.amount, 0);
    const share = (mealId: string) => (totalAmount > 0 ? (uses.find((u) => u.mealId === mealId)!.amount / totalAmount) : 1 / uses.length);
    const plannedSpend = row.planned.reduce((n, x) => n + x.qty * x.pricePaid, 0);

    for (const u of uses) {
      const s = share(u.mealId);
      const meal = meals.get(u.mealId)!;
      const r = raw.get(u.mealId)!;
      if (row.planned.length > 0) {
        r.planned += plannedSpend * s;
        meal.planned.items.push({ ingredientId: id, name: row.line.ing.name, qty: row.line.qty, pkgName: row.line.pkg?.name ?? '', spent: round2(plannedSpend * s) });
      }
      if (row.state === 'not_bought') {
        meal.bought.notBought.push({ ingredientId: id, name: row.line.ing.name });
        continue;
      }
      const kind = row.state === 'changed' ? 'changed' : 'as_planned';
      const note = row.state === 'changed' ? 'Differs from the plan' : row.state === 'unconfirmed' ? 'As planned, not confirmed' : '';
      for (const item of row.items) {
        const spent = item.qty * item.pricePaid * s;
        r.bought += spent;
        meal.bought.items.push({ ingredientId: id, name: row.line.ing.name, qty: item.qty, unitPrice: item.pricePaid, spent: round2(spent), kind, note });
      }
    }
  }

  for (const l of receipt?.lines ?? []) {
    if (l.status !== 'extra' || !l.mealId) continue;
    const meal = meals.get(l.mealId);
    if (!meal) continue;
    const spent = l.qty * l.unitPrice;
    raw.get(l.mealId)!.bought += spent;
    meal.bought.items.push({ ingredientId: l.ingredientId, name: l.label?.trim() || l.rawName, qty: l.qty, unitPrice: l.unitPrice, spent: round2(spent), kind: 'extra', note: l.rawName });
  }

  let planned = 0;
  let boughtSum = 0;
  for (const [mealId, meal] of meals) {
    const r = raw.get(mealId)!;
    const people = Math.max(1, headcount(mealId));
    meal.planned.cost = round2(r.planned);
    meal.planned.perPerson = round2(r.planned / people);
    meal.bought.cost = round2(r.bought);
    meal.bought.perPerson = round2(r.bought / people);
    meal.delta = round2(r.bought - r.planned);
    planned += r.planned;
    boughtSum += r.bought;
  }
  return { meals: [...meals.values()], totals: { planned: round2(planned), bought: round2(boughtSum), receiptTotal: receipt ? receipt.total : null, unconfirmed } };
}

/* ---------------------------------------------------------------- receipt input */

export interface ReceiptInputLine {
  storeCode: string | null;
  rawName: string;
  unitPrice: number;
  qty: number;
  taxCode: string | null;
  proposedIngredientId: string | null;
  note: string | null;
}

export interface ReceiptInput {
  menuId: string;
  store: string;
  boughtAt: string;
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
  source: 'photo' | 'manual';
  note: string | null;
  lines: ReceiptInputLine[];
}

export const MAX_RECEIPT_LINES = 300;
const MAX_MONEY = 99999999.99;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ING_ID = /^[A-Za-z0-9:_-]{1,100}$/;

/** Money as a number of cents-exact dollars; throws on anything that is not a finite 0..99,999,999.99. */
function money(v: unknown, what: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_MONEY) throw new Error(`receipt: ${what} must be an amount of money`);
  return Math.round(n * 100) / 100;
}

/** A receipt as it may be stored: money to cents, quantities 1..99, scout text cleaned, at most 300 lines. Throws a plain message when it cannot be. */
export function cleanReceiptInput(raw: unknown): ReceiptInput {
  if (!isRecord(raw)) throw new Error('receipt: not an object');
  const menuId = raw.menuId;
  if (typeof menuId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(menuId)) throw new Error('receipt: menuId must be a menu id');
  const boughtAt = typeof raw.boughtAt === 'string' ? new Date(raw.boughtAt) : null;
  if (!boughtAt || Number.isNaN(boughtAt.getTime())) throw new Error('receipt: boughtAt must be a date and time');
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) throw new Error('receipt: no lines');
  if (raw.lines.length > MAX_RECEIPT_LINES) throw new Error(`receipt: more than ${MAX_RECEIPT_LINES} lines`);
  const lines = raw.lines.map((l, i): ReceiptInputLine => {
    if (!isRecord(l)) throw new Error(`receipt: line ${i + 1} is not an object`);
    const rawName = cleanScoutText(l.rawName ?? l.name, 120);
    if (rawName === '') throw new Error(`receipt: line ${i + 1} has no name`);
    const qty = Number(l.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error(`receipt: line ${i + 1} quantity must be a whole number 1..99`);
    const prop = l.proposedIngredientId;
    return {
      storeCode: cleanScoutText(l.storeCode ?? l.code, 30) || null,
      rawName,
      unitPrice: money(l.unitPrice ?? l.price, `line ${i + 1} price`),
      qty,
      taxCode: cleanScoutText(l.taxCode ?? l.tax, 10) || null,
      proposedIngredientId: typeof prop === 'string' && ING_ID.test(prop) ? prop : null,
      note: cleanScoutText(l.note, 300) || null
    };
  });
  const itemCount = Number(raw.itemCount ?? lines.reduce((n, l) => n + l.qty, 0));
  return {
    menuId,
    store: cleanScoutText(raw.store, 120),
    boughtAt: boughtAt.toISOString(),
    subtotal: money(raw.subtotal ?? 0, 'subtotal'),
    tax: money(raw.tax ?? 0, 'tax'),
    total: money(raw.total ?? 0, 'total'),
    itemCount: Number.isInteger(itemCount) && itemCount >= 0 && itemCount <= 9999 ? itemCount : 0,
    source: raw.source === 'photo' ? 'photo' : 'manual',
    note: cleanScoutText(raw.note, 500) || null,
    lines
  };
}
