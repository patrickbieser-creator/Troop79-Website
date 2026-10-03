/**
 * /library/menu-monster/menus/[menuId]/meals/[mealId] — retired 2026-10-03: a
 * meal opens inline on the Plan tab now (Plans/Menu-Monster-Scout-Workspace.md,
 * "Meals inline on the Plan tab"). Old links land on the Plan tab with that meal
 * open; the Plan tab decides who may see the menu.
 */
import { redirect } from 'next/navigation';
import { MENUS_HREF } from '../../../_components/scout-menus';

export default async function MenuMealPage({ params }: { params: Promise<{ menuId: string; mealId: string }> }) {
  const { menuId, mealId } = await params;
  redirect(`${MENUS_HREF}/${encodeURIComponent(menuId)}?meal=${encodeURIComponent(mealId)}`);
}
