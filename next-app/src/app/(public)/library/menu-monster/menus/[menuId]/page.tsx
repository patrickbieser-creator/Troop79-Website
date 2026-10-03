/**
 * /library/menu-monster/menus/[menuId] — the Plan tab. The owner scout edits; a
 * leader (admin viewer) reads any menu read-only; anyone else (or a missing
 * menu) gets notFound(). Phase 3 adds parents and shared viewers.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../_components/plan-tab';
import { ViewerAside } from '../_components/viewer-aside';
import { MenuHeader, MenuTabs, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Menu plan — Menu Monster', robots: NO_INDEX };

export default async function MenuPlanPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, readOnly, plannedBy, catalog } = view;
  const linked = stored.menu.calendarEntryId != null ? [stored.menu.calendarEntryId] : [];
  const outings = await loadOutingsWith(createAdminClient(), centralToday(), linked);
  return (
    <>
      <MenuHeader current="plan" {...listCrumb(view.access)} />
      <PageShell>
        <PlanTab
          catalog={catalog}
          menuId={stored.id}
          menu={resolveMenuAliases(stored.menu, catalog.aliases)}
          updatedAt={stored.updatedAt}
          outings={outings}
          readOnly={readOnly}
          plannedBy={plannedBy}
          tabs={<MenuTabs menuId={stored.id} active="plan" access={view.access} />}
          aside={<ViewerAside view={view} page="plan" />}
        />
      </PageShell>
    </>
  );
}
