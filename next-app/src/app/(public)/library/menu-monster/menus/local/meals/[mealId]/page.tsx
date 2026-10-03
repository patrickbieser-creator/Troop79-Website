/**
 * /library/menu-monster/menus/local/meals/[mealId] — retired 2026-10-03: a meal
 * opens inline on the Plan tab now (Plans/Menu-Monster-Scout-Workspace.md,
 * "Meals inline on the Plan tab"). Old links land on the Plan tab with that
 * meal open.
 */
import { redirect } from 'next/navigation';
import { LOCAL_MENU_HREFS } from '@/lib/menu-monster/local-menu-store';

export default async function LocalMenuMealPage({ params }: { params: Promise<{ mealId: string }> }) {
  const { mealId } = await params;
  redirect(LOCAL_MENU_HREFS.meal(mealId));
}
