/**
 * /library/menu-monster/menus/[menuId]/meals/[mealId] — one meal as its own page (Patrick, 2026-10-06,
 * decision 1: "a meal may open as its own page — with clear navigation for saving, cancelling and going
 * back"). On a phone a meal row's "Open" lands here; on a wide screen the meal still opens inline on the Plan
 * tab. The same PlanTab renders it (`mealOnly`), so there is one draft, one Save, one leave guard: Save keeps
 * you here, Cancel throws the edits away and goes back to the meal's row, and "← Back to meals" asks first when
 * there are unsaved edits. Who may see it is the Plan tab's rule (loadViewableMenu): anyone else gets notFound().
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../../../_components/plan-tab';
import { ViewerAside } from '../../../_components/viewer-aside';
import { HelperMenuScope } from '../../../_components/helper-menu';
import { MenuHeader, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meal — Menu Monster', robots: NO_INDEX };

export default async function MenuMealPage({ params }: { params: Promise<{ menuId: string; mealId: string }> }) {
  const { menuId, mealId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, readOnly, plannedBy, catalog } = view;
  const linked = stored.menu.calendarEntryId != null ? [stored.menu.calendarEntryId] : [];
  const [outings, gearList] = await Promise.all([
    loadOutingsWith(createAdminClient(), centralToday(), linked),
    // The meal's "More gear for this meal" picks from the troop's list; a read-only view has no picker.
    readOnly ? Promise.resolve(undefined) : listGearWith(createAdminClient())
  ]);
  return (
    <>
      <MenuHeader current="plan" {...listCrumb(view.access)} />
      <PageShell>
        <HelperMenuScope menuId={view.helping ? stored.id : null}>
          <PlanTab
            catalog={catalog}
            menuId={stored.id}
            menu={resolveMenuAliases(stored.menu, catalog.aliases)}
            updatedAt={stored.updatedAt}
            outings={outings}
            gearList={gearList}
            readOnly={readOnly}
            helper={view.helping}
            plannedBy={plannedBy}
            aside={<ViewerAside view={view} page="plan" />}
            mealOnly={mealId}
          />
        </HelperMenuScope>
      </PageShell>
    </>
  );
}
