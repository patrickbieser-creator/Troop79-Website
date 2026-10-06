/**
 * /library/menu-monster/menus/[menuId] — the Meals step (Who's eating is /people, its own screen). The owner scout edits; a
 * leader (admin viewer) reads any menu read-only; anyone else (or a missing
 * menu) gets notFound(). Phase 3 adds parents and shared viewers.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../_components/plan-tab';
import { ViewerAside } from '../_components/viewer-aside';
import { HelperMenuScope } from '../_components/helper-menu';
import { MenuHeader, stepConfig, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Menu plan — Menu Monster', robots: NO_INDEX };

export default async function MenuPlanPage({ params, searchParams }: { params: Promise<{ menuId: string }>; searchParams: Promise<{ meal?: string }> }) {
  const [{ menuId }, { meal }] = await Promise.all([params, searchParams]);
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, readOnly, plannedBy, catalog } = view;
  // The meal panels' "More gear for this meal" picks from the troop's list; a read-only view has no picker.
  const gearList = readOnly ? undefined : await listGearWith(createAdminClient());
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
          outings={[]}
          gearList={gearList}
          readOnly={readOnly}
          helper={view.helping}
          plannedBy={plannedBy}
          steps={stepConfig(stored.id, view.access, resolveMenuAliases(stored.menu, catalog.aliases), 'plan', centralToday())}
          aside={<ViewerAside view={view} page="plan" />}
          openMeal={typeof meal === 'string' ? meal : null}
        />
        </HelperMenuScope>
      </PageShell>
    </>
  );
}
