/**
 * /library/menu-monster/menus/[menuId]/meals/[mealId] — one meal of a menu:
 * recipe rows, ingredient lists, add / swap / remove for the owner; read-only for a leader (see the Plan tab).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { MealEditor } from '../../../_components/meal-editor';
import { MenuHeader, loadViewableMenu, menuViewer } from '../../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meal — Menu Monster' };

export default async function MenuMealPage({ params }: { params: Promise<{ menuId: string; mealId: string }> }) {
  const { menuId, mealId } = await params;
  const viewer = await menuViewer();
  if (!viewer) notFound();
  const view = await loadViewableMenu(menuId, viewer);
  if (!view) notFound();
  const { stored, readOnly, plannedBy } = view;
  if ( !stored.menu.meals.some((m) => m.id === mealId)) notFound();
  const catalog = await loadMenuMonsterCatalog();
  return (
    <>
      <MenuHeader current="meal" listLabel={readOnly ? 'Scouts’ menus' : undefined} menu={{ id: stored.id, name: stored.menu.name }} />
      <PageShell>
        <MealEditor catalog={catalog} menuId={stored.id} menu={stored.menu} mealId={mealId} updatedAt={stored.updatedAt} readOnly={readOnly} plannedBy={plannedBy} />
      </PageShell>
    </>
  );
}
