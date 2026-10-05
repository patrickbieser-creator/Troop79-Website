/**
 * /library/menu-monster/menus/[menuId]/gear — the Gear tab: the packing list the menu's food needs, for the
 * scouts who pull gear while the planners plan (Plans/Menu-Monster-Brands-Gear.md, release 2). Anyone who can
 * open the menu reads it; the owner, the outing's crew and leaders tick things off; the owner adds extras.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { canRecord } from '@/lib/menu-monster/menu-access';
import { listGearWith, loadMenuGearWith } from '@/lib/menu-monster/gear-store';
import { ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { PageShell } from '@/app/_components/page-shell';
import { GearTab } from '../../_components/gear-tab';
import { MenuHeader, MenuTabs, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ViewerAside } from '../../_components/viewer-aside';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Gear — Menu Monster', robots: NO_INDEX };

export default async function MenuGearPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const viewer = await menuViewer();
  const view = await loadViewableMenu(menuId, viewer);
  if (!view) notFound();
  const { stored, catalog } = view;
  const sb = createAdminClient();
  const [gearList, state, names] = await Promise.all([
    listGearWith(sb),
    loadMenuGearWith(sb, stored.id),
    viewer?.personId != null ? ownerCreditNamesWith(sb, [viewer.personId]) : Promise.resolve(new Map<number, string>())
  ]);
  const known = viewer?.personId != null ? names.get(viewer.personId) : undefined;
  const viewerName = known ?? (viewer?.kind === 'scout' ? viewer.displayName : viewer?.kind === 'leader' ? viewer.label : '');
  return (
    <>
      <MenuHeader current="gear" {...listCrumb(view.access)} />
      <PageShell>
        <GearTab
          catalog={catalog}
          menuId={stored.id}
          menu={resolveMenuAliases(stored.menu, catalog.aliases)}
          gearList={gearList}
          // A shared (possibly anonymous) viewer sees what is packed, not which scout packed it.
          state={view.access === 'shared' ? { ...state, packed: Object.fromEntries(Object.entries(state.packed).map(([k, t]) => [k, { ...t, by: '', personId: null }])) } : state}
          canPack={canRecord(view.access)}
          canEdit={view.access === 'owner' || view.helping}
          viewerName={viewerName}
          tabs={<MenuTabs menuId={stored.id} active="gear" access={view.access} />}
          aside={<ViewerAside view={view} page="gear" />}
        />
      </PageShell>
    </>
  );
}
