/**
 * Where a menu is kept, as the Plan, meal and Shopping components see it
 * (IA correction, Plans/Menu-Monster-Scout-Workspace.md, 2026-10-02). Two
 * implementations: the SERVER store (a signed-in scout's saved menu, version
 * checked) and the LOCAL store (an unsaved menu kept in this browser).
 *
 * The components never ask which one they have. They read capability flags:
 *   canSave   - saves to the scout's account (My menus). False = saved on this
 *               computer only, which changes the wording around Save.
 *   canPay    - "What you paid" exists (needs a saved menu to hang actuals on).
 *   canReport - prices can be reported to the troop price book and a price
 *               snapshot exists, so "Prices have changed / Update prices" shows.
 */

import type { Menu } from './menus';

export interface MenuCaps {
  canSave: boolean;
  canPay: boolean;
  canReport: boolean;
}

/** `dropped`: meal-gear names the troop's list does not have, which the server did not keep. */
export type SaveResult = { ok: true; updatedAt: string | null; dropped?: string[] } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string; dropped?: string[] } | { ok: false; error: string };

export interface StoredState {
  menu: Menu;
  /** The version token to send back with the next save (null: this store has none). */
  updatedAt: string | null;
}

export interface MenuStore {
  caps: MenuCaps;
  /** Where the menu's own pages live. */
  hrefs: { plan: string; shopping: string; /** Absent on a menu kept on this computer (it has no Gear page): Next goes to Shopping. */ gear?: string; meal: (mealId: string) => string };
  /** The menu as it stands now (null when nothing is stored yet). */
  load(): StoredState | null;
  /** Save an existing menu. `version` is the token from the last load / save. */
  save(menu: Menu, version: string | null): Promise<SaveResult>;
  /** First save of a brand-new menu. */
  create(menu: Menu): Promise<CreateResult>;
  /** Where to go after a create: null = stay on this page (the menu has no URL of its own to move to). */
  /** Where a first save goes (null = stay); `openMealId` keeps that meal open there. */
  afterCreate(id: string, openMealId?: string): string | null;
}
