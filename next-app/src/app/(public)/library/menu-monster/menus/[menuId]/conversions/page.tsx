/**
 * /library/menu-monster/menus/[menuId]/conversions — the Conversions tab: a read-only lesson in how the
 * planner turns a recipe's cups and spoons into the store's ounces, pounds and gallons, worked on this menu's
 * own foods (Patrick, 2026-10-05). Anyone who can open the menu reads it; nobody edits here — leaders keep
 * the table in the Price book.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { buildMenuList } from '@/lib/menu-monster/menu-view';
import { foodRules, unitLadders, workedExamples } from '@/lib/menu-monster/conversion-lesson';
import { PageShell } from '@/app/_components/page-shell';
import { ConversionsTab } from '../../_components/conversions-tab';
import { MenuHeader, MenuTabs, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ViewerAside } from '../../_components/viewer-aside';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conversions — Menu Monster', robots: NO_INDEX };

export default async function MenuConversionsPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, catalog } = view;
  const menu = resolveMenuAliases(stored.menu, catalog.aliases);
  return (
    <>
      <MenuHeader current="conversions" {...listCrumb(view.access)} />
      <PageShell>
        <ConversionsTab
          menuName={menu.name}
          examples={workedExamples(buildMenuList(menu, catalog).lines, catalog)}
          ladders={unitLadders()}
          rules={foodRules(catalog)}
          tabs={<MenuTabs menuId={stored.id} active="conversions" access={view.access} />}
          aside={<ViewerAside view={view} page="conversions" />}
        />
      </PageShell>
    </>
  );
}
