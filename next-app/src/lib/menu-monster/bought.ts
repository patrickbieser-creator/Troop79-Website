/**
 * "What we bought" (Plans/Menu-Monster-Brands-Gear.md, release 4). Pure: no DB, no session.
 *
 * The checklist is PREFILLED from the plan: every line the menu buys starts "as planned" at the expected
 * price, and a scout touches only what differed — a different price, a different brand, an extra brand, or
 * "didn't buy it". A line nobody has touched has no stored entry: it reads "as planned, not confirmed" until
 * someone ticks "We're done shopping", after which it counts as bought as planned.
 *
 * Stored per line (mm_menus.bought.lines[ingredientId]), written one line at a time, with who and when.
 */

import type { Brand, Catalog, Package, ShoppingLine } from './types';
import type { Actuals } from './menus';
import { isUsable } from './engine';

/** One thing bought for a line. packageId null = no package named (an "any brand" line confirmed at a price). */
export interface BoughtItem {
  brandId: string | null;
  packageId: string | null;
  qty: number;
  /** Price paid for ONE package. */
  pricePaid: number;
}

export interface Stamp {
  by: string;
  personId: number | null;
  at: string;
}

export interface BoughtLine extends Stamp {
  status: 'bought' | 'not_bought';
  /** Empty for not_bought. */
  items: BoughtItem[];
}

export interface Bought {
  lines: Record<string, BoughtLine>;
  /** "We're done shopping": untouched lines now count as bought as planned. */
  done: Stamp | null;
}

export const emptyBought = (): Bought => ({ lines: {}, done: null });

export const MAX_BOUGHT_QTY = 99;
export const MIN_BOUGHT_PRICE = 0.01;
export const MAX_BOUGHT_PRICE = 9999.99;
export const MAX_BOUGHT_ITEMS = 8;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9:_-]{1,100}$/;
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

function stampOf(v: unknown): Stamp | null {
  if (!isRecord(v) || typeof v.at !== 'string') return null;
  return { by: typeof v.by === 'string' ? v.by : '', personId: typeof v.personId === 'number' ? v.personId : null, at: v.at };
}

/** Items as they may be stored: whole counts 0..99, a price 0.01..9999.99 to the cent, at most eight. */
export function sanitizeItems(raw: unknown): BoughtItem[] {
  const out: BoughtItem[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_BOUGHT_ITEMS) break;
    if (!isRecord(x)) continue;
    const qty = typeof x.qty === 'number' && Number.isInteger(x.qty) && x.qty >= 0 && x.qty <= MAX_BOUGHT_QTY ? x.qty : null;
    const price = typeof x.pricePaid === 'number' && Number.isFinite(x.pricePaid) ? round2(x.pricePaid) : NaN;
    if (qty == null || !(price >= MIN_BOUGHT_PRICE && price <= MAX_BOUGHT_PRICE)) continue;
    out.push({ brandId: idOrNull(x.brandId), packageId: idOrNull(x.packageId), qty, pricePaid: price });
  }
  return out;
}

/** The stored column → well-formed entries only (a hand-edited row can't smuggle a bad shape in). */
export function sanitizeBought(raw: unknown): Bought {
  const out = emptyBought();
  if (!isRecord(raw)) return out;
  if (isRecord(raw.lines)) {
    for (const [ing, v] of Object.entries(raw.lines)) {
      const stamp = stampOf(v);
      if (!ID.test(ing) || !isRecord(v) || !stamp) continue;
      if (v.status === 'not_bought') out.lines[ing] = { ...stamp, status: 'not_bought', items: [] };
      else if (v.status === 'bought') {
        const items = sanitizeItems(v.items);
        if (items.length > 0) out.lines[ing] = { ...stamp, status: 'bought', items };
      }
    }
  }
  out.done = stampOf(raw.done);
  return out;
}

/** The old "What you paid" entries, read as bought lines (nothing writes actuals any more). */
export function boughtFromActuals(actuals: Actuals, catalog: Pick<Catalog, 'packages'>, at: string): Record<string, BoughtLine> {
  const pkgById = new Map(catalog.packages.map((p) => [p.id, p]));
  const out: Record<string, BoughtLine> = {};
  for (const [ing, a] of Object.entries(actuals)) {
    out[ing] = { status: 'bought', items: [{ brandId: pkgById.get(a.packageId)?.brandId ?? null, packageId: a.packageId, qty: a.qty, pricePaid: a.pricePaid }], by: '', personId: null, at };
  }
  return out;
}

/** What the plan expected of a line: one item per chosen brand, or one "any brand" item. Empty when nothing is priced. */
export function plannedItems(l: ShoppingLine): BoughtItem[] {
  if (l.status !== 'ok' && l.status !== 'short') return [];
  if (l.parts && l.parts.length > 0) return l.parts.map((x) => ({ brandId: x.brand.id, packageId: x.estimated ? null : x.pkg.id, qty: x.qty, pricePaid: round2(x.pkg.price) }));
  if (!l.pkg) return [];
  // "Any brand": no package is named — the shopper's choice. An explicit package choice (or an ingredient
  // with no brands at all) IS the package.
  return [{ brandId: l.estimated ? null : (l.pkg.brandId ?? null), packageId: l.estimated ? null : l.pkg.id, qty: l.qty, pricePaid: round2(l.pkg.price) }];
}

export type RowState = 'unconfirmed' | 'as_planned' | 'changed' | 'not_bought';

