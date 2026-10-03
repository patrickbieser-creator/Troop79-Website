/**
 * The unsaved menu a visitor or leader keeps on this computer (IA correction,
 * 2026-10-02). One localStorage key holds one Menu, run through sanitizeMenu on
 * every read AND every write, so nothing malformed or oversized round-trips.
 * No snapshot, actuals, price reports or version token: those need a saved menu.
 *
 * Storage may be blocked (private mode) or throw: reads then return no menu and
 * writes return false, and the page keeps working from memory.
 */

import type { Catalog } from './types';
import { sanitizeMenu, type Menu } from './menus';
import { dropLegacyDraft, foldLegacyDraft } from './legacy-draft';

export const LOCAL_MENU_KEY = 'troop79.menuMonster.menu.local.v1';

export interface LocalRead {
  menu: Menu | null;
  /** Recipes the stored text named that the catalog no longer holds (a quiet notice, not a silent drop). */
  dropped: number;
}

const recipeCount = (raw: unknown): number => {
  const meals = typeof raw === 'object' && raw !== null ? (raw as { meals?: unknown }).meals : null;
  if (!Array.isArray(meals)) return 0;
  return meals.reduce((n: number, m: unknown) => {
    const ids = typeof m === 'object' && m !== null ? (m as { recipeIds?: unknown }).recipeIds : null;
    return n + (Array.isArray(ids) ? ids.length : 0);
  }, 0);
};

/**
 * The stored menu. When none is stored, an old planner draft folds in ONCE
 * (menuFromDraft), is written as the local menu, and its key is removed. With a
 * local menu already stored the old key is left alone, never merged.
 */
export function readLocalMenu(catalog: Catalog): LocalRead {
  let text: string | null = null;
  try {
    text = window.localStorage.getItem(LOCAL_MENU_KEY);
  } catch {
    return { menu: null, dropped: 0 };
  }
  if (!text) {
    const folded = foldLegacyDraft(catalog);
    if (!folded) return { menu: null, dropped: 0 };
    if (writeLocalMenu(folded, catalog)) dropLegacyDraft();
    return { menu: folded, dropped: 0 };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { menu: null, dropped: 0 };
  }
  const menu = sanitizeMenu(raw, catalog);
  const kept = menu.meals.reduce((n, m) => n + m.recipeIds.length, 0);
  return { menu, dropped: Math.max(0, recipeCount(raw) - kept) };
}

/** Store a menu (sanitized first). False when storage refused it. */
export function writeLocalMenu(menu: Menu, catalog: Catalog): boolean {
  try {
    window.localStorage.setItem(LOCAL_MENU_KEY, JSON.stringify(sanitizeMenu(menu, catalog)));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalMenu(): void {
  try {
    window.localStorage.removeItem(LOCAL_MENU_KEY);
  } catch {
    // Blocked storage: nothing was stored to clear.
  }
}

/**
 * Another tab changed (or cleared) the local menu. The `storage` event fires in
 * the OTHER documents only, so this never echoes this tab's own writes. Returns
 * the unsubscribe function.
 */
export function onLocalMenuChange(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === null || e.key === LOCAL_MENU_KEY) cb();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
