/**
 * Menu Monster on the /library/topic/menu-monster shelf — server half, and the
 * hub of the scout workspace. Loads the published catalog with the service role
 * (the mm_* tables have RLS on and zero policies, D-051/D-239) and hands plain
 * data to the client planner. The one per-visitor read is the identity cookie:
 * a signed-in scout opens on a "My menus" section (their five most recent menus
 * and New menu); everyone else gets one quiet sign-in line, and the anonymous
 * planner sits below either way. The shelf page is `dynamic = 'force-dynamic'`
 * (D-040), so a catalog edit by migration shows on the next load.
 *
 * An admin viewer (a leader holding any admin capability) gets a read-only
 * "Scouts' menus" section instead: the ten most recently edited menus across
 * all scouts, each with the scout's credit name, and All scouts' menus past ten.
 * The anonymous planner stays below for everyone.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listAllMenusWith, listMenusWith, ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { Button } from '@/app/_components/button';
import { DraftOffer } from '../../menu-monster/menus/_components/draft-offer';
import { loadMenuRows } from '../../menu-monster/menus/_components/menu-rows';
import { MenusList } from '../../menu-monster/menus/_components/menus-list';
import { LockedLine, MENUS_HREF, menuViewer } from '../../menu-monster/menus/_components/scout-menus';
import w from '../../menu-monster/menus/_components/workspace.module.css';
import { MenuMonsterPlanner } from './planner';

const HUB_HREF = '/library/topic/menu-monster';
const RECENT = 5;
const LEADER_RECENT = 10;

export async function MenuMonsterShelfTool() {
  const [catalog, viewer] = await Promise.all([loadMenuMonsterCatalog(), menuViewer()]);
  const scout = viewer?.kind === 'scout' ? viewer : null;

  let myMenus: React.ReactNode;
  if (viewer?.kind === 'leader') {
    const sb = createAdminClient();
    const all = await listAllMenusWith(sb);
    const shown = all.slice(0, LEADER_RECENT);
    const owners = await ownerCreditNamesWith(sb, shown.map((m) => m.ownerPersonId));
    const rows = await loadMenuRows(sb, shown, catalog, owners);
    myMenus = (
      <>
        <div className={w.listHead}>
          <h2 className={w.heading}>Scouts’ menus</h2>
        </div>
        <MenusList rows={rows} readOnly emptyText="No scout has saved a menu yet." />
        {all.length > LEADER_RECENT && (
          <p className={w.foot}>
            <Link className={w.link} href={MENUS_HREF}>
              All scouts’ menus
            </Link>
          </p>
        )}
      </>
    );
  } else if (scout) {
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
