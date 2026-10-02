/**
 * The priced snapshot a menu stores on every save (Plans/Menu-Monster-Scout-
 * Workspace.md, Phase 1): the merged shopping list as it cost the day it was
 * saved. Two jobs — the menu can still render after a recipe or package is
 * retired, and the Shopping tab can tell when the live price book has moved
 * ("Prices in the troop price book changed since you saved: $X → $Y").
 *
 * Pure. Built SERVER-side (menus-store.ts) from the same buildMenuList the
 * Shopping tab renders; a snapshot a client sends is never read.
 */

import type { Catalog } from './types';
import { centralToday } from '@/lib/dates';
import { buildMenuList } from './menu-view';
import type { Menu } from './menus';

export interface SnapshotLine {
  ingredientId: string;
  name: string;
  /** The package in effect; '' when nothing is priced. */
  pkgLabel: string;
  /** Packages being bought; 0 for staples, bring-from-home and unpriced lines. */
  qty: number;
  unitPrice: number;
  spent: number;
}

export interface MenuSnapshot {
  v: 1;
  /** The newest package price date used, or the day it was saved when nothing was priced. */
  asOf: string;
  totals: { spent: number; used: number; left: number };
  /** Spent a person per meal. */
  perPerson: number;
  lines: SnapshotLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildSnapshot(menu: Menu, catalog: Catalog, today: string = centralToday()): MenuSnapshot {
  const list = buildMenuList(menu, catalog);
  let asOf = '';
  const lines: SnapshotLine[] = list.lines.map((l) => {
    const buying = l.status === 'ok' || l.status === 'short';
    if (buying && l.pkg?.asOf && l.pkg.asOf > asOf) asOf = l.pkg.asOf;
    return {
      ingredientId: l.ing.id,
      name: l.ing.name,
      pkgLabel: l.pkg?.name ?? '',
      qty: buying ? l.qty : 0,
      unitPrice: l.pkg?.price ?? 0,
      spent: round2(l.spent)
    };
  });
  return {
    v: 1,
    asOf: asOf || today,
    totals: { spent: round2(list.totals.spent), used: round2(list.totals.used), left: round2(list.totals.left) },
    perPerson: round2(list.perPersonMeal),
    lines
  };
}

/** What the saved menu cost vs. what it costs today, or null when they agree
 *  to the cent (or there is no snapshot yet). */
export function snapshotDrift(
  snapshot: Pick<MenuSnapshot, 'totals'> | null,
  menu: Menu,
  catalog: Catalog
): { saved: number; live: number } | null {
  if (!snapshot) return null;
  const live = buildMenuList(menu, catalog).totals.spent;
  const saved = snapshot.totals.spent;
  return Math.abs(round2(live) - round2(saved)) >= 0.01 ? { saved, live } : null;
}
