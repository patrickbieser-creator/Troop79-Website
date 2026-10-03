/**
 * The SERVER MenuStore: a signed-in scout's saved menu. A thin adapter over the
 * existing create / save server actions (menu-actions.ts), so behavior is exactly
 * what the components did before the store existed: the owner is the session
 * scout, the payload is re-sanitized on the server, saves are version-checked.
 *
 * Client components build it themselves (a store carries functions, so a server
 * page cannot pass one down); `initial` is what the page loaded on the server.
 */

import type { MenuStore, StoredState } from '@/lib/menu-monster/menu-store';
import { createMenuAction, saveMenuAction } from '../../../_tools/menu-monster/menu-actions';

const MENUS_HREF = '/library/menu-monster/menus';

export function serverMenuStore(menuId: string | null, initial: StoredState | null = null): MenuStore {
  const base = `${MENUS_HREF}/${menuId}`;
  return {
    caps: { canSave: true, canPay: true, canReport: true },
    hrefs: { plan: base, shopping: `${base}/shopping`, meal: (mealId) => `${base}/meals/${mealId}` },
    load: () => initial,
    save: async (menu, version) => {
      if (menuId === null) return { ok: false, error: 'Save this menu first.' };
      const res = await saveMenuAction(menuId, menu, version ?? '');
      return res.ok ? { ok: true, updatedAt: res.updatedAt } : res;
    },
    create: (menu) => createMenuAction(menu),
    afterCreate: (id, openMealId) => `${MENUS_HREF}/${id}${openMealId ? `/meals/${openMealId}` : ''}`
  };
}
