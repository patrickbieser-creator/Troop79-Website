/**
 * /library/menu-monster/menus/local/shopping — the Shopping tab of the unsaved
 * menu kept on this computer. No "What you paid" and no price reports: those need
 * a saved menu. A signed-in scout is sent to the hub.
 */
import type { Metadata } from 'next';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { LocalShopping } from '../../_components/local-menu-shells';
import { LocalMenuHeader, redirectScoutFromLocal } from '../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shopping — Menu Monster' };

export default async function LocalMenuShoppingPage() {
  await redirectScoutFromLocal();
  const catalog = await loadMenuMonsterCatalog();
  return (
    <>
      <LocalMenuHeader current="shopping" />
      <PageShell>
        <LocalShopping catalog={catalog} />
      </PageShell>
    </>
  );
}
