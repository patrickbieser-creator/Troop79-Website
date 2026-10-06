/**
 * /library/menu-monster/menus/new — a blank Plan tab. Nothing is stored until
 * the scout's first Save, which creates the menu and moves to its own URL.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { blankMenu } from '@/lib/menu-monster/menus';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { loadOutingsWith, loadPatrolNamesWith, loadScoutPatrolWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../_components/plan-tab';
import { LockedLine, MENUS_HREF, MenuHeader, recipeAuthor, scoutViewer } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New menu — Menu Monster' };

export default async function NewMenuPage() {
  const viewer = await recipeAuthor();
  if (!viewer) {
    return (
      <>
        <MenuHeader title="New menu" current="new" />
        <PageShell width="narrow">
          <LockedLine next={`${MENUS_HREF}/new`} />
        </PageShell>
      </>
    );
  }
  // A scout's new menu starts with their own patrol (leaders and parents pick one).
  const scout = await scoutViewer();
  const [catalog, outings, patrols, gearList, myPatrol] = await Promise.all([
    loadMenuMonsterCatalog(viewer.personId),
    loadOutingsWith(createAdminClient(), centralToday()),
    loadPatrolNamesWith(createAdminClient()),
    listGearWith(createAdminClient()),
    scout ? loadScoutPatrolWith(createAdminClient(), scout.personId) : Promise.resolve(null)
  ]);
  return (
    <>
      <MenuHeader current="new" />
      <PageShell>
        <PlanTab catalog={catalog} menuId={null} menu={blankMenu()} updatedAt={null} outings={outings} patrols={patrols} gearList={gearList} myPatrol={myPatrol} />
      </PageShell>
    </>
  );
}
