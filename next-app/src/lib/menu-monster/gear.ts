/**
 * Menu Monster gear (Plans/Menu-Monster-Brands-Gear.md, release 2). Pure: no DB, no session.
 *
 * Where gear comes from:
 *   - a recipe's `equipment` — names, one spelling per item from the troop's gear list (mm_gear); a count
 *     rides in the name ("Skillet × 2");
 *   - the troop list's one-per-person items (the troop's mess kits), on every menu that has a meal;
 *   - a menu's own extras (a water jug, wash bins) — things no recipe names.
 *
 * How it adds up (Patrick, 2026-10-03): reusable gear is SHARED. Two foods in one meal use the same stove,
 * and so do two meals — the menu needs the most any one food asks for, never the sum. A per-person item
 * needs one for each person at the menu's biggest meal. Consumables are not gear: foil and paper towels are
 * shopping-list items.
 *
 * Packed ticks belong to the gear crew, who work while the planners are still planning: a tick remembers
 * the count it was made at, and stops counting when the plan later changes that item.
 */

import type { Catalog } from './types';
import type { Menu } from './menus';
import { cleanScoutText } from './scout-text';

export type GearHome = 'patrol_box' | 'trailer' | 'home';

/** In the order the Gear tab lists them. The troop's gear lives on the 4th floor at Northwoods (Patrick,
 *  2026-10-05, "change all references to Troop Trailer"); the stored key stays 'trailer'. */
export const GEAR_HOMES: readonly { key: GearHome; label: string }[] = [
  { key: 'trailer', label: '4th Floor NWS' },
  { key: 'patrol_box', label: 'Patrol box' },
  { key: 'home', label: 'Bring from home' }
];
export const GEAR_HOME_LABEL: Record<GearHome, string> = { trailer: '4th Floor NWS', patrol_box: 'Patrol box', home: 'Bring from home' };

/** One item on the troop's gear list (mm_gear). */
export interface GearItem {
  id: number;
  name: string;
  home: GearHome;
  perPerson: boolean;
  retiredAt: string | null;
  /** What is in it, where it is found, its size (Patrick, 2026-10-06) — captured on the Gear tab; null = none yet. */
  description?: string | null;
}
export const MAX_GEAR_DESCRIPTION = 600;

export const MAX_GEAR_NAME = 40;
export const MAX_GEAR_EXTRAS = 30;
export const MAX_GEAR_COUNT = 99;

/** The lookup key for a gear name: lower case, single spaces. */
export const gearKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** "Skillet × 2", "Skillet x2", "Skillet (x 2)" → { name: 'Skillet', count: 2 }. No count = 1. */
export function parseGear(text: string): { name: string; count: number } {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.*?)[\s(]*[×x]\s*(\d{1,2})\)?$/i);
  if (m && m[1].trim()) {
    const n = Number(m[2]);
    return { name: m[1].trim(), count: Math.min(MAX_GEAR_COUNT, Math.max(1, n)) };
  }
  return { name: t, count: 1 };
}

/** The other way: 'Skillet', 2 → "Skillet × 2". */
export const gearText = (name: string, count: number) => (count > 1 ? `${name} × ${count}` : name);

/** A typed gear entry as stored: scout-safe text, a count kept, at most 40 characters; '' when nothing is left. */
export function cleanGearEntry(raw: unknown): string {
  const { name, count } = parseGear(cleanScoutText(raw, 60));
  const n = name.slice(0, MAX_GEAR_NAME).trim();
  return n ? gearText(n, count) : '';
}

/** A menu's extras as stored: cleaned, one of each (ignoring case and count), at most 30. */
export function cleanGearExtras(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(raw) ? raw : []) {
    const t = cleanGearEntry(g);
    const k = gearKey(parseGear(t).name);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_GEAR_EXTRAS) break;
  }
  return out;
}

/** A meal's own gear as stored in the plan (Patrick, 2026-10-05: soap and wash basins belong to the meal, not a food): cleaned, one of each, A to Z, at most 30. */
export const cleanMealGear = (raw: unknown): string[] => sortGear(cleanGearExtras(raw));

/** One Packed tick, as stored in mm_menus.gear_packed under the item's key. */
export interface PackedTick {
  count: number;
  by: string;
  personId: number | null;
  at: string;
}
export type PackedTicks = Record<string, PackedTick>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Stored ticks → well-formed ones only (a hand-edited row can't smuggle a bad shape in). */
export function sanitizePacked(raw: unknown): PackedTicks {
  const out: PackedTicks = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isRecord(v) || typeof v.count !== 'number' || typeof v.at !== 'string') continue;
    out[k] = { count: v.count, by: typeof v.by === 'string' ? v.by : '', personId: typeof v.personId === 'number' ? v.personId : null, at: v.at };
  }
  return out;
}

