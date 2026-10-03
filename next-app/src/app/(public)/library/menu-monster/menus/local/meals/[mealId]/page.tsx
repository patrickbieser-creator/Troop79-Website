/**
 * /library/menu-monster/menus/local/meals/[mealId] — one meal of the unsaved menu
 * kept on this computer. A signed-in scout is sent to the hub.
 */
import type { Metadata } from 'next';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { LocalMeal } from '../../../_components/local-menu-shells';
import { LocalMenuHeader, redirectScoutFromLocal } from '../../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meal — Menu Monster' };

export default async function LocalMenuMealPage({ params }: { params: Promise<{ mealId: string }> }) {
  const { mealId } = await params;
  await redirectScoutFromLocal();
  const catalog = await loadMenuMonsterCatalog();
  return (
    <>
      <LocalMenuHeader current="meal" />
      <PageShell>
        <LocalMeal catalog={catalog} mealId={mealId} />
      </PageShell>
    </>
  );
}