/** One row of the checklist. */
export interface BoughtRow {
  line: ShoppingLine;
  planned: BoughtItem[];
  /** What the row shows: the stored items, or the plan's when nothing is stored. */
  items: BoughtItem[];
  state: RowState;
  /** Who recorded it; null while nobody has (or for an untouched line after the done tick). */
  stamp: Stamp | null;
  /** qty × price over the items; 0 when not bought. */
  total: number;
}

const sameItems = (a: readonly BoughtItem[], b: readonly BoughtItem[]) =>
  a.length === b.length && a.every((x, i) => x.brandId === b[i].brandId && x.packageId === b[i].packageId && x.qty === b[i].qty && Math.abs(x.pricePaid - b[i].pricePaid) < 0.005);

/**
 * The checklist: the menu's buying lines (store-room, bring-from-home and unpriced lines are not bought, so
 * they are not here), each with what was recorded or, failing that, what the plan expected.
 */
export function boughtRows(lines: readonly ShoppingLine[], bought: Bought): BoughtRow[] {
  const rows: BoughtRow[] = [];
  for (const line of lines) {
    const planned = plannedItems(line);
    if (planned.length === 0) continue;
    const entry = bought.lines[line.ing.id];
    if (!entry) {
      rows.push({ line, planned, items: planned, state: bought.done ? 'as_planned' : 'unconfirmed', stamp: null, total: sum(planned) });
    } else if (entry.status === 'not_bought') {
      rows.push({ line, planned, items: [], state: 'not_bought', stamp: entry, total: 0 });
    } else {
      rows.push({ line, planned, items: entry.items, state: sameItems(entry.items, planned) ? 'as_planned' : 'changed', stamp: entry, total: sum(entry.items) });
    }
  }
  return rows;
}

const sum = (items: readonly BoughtItem[]) => round2(items.reduce((n, x) => n + x.qty * x.pricePaid, 0));

export interface BoughtTotals {
  /** What the plan expected to spend on these lines. */
  planned: number;
  /** What was paid: recorded lines as recorded, untouched lines as planned. */
  paid: number;
  bought: number;
  notBought: number;
  /** Lines nobody has recorded yet (always 0 once done is ticked). */
  unconfirmed: number;
  total: number;
  /** True until "We're done shopping": `paid` still leans on the plan for untouched lines. */
  projected: boolean;
}

export function boughtTotals(rows: readonly BoughtRow[], done: boolean): BoughtTotals {
  const t: BoughtTotals = { planned: 0, paid: 0, bought: 0, notBought: 0, unconfirmed: 0, total: rows.length, projected: false };
  for (const r of rows) {
    t.planned += sum(r.planned);
    t.paid += r.total;
    if (r.state === 'not_bought') t.notBought++;
    else if (r.state === 'unconfirmed') t.unconfirmed++;
    else t.bought++;
  }
  t.planned = round2(t.planned);
  t.paid = round2(t.paid);
  t.projected = !done && t.unconfirmed > 0;
  return t;
}

/** "Recorded by Maya and Sam · Oct 3": everyone who recorded a line, in the order they first did, and the latest date. */
export function recorders(bought: Bought): { names: string[]; latest: string | null } {
  const stamps = [...Object.values(bought.lines), ...(bought.done ? [bought.done] : [])].filter((s) => s.at).sort((a, b) => a.at.localeCompare(b.at));
  const names: string[] = [];
  for (const s of stamps) if (s.by && !names.includes(s.by)) names.push(s.by);
  return { names, latest: stamps.length > 0 ? stamps[stamps.length - 1].at : null };
}

/** The brand an item names, for display: its name, or null for "any brand". */
export function itemBrand(item: BoughtItem, catalog: Pick<Catalog, 'brands' | 'packages'>): Brand | null {
  const id = item.brandId ?? catalog.packages.find((p) => p.id === item.packageId)?.brandId ?? null;
  return id ? ((catalog.brands ?? []).find((b) => b.id === id) ?? null) : null;
}

/** The package a "different brand" pick records against: that brand's cheapest usable one, or null (no price yet). */
export function brandPackage(brandId: string, catalog: Pick<Catalog, 'packages'>): Package | null {
  const own = catalog.packages.filter((p) => p.brandId === brandId && isUsable(p) && !p.retiredAt);
  return own.length > 0 ? own.reduce((a, b) => (b.price < a.price ? b : a)) : null;
}

/**
 * What a client may send for one line → what may be stored, checked against the catalog: every package and
 * brand must belong to the line's ingredient. Returns null for a payload that cannot be stored.
 */
export function cleanLineInput(
  ingredientId: string,
  raw: unknown,
  catalog: Pick<Catalog, 'ingredients' | 'packages' | 'brands'>
): { status: 'bought'; items: BoughtItem[] } | { status: 'not_bought' } | null {
  if (!isRecord(raw) || !catalog.ingredients.some((i) => i.id === ingredientId)) return null;
  if (raw.status === 'not_bought') return { status: 'not_bought' };
  if (raw.status !== 'bought') return null;
  const pkgs = new Map(catalog.packages.filter((p) => p.ingredientId === ingredientId).map((p) => [p.id, p]));
  const brands = new Set((catalog.brands ?? []).filter((b) => b.ingredientId === ingredientId && !b.retiredAt).map((b) => b.id));
  const items: BoughtItem[] = [];
  for (const x of sanitizeItems(raw.items)) {
    if (x.packageId != null && !pkgs.has(x.packageId)) return null;
    const brandId = x.packageId != null ? (pkgs.get(x.packageId)?.brandId ?? null) : x.brandId;
    if (brandId != null && !brands.has(brandId)) return null;
    items.push({ ...x, brandId });
  }
  return items.length > 0 ? { status: 'bought', items } : null;
}