/** What a menu keeps about gear, beside the plan: its extras and its Packed ticks. */
export interface MenuGearState {
  extras: string[];
  packed: PackedTicks;
}
export const emptyGearState = (): MenuGearState => ({ extras: [], packed: {} });

/** One row of the Gear tab. */
export interface GearRow {
  key: string;
  name: string;
  count: number;
  home: GearHome;
  perPerson: boolean;
  /** The master list's description of the item (where it lives, what a kit holds), when it has one. */
  description?: string | null;
  /** A menu extra (no recipe names it): the planner can remove it. */
  extra: boolean;
  /** The meals that need it, in menu order, with the foods that ask for it. Empty for a per-person item or an extra. */
  usedBy: { mealId: string; recipes: string[] }[];
  /** Ticked, at the count the menu needs now. */
  packed: PackedTick | null;
  /** Ticked earlier at another count: the tick no longer counts, and this says why. */
  changed: PackedTick | null;
}

/**
 * The menu's gear, one row per item: the most any one food needs (never the sum), one per person for the
 * troop's per-person items, then the menu's extras. Sorted by where it lives, then by name.
 */
export function menuGearRows(menu: Pick<Menu, 'meals' | 'headcount'>, catalog: Catalog, list: readonly GearItem[], state: MenuGearState): GearRow[] {
  const known = new Map(list.map((g) => [gearKey(g.name), g]));
  const recipes = new Map(catalog.recipes.map((r) => [r.id, r]));
  const rows = new Map<string, GearRow>();
  const row = (name: string, extra: boolean): GearRow => {
    const key = gearKey(name);
    let r = rows.get(key);
    if (!r) {
      const g = known.get(key);
      r = { key, name: g?.name ?? name, count: 0, home: g?.home ?? 'trailer', perPerson: g?.perPerson ?? false, description: g?.description?.trim() || null, extra, usedBy: [], packed: null, changed: null };
      rows.set(key, r);
    }
    return r;
  };

  const cooking = menu.meals.filter((m) => m.recipeIds.length > 0);
  for (const meal of cooking) {
    for (const rid of meal.recipeIds) {
      const recipe = recipes.get(rid);
      for (const entry of recipe?.equipment ?? []) {
        const { name, count } = parseGear(entry);
        if (!name) continue;
        const r = row(name, false);
        r.count = Math.max(r.count, count);
        const use = r.usedBy.find((u) => u.mealId === meal.id);
        if (use) {
          if (!use.recipes.includes(recipe!.name)) use.recipes.push(recipe!.name);
        } else r.usedBy.push({ mealId: meal.id, recipes: [recipe!.name] });
      }
    }
  }
  // A meal's own gear (soap, wash basins): it counts even when the meal has no food on it.
  for (const meal of menu.meals) {
    for (const entry of meal.gear ?? []) {
      const { name, count } = parseGear(entry);
      if (!name) continue;
      const r = row(name, false);
      r.count = Math.max(r.count, count);
      if (!r.usedBy.some((u) => u.mealId === meal.id)) r.usedBy.push({ mealId: meal.id, recipes: [] });
    }
  }
  if (cooking.length > 0) {
    const most = Math.max(...cooking.map((m) => m.headcount ?? menu.headcount));
    for (const g of list) {
      if (!g.perPerson || g.retiredAt) continue;
      const r = row(g.name, false);
      r.perPerson = true;
      r.count = Math.max(r.count, most);
    }
  }
  for (const entry of state.extras) {
    const { name, count } = parseGear(entry);
    if (!name) continue;
    const existing = rows.get(gearKey(name));
    if (existing) existing.count = Math.max(existing.count, count); // a recipe names it too: the bigger count wins
    else row(name, true).count = count;
  }

  for (const r of rows.values()) {
    const tick = state.packed[r.key];
    if (!tick) continue;
    if (tick.count === r.count) r.packed = tick;
    else r.changed = tick;
  }
  const order = (h: GearHome) => GEAR_HOMES.findIndex((x) => x.key === h);
  return [...rows.values()].sort((a, b) => order(a.home) - order(b.home) || a.name.localeCompare(b.name));
}

