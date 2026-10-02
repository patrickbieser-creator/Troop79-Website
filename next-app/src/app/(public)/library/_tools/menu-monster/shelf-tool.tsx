/**
 * Menu Monster on the /library/topic/menu-monster shelf — server half, and the
 * hub of the scout workspace. Loads the published catalog with the service role
 * (the mm_* tables have RLS on and zero policies, D-051/D-239) and hands plain
 * data to the client planner. The one per-visitor read is the identity cookie:
 * a signed-in scout opens on a "My menus" section (their five most recent menus
 * and New menu); everyone else gets one quiet sign-in line, and the anonymous
 * planner sits below either way. The shelf page is `dynamic = 'force-dynamic'`
 * (D-040), so a catalog edit by migration shows on the next load.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listMenusWith } from '@/lib/menu-monster/menus-store';
import { Button } from '@/app/_components/button';
import { DraftOffer } from '../../menu-monster/menus/_components/draft-offer';
import { loadMenuRows } from '../../menu-monster/menus/_components/menu-rows';
import { MenusList } from '../../menu-monster/menus/_components/menus-list';
import { LockedLine, MENUS_HREF } from '../../menu-monster/menus/_components/scout-menus';
import w from '../../menu-monster/menus/_components/workspace.module.css';
import { MenuMonsterPlanner } from './planner';

const HUB_HREF = '/library/topic/menu-monster';
const RECENT = 5;

export async function MenuMonsterShelfTool() {
  const [catalog, session] = await Promise.all([loadMenuMonsterCatalog(), getIdentitySessionIfValid()]);
  const scout = session?.subjectKind === 'scout' ? session : null;

  let myMenus: React.ReactNode;
  if (scout) {
    const sb = createAdminClient();
    const summaries = await listMenusWith(sb, scout.personId);
    const rows = await loadMenuRows(sb, summaries.slice(0, RECENT), catalog);
    myMenus = (
      <>
        <div className={w.listHead}>
          <h2 className={w.heading}>My menus</h2>
          <Button variant="primary" size="sm" href={`${MENUS_HREF}/new`}>
            New menu
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className={w.foot}>No menus yet. Start one to save meals, people and a shopping list.</p>
        ) : (
          <MenusList rows={rows} />
        )}
        {summaries.length > RECENT && (
          <p className={w.foot}>
            <Link className={w.link} href={MENUS_HREF}>
              All my menus
            </Link>
          </p>
        )}
        <DraftOffer catalog={catalog} />
      </>
    );
  } else {
    myMenus = (
      <>
        <h2 className={w.heading}>My menus</h2>
        <LockedLine hub next={HUB_HREF} />
      </>
    );
  }

  return (
    <>
      <section className={w.hubSection}>{myMenus}</section>
      <h2 className={w.hubPlanHeading}>{scout ? 'Quick plan (not saved to My menus)' : 'Plan a meal without signing in'}</h2>
      <MenuMonsterPlanner catalog={catalog} />
    </>
  );
}
