/**
 * /library/menu-monster/menus/[menuId]/meals/[mealId] — one meal of a menu,
 * the anonymous planner run controlled. Owner only for now (see the Plan tab).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { MealEditor } from '../../../_components/meal-editor';
import { MenuHeader, loadOwnMenu, scoutViewer } from '../../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meal — Menu Monster' };

export default async function MenuMealPage({ params }: { params: Promise<{ menuId: string; mealId: string }> }) {
  const { menuId, mealId } = await params;
  const viewer = await scoutViewer();
  if (!viewer) notFound();
  const stored = await loadOwnMenu(menuId, viewer);
  if (!stored || !stored.menu.meals.some((m) => m.id === mealId)) notFound();
  const catalog = await loadMenuMonsterCatalog();
  return (
    <>
      <MenuHeader current="meal" menu={{ id: stored.id, name: stored.menu.name }} />
      <PageShell>
        <MealEditor catalog={catalog} menuId={stored.id} menu={stored.menu} mealId={mealId} updatedAt={stored.updatedAt} />
      </PageShell>
    </>
  );
}
