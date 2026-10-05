'use client';

import { createContext, type ReactNode } from 'react';

/**
 * Set (to the menu's id) while a LEADER is working on someone else's menu (Patrick, 2026-10-05: leaders
 * "often will work side by side with scouts on their menus at troop meetings"). The small forms that add
 * something new from inside a menu — a typed-in ingredient, a package the price book lacks — read it and
 * name the menu to the server, which then files the new thing under the menu's OWNER, where the menu can
 * use it. Null for the owner on their own menu, and everywhere else.
 */
export const HelperMenu = createContext<string | null>(null);

/** Wraps a menu page's tab (a server page cannot render a context provider itself). */
export function HelperMenuScope({ menuId, children }: { menuId: string | null; children: ReactNode }) {
  return <HelperMenu.Provider value={menuId}>{children}</HelperMenu.Provider>;
}
