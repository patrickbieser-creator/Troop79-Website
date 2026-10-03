/**
 * Scout recipes (Plans/Menu-Monster-Scout-Workspace.md, Phase 4). Pure helpers:
 * the S-<8 hex> id, which recipes a picker offers, and the text rules every
 * scout-written string passes before it reaches the database (the RPC checks
 * them again — mm_scout_text_ok).
 */

import type { Recipe } from './types';

const SCOUT_ID = /^S-[0-9a-f]{8}$/;

/** True for a scout-written recipe's id. */
export const isScoutRecipeId = (id: unknown): id is string => typeof id === 'string' && SCOUT_ID.test(id);

/** A fresh scout recipe id. */
export function newScoutRecipeId(rand: () => number = Math.random): string {
  let hex = '';
  for (let i = 0; i < 8; i++) hex += Math.floor(rand() * 16).toString(16);
  return `S-${hex}`;
}

/** Whether a picker may offer the recipe. Retired recipes stay in the catalog so menus keep them, but are never offered. */
export const isPickable = (r: Pick<Recipe, 'status'>) => r.status !== 'retired';
