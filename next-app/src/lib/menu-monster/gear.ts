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

/** In the order the Gear tab lists them. */
export const GEAR_HOMES: readonly { key: GearHome; label: string }[] = [
  { key: 'trailer', label: 'Troop trailer' },
  { key: 'patrol_box', label: 'Patrol box' },
  { key: 'home', label: 'Bring from home' }
];
export const GEAR_HOME_LABEL: Record<GearHome, string> = { trailer: 'Troop trailer', patrol_box: 'Patrol box', home: 'Bring from home' };

/** One item on the troop's gear list (mm_gear). */
export interface GearItem {
  id: number;
  name: string;
  home: GearHome;
  perPerson: boolean;
  retiredAt: string | null;
}

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
      r = { key, name: g?.name ?? name, count: 0, home: g?.home ?? 'trailer', perPerson: g?.perPerson ?? false, extra, usedBy: [], packed: null, changed: null };
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
