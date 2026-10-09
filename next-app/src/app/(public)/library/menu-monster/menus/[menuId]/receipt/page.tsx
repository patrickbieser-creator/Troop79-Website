/**
 * /library/menu-monster/menus/[menuId]/receipt — "Planned vs bought": the store receipt's lines, settled one at a
 * time by whoever has the receipt, and every meal as planned beside as bought
 * (Plans/Menu-Monster-Receipt-Reconciliation.md). Everyone who can open the menu reads it (Patrick, 2026-10-08:
 * "available for everyone to see"); settling a line needs canRecord, like What we bought.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { canRecord } from '@/lib/menu-monster/menu-access';
import { loadBoughtWith } from '@/lib/menu-monster/bought-store';
import { loadReceiptWith } from '@/lib/menu-monster/receipt-store';
import { PageShell } from '@/app/_components/page-shell';
import { ReceiptTab } from '../../_components/receipt-tab';
import { MenuHeader, MenuRail, MenuSteps, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ViewerAside } from '../../_components/viewer-aside';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Planned vs bought — Menu Monster', robots: NO_INDEX };

export default async function MenuReceiptPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, catalog } = view;
  const menu = resolveMenuAliases(stored.menu, catalog.aliases);
  const sb = createAdminClient();
  const [receipt, bought] = await Promise.all([loadReceiptWith(sb, stored.id), loadBoughtWith(sb, stored.id)]);
  return (
    <>
      <MenuHeader current="receipt" {...listCrumb(view.access)} />
      <PageShell>
        <MenuRail menuId={stored.id} active="receipt" access={view.access} menu={menu} catalog={catalog} />
        <ReceiptTab
          catalog={catalog}
          menuId={stored.id}
          menu={menu}
          receipt={receipt}
          bought={bought}
          canRecord={canRecord(view.access)}
          tabs={<MenuSteps menuId={stored.id} active="receipt" access={view.access} menu={menu} catalog={catalog} shoppingDone={view.shoppingDone} hasReceipt={view.hasReceipt || receipt != null} />}
          aside={<ViewerAside view={view} page="receipt" />}
        />
      </PageShell>
    </>
  );
}
