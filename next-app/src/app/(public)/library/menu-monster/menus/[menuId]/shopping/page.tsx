/**
 * /library/menu-monster/menus/[menuId]/shopping — the Shopping tab: the menu's
 * merged shopping list, the scout's package / quantity / bring-from-home
 * choices, and the quiet "Prices have changed" line. Owner edits, a leader reads
 * read-only, like the Plan tab: anyone else (or a missing menu) gets notFound().
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { ShoppingTab } from '../../_components/shopping-tab';
import { MenuHeader, MenuTabs, loadViewableMenu, menuViewer } from '../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shopping — Menu Monster' };

export default async function MenuShoppingPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const viewer = await menuViewer();
  if (!viewer) notFound();
  const view = await loadViewableMenu(menuId, viewer);
  if (!view) notFound();
  const { stored, readOnly, plannedBy } = view;
  const catalog = await loadMenuMonsterCatalog(stored.ownerPersonId);
  return (
    <>
      <MenuHeader current="shopping" listLabel={readOnly ? 'Scouts’ menus' : undefined} />
      <PageShell>
        <ShoppingTab
          catalog={catalog}
          menuId={stored.id}
          menu={stored.menu}
          updatedAt={stored.updatedAt}
          snapshot={stored.snapshot}
          readOnly={readOnly}
          plannedBy={plannedBy}
          tabs={<MenuTabs menuId={stored.id} active="shopping" />}
        />
      </PageShell>
    </>
  );
}
