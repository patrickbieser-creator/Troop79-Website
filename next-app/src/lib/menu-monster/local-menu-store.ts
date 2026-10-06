/**
 * The LOCAL MenuStore: the menu lives in this browser (local-menu.ts). Saving is
 * explicit (the Save button, like every edit form) and means "saved on this
 * computer". No version token and no conflict check: two tabs are last-write-wins
 * and the shell reloads the other tab's state on the `storage` event.
 */

import type { Catalog } from './types';
import type { MenuStore } from './menu-store';
import { readLocalMenu, writeLocalMenu } from './local-menu';

export const LOCAL_MENU_HREFS = {
  people: '/library/menu-monster/menus/local/people',
  plan: '/library/menu-monster/menus/local',
  shopping: '/library/menu-monster/menus/local/shopping',
  /** A meal opens inline on the Plan tab (2026-10-03); the old meal page redirects here. */
  meal: (mealId: string) => `/library/menu-monster/menus/local?meal=${encodeURIComponent(mealId)}`
};

const BLOCKED = 'This browser won’t let us save on this computer. Sign in to save your menu instead.';

export function localMenuStore(catalog: Catalog): MenuStore {
  const write: MenuStore['save'] = async (menu) => (writeLocalMenu(menu, catalog) ? { ok: true, updatedAt: null } : { ok: false, error: BLOCKED });
  return {
    caps: { canSave: false, canPay: false, canReport: false },
    hrefs: LOCAL_MENU_HREFS,
    load: () => {
      const { menu } = readLocalMenu(catalog);
      return menu ? { menu, updatedAt: null } : null;
    },
    save: write,
    create: async (menu) => {
      const res = await write(menu, null);
      return res.ok ? { ok: true, id: 'local' } : res;
    },
    // The first save stays on the page: the open meals are already open.
    afterCreate: () => null
  };
}
