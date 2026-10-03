/**
 * The old single-meal planner's browser draft (retired 2026-10-02). It is folded
 * into the local menu ONCE and then removed. The key lives here, not in
 * planner.tsx, so nothing live depends on the retiring planner for it.
 */

import type { Catalog } from './types';
import { restorePlan } from './engine';
import { menuFromDraft, type Menu } from './menus';

export const PLAN_STORAGE_KEY = 'troop79.menuMonster.plan.v1';

/**
 * The draft as a one-meal menu, or null when there is none worth keeping (no
 * key, not JSON, no recipes). Storage can throw; then there is nothing to fold.
 */
export function foldLegacyDraft(catalog: Catalog): Menu | null {
  try {
    const text = window.localStorage.getItem(PLAN_STORAGE_KEY);
    if (!text) return null;
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { recipeIds?: unknown }).recipeIds)) return null;
    const plan = restorePlan(raw, catalog);
    if (plan.recipeIds.length === 0) return null;
    return menuFromDraft(plan, catalog);
  } catch {
    return null;
  }
}

/** Remove the old key once its menu is safely stored. Blocked storage is ignored. */
export function dropLegacyDraft(): void {
  try {
    window.localStorage.removeItem(PLAN_STORAGE_KEY);
  } catch {
    // Blocked storage: the draft may fold again next visit, which is harmless.
  }
}
