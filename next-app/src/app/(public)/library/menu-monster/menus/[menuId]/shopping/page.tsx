/**
 * /library/menu-monster/menus/[menuId]/shopping — the Shopping tab: the menu's
 * merged shopping list, the scout's package / quantity / bring-from-home
 * choices, and the quiet "Prices have changed" line. Owner edits, a leader reads
 * read-only, like the Plan tab: anyone else (or a missing menu) gets notFound().
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { listGearWith, loadMenuGearWith } from '@/lib/menu-monster/gear-store';
import { PageShell } from '@/app/_components/page-shell';
import { ShoppingTab } from '../../_components/shopping-tab';
import { MenuHeader, MenuTabs, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ViewerAside } from '../../_components/viewer-aside';
import { HelperMenuScope } from '../../_components/helper-menu';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shopping — Menu Monster', robots: NO_INDEX };

export default async function MenuShoppingPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, readOnly, plannedBy, catalog } = view;
  // The printed sheet's gear line rolls up recipe, meal and menu gear exactly as the Gear tab does.
  const sb = createAdminClient();
  const [gearList, gearState] = await Promise.all([listGearWith(sb), loadMenuGearWith(sb, stored.id)]);
  return (
    <>
      <MenuHeader current="shopping" {...listCrumb(view.access)} />
      <PageShell>
        <HelperMenuScope menuId={view.helping ? stored.id : null}>
        <ShoppingTab
          catalog={catalog}
          menuId={stored.id}
          menu={resolveMenuAliases(stored.menu, catalog.aliases)}
          updatedAt={stored.updatedAt}
          snapshot={stored.snapshot}
          gearList={gearList}
          gearExtras={gearState.extras}
          readOnly={readOnly}
          helper={view.helping}
          plannedBy={plannedBy}
          tabs={<MenuTabs menuId={stored.id} active="shopping" access={view.access} />}
          aside={<ViewerAside view={view} page="shopping" />}
        />
        </HelperMenuScope>
      </PageShell>
    </>
  );
}
