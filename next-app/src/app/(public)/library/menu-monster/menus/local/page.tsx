/**
 * /library/menu-monster/menus/local — the Plan tab of the unsaved menu kept on
 * this computer (visitors and leaders). A signed-in scout is sent to the hub,
 * where this menu is offered for saving. The static `local` segment wins over
 * [menuId]. Nothing here reads the menu: the client shell does, after mount.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { listDraftItemsWith } from '@/lib/menu-monster/draft-items';
import { PageShell } from '@/app/_components/page-shell';
import { LocalPlan } from '../_components/local-menu-shells';
import { LocalMenuHeader, redirectScoutFromLocal } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Menu plan — Menu Monster' };

export default async function LocalMenuPlanPage({ searchParams }: { searchParams: Promise<{ meal?: string }> }) {
  await redirectScoutFromLocal();
  const { meal } = await searchParams;
  // The troop's gear list and draft food names are troop-public (names, descriptions; never a scout's own draft), so a visitor's meals get the same gear picker and draft hint a saved menu has.
  const sb = createAdminClient();
  const [catalog, outings, gearList, draftItems] = await Promise.all([loadMenuMonsterCatalog(null), loadOutingsWith(sb, centralToday()), listGearWith(sb), listDraftItemsWith(sb)]);
  return (
    <>
      <LocalMenuHeader current="plan" />
      <PageShell>
        <LocalPlan catalog={catalog} outings={outings} openMeal={typeof meal === 'string' ? meal : null} gearList={gearList} draftItems={draftItems} />
      </PageShell>
    </>
  );
}