/** The gear a meal's foods ask for, one of each (the most any one food asks for), A to Z — read-only on the meal panel. */
export function mealRecipeGear(meal: { recipeIds: readonly string[] }, catalog: Pick<Catalog, 'recipes'>): string[] {
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const most = new Map<string, { name: string; count: number }>();
  for (const rid of meal.recipeIds) {
    for (const entry of byId.get(rid)?.equipment ?? []) {
      const { name, count } = parseGear(entry);
      const key = gearKey(name);
      if (!key) continue;
      const have = most.get(key);
      if (!have) most.set(key, { name, count });
      else have.count = Math.max(have.count, count);
    }
  }
  return sortGear([...most.values()].map((g) => gearText(g.name, g.count)));
}

/** A menu with the named gear taken off every meal (what a save reported as not on the list). */
export function withoutMealGear<M extends { meals: readonly { gear?: string[] }[] }>(menu: M, names: readonly string[]): M {
  const gone = new Set(names.map((n) => gearKey(n)));
  if (gone.size === 0) return menu;
  return {
    ...menu,
    meals: menu.meals.map((m) => {
      if (!m.gear) return m;
      const { gear, ...rest } = m;
      const kept = gear.filter((e) => !gone.has(gearKey(parseGear(e).name)));
      return kept.length > 0 ? { ...rest, gear: kept } : rest;
    })
  };
}

/** "7 of 12 packed". */
export function packedSummary(rows: readonly GearRow[]): { packed: number; total: number } {
  return { packed: rows.filter((r) => r.packed).length, total: rows.length };
}

/** A recipe's own gear for the Plan tab's "Steps · Gear (n)" line: its entries as written. */
export function recipeGear(recipe: { equipment?: string[] } | undefined): string[] {
  return (recipe?.equipment ?? []).filter((g) => parseGear(g).name);
}

/** Gear names on recipes / extras that the troop's list does not have yet (scouts add to the list by naming gear). */
export function unknownGearNames(entries: readonly string[], list: readonly Pick<GearItem, 'name'>[]): string[] {
  const have = new Set(list.map((g) => gearKey(g.name)));
  const out: string[] = [];
  for (const e of entries) {
    const name = parseGear(e).name.slice(0, MAX_GEAR_NAME).trim();
    const k = gearKey(name);
    if (!name || have.has(k)) continue;
    have.add(k);
    out.push(name);
  }
  return out;
}

/** Gear entries A to Z by name (case and count ignored); equal names keep their order. */
export function sortGear<T extends string>(entries: readonly T[]): T[] {
  return entries
    .map((e, i) => ({ e, i, k: gearKey(parseGear(e).name) }))
    .sort((a, b) => a.k.localeCompare(b.k) || a.i - b.i)
    .map((x) => x.e);
}

/**
 * What a gear picker offers (Patrick, 2026-10-05: gear is picked from the master list, never added on the
 * fly): the live master items whose name contains the query, not already taken, A to Z. `taken` is entries
 * as stored ("Skillet × 2"); only the name counts.
 */
export function gearPickOptions(list: readonly GearItem[], query: string, taken: readonly string[]): GearItem[] {
  const q = gearKey(query);
  const have = new Set(taken.map((t) => gearKey(parseGear(t).name)));
  return list
    .filter((g) => !g.retiredAt && !have.has(gearKey(g.name)) && gearKey(g.name).includes(q))
    .sort((a, b) => gearKey(a.name).localeCompare(gearKey(b.name)));
}

/**
 * Gear as a write keeps it (Patrick, 2026-10-05: gear is picked from the master list, never added on the
 * fly): each entry in the master list's own spelling (count kept), A to Z, one of each. Anything the list
 * lacks is dropped and reported by name. A RETIRED item is kept only when `stored` (what the recipe or menu
 * already holds) names it, so retiring an item never strips it from the recipes that use it.
 */
export function resolveGear(entries: readonly unknown[], list: readonly GearItem[], stored: readonly string[] = []): { kept: string[]; dropped: string[] } {
  const master = new Map(list.map((g) => [gearKey(g.name), g]));
  const had = new Set(stored.map((e) => gearKey(parseGear(e).name)));
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of entries.slice(0, MAX_GEAR_EXTRAS * 2)) {
    const { name, count } = parseGear(cleanGearEntry(raw));
    const k = gearKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const item = master.get(k);
    if (item && (!item.retiredAt || had.has(k))) kept.push(gearText(item.name, count));
    else dropped.push(name);
  }
  return { kept: sortGear(kept).slice(0, MAX_GEAR_EXTRAS), dropped };
}
