/**
 * Menu Monster on the /library/topic/menu-monster shelf — server half.
 *
 * Loads the published catalog with the service role (the mm_* tables have
 * RLS on and zero policies, D-051/D-239) and hands plain data to the client
 * planner. The only per-visitor read is the identity cookie (signature only):
 * a signed-in scout gets a quiet "My menus" link above the planner; everyone
 * else sees the planner exactly as before. The shelf page is
 * `dynamic = 'force-dynamic'` (D-040), so a catalog edit by migration shows on
 * the next load.
 */
import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { MenuMonsterPlanner } from './planner';
import s from './planner.module.css';

export async function MenuMonsterShelfTool() {
  const [catalog, session] = await Promise.all([loadMenuMonsterCatalog(), getIdentitySessionIfValid()]);
  return (
    <>
      {session?.subjectKind === 'scout' && (
        <Link className={s.myMenus} href="/library/menu-monster/menus">
          My menus
        </Link>
      )}
      <MenuMonsterPlanner catalog={catalog} />
    </>
  );
}
