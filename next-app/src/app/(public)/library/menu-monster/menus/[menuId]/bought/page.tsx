/**
 * /library/menu-monster/menus/[menuId]/bought — "What we bought": the prefilled checklist of what the menu
 * buys, recorded after the trip by whoever has the receipt (Plans/Menu-Monster-Brands-Gear.md, release 4).
 * The owner, the outing's crew and leaders record; a parent reads. A shared viewer never sees what was paid
 * (menu-access.ts redactMenu), so for them there is no such page.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { canRecord } from '@/lib/menu-monster/menu-access';
import { boughtFromActuals } from '@/lib/menu-monster/bought';
import { loadBoughtWith } from '@/lib/menu-monster/bought-store';
import { PageShell } from '@/app/_components/page-shell';
import { BoughtTab } from '../../_components/bought-tab';
import { MenuHeader, MenuTabs, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ViewerAside } from '../../_components/viewer-aside';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'What we bought — Menu Monster', robots: NO_INDEX };

export default async function MenuBoughtPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view || view.access === 'shared') notFound();
  const { stored, catalog } = view;
  const menu = resolveMenuAliases(stored.menu, catalog.aliases);
  const bought = await loadBoughtWith(createAdminClient(), stored.id);
  // The old "What you paid" entries still read here, until a line is recorded the new way.
  const legacy = boughtFromActuals(menu.actuals, catalog, stored.updatedAt);
  return (
    <>
      <MenuHeader current="bought" {...listCrumb(view.access)} />
      <PageShell>
        <BoughtTab
          catalog={catalog}
          menuId={stored.id}
          menu={menu}
          bought={bought}
          legacy={legacy}
          canRecord={canRecord(view.access)}
          tabs={<MenuTabs menuId={stored.id} active="bought" access={view.access} />}
          aside={<ViewerAside view={view} page="bought" />}
        />
      </PageShell>
    </>
  );
}
