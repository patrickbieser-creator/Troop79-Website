/**
 * /library/menu-monster/menus/[menuId]/shopping — the Shopping tab: the menu's
 * merged shopping list, the scout's package / quantity / bring-from-home
 * choices, and the quiet "Prices have changed" line. Owner only, like the Plan
 * tab: anyone else (or a missing menu) gets notFound().
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { ShoppingTab } from '../../_components/shopping-tab';
import { MenuHeader, MenuTabs, loadOwnMenu, scoutViewer } from '../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shopping — Menu Monster' };

export default async function MenuShoppingPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const viewer = await scoutViewer();
  if (!viewer) notFound();
  const stored = await loadOwnMenu(menuId, viewer);
  if (!stored) notFound();
  const catalog = await loadMenuMonsterCatalog();
  return (
    <>
      <MenuHeader current="shopping" />
      <PageShell>
        <ShoppingTab
          catalog={catalog}
          menuId={stored.id}
          menu={stored.menu}
          updatedAt={stored.updatedAt}
          snapshot={stored.snapshot}
          tabs={<MenuTabs menuId={stored.id} active="shopping" />}
        />
      </PageShell>
    </>
  );
}
