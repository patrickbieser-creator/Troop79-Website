/**
 * /library/menu-monster/menus/[menuId]/people — the Who's eating step, on its own screen (Patrick, 2026-10-06).
 * The owner scout edits; a leader (admin viewer) reads any menu read-only; anyone else (or a missing menu) gets
 * notFound() — the same rule as the Meals page (loadViewableMenu).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { loadOutingsWith, loadPatrolNamesWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PeopleTab } from '../../_components/people-tab';
import { ViewerAside } from '../../_components/viewer-aside';
import { HelperMenuScope } from '../../_components/helper-menu';
import { MenuHeader, stepConfig, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Who’s eating — Menu Monster', robots: NO_INDEX };

export default async function MenuPeoplePage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, readOnly, plannedBy, catalog } = view;
  const linked = stored.menu.calendarEntryId != null ? [stored.menu.calendarEntryId] : [];
  const [outings, patrols] = await Promise.all([
    loadOutingsWith(createAdminClient(), centralToday(), linked),
    readOnly ? Promise.resolve([]) : loadPatrolNamesWith(createAdminClient())
  ]);
  const menu = resolveMenuAliases(stored.menu, catalog.aliases);
  return (
    <>
      <MenuHeader current="people" {...listCrumb(view.access)} />
      <PageShell>
        <HelperMenuScope menuId={view.helping ? stored.id : null}>
          <PeopleTab
            catalog={catalog}
            menuId={stored.id}
            menu={menu}
            updatedAt={stored.updatedAt}
            outings={outings}
            patrols={patrols}
            readOnly={readOnly}
            helper={view.helping}
            plannedBy={plannedBy}
            steps={stepConfig(stored.id, view.access, menu, 'people', centralToday(), view.shoppingDone)}
            aside={<ViewerAside view={view} page="people" />}
          />
        </HelperMenuScope>
      </PageShell>
    </>
  );
}
