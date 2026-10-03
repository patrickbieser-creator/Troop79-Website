/**
 * /library/menu-monster/menus/[menuId]/meals/[mealId] — one meal of a menu:
 * recipe rows, ingredient lists, add / swap / remove for the owner; read-only for a leader (see the Plan tab).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { PageShell } from '@/app/_components/page-shell';
import { MealEditor } from '../../../_components/meal-editor';
import { MenuHeader, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../../_components/scout-menus';
import { ViewerAside } from '../../../_components/viewer-aside';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meal — Menu Monster', robots: NO_INDEX };

export default async function MenuMealPage({ params }: { params: Promise<{ menuId: string; mealId: string }> }) {
  const { menuId, mealId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, readOnly, plannedBy, catalog } = view;
  if (!stored.menu.meals.some((m) => m.id === mealId)) notFound();
  return (
    <>
      <MenuHeader current="meal" {...listCrumb(view.access)} menu={{ id: stored.id, name: stored.menu.name }} />
      <PageShell>
        <MealEditor catalog={catalog} menuId={stored.id} menu={resolveMenuAliases(stored.menu, catalog.aliases)} mealId={mealId} updatedAt={stored.updatedAt} readOnly={readOnly} plannedBy={plannedBy} aside={<ViewerAside view={view} page="meal" />} />
      </PageShell>
    </>
  );
}
