/**
 * Menu Monster on the /library/topic/menu-monster shelf — server half.
 *
 * Loads the published catalog with the service role (the mm_* tables have
 * RLS on and zero policies, D-051/D-239) and hands plain data to the client
 * planner. Nothing here touches cookies, so the shelf page's
 * `dynamic = 'force-dynamic'` (D-040) is the only reason it re-renders per
 * request — a catalog edit by migration shows on the next load.
 */
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { MenuMonsterPlanner } from './planner';

export async function MenuMonsterShelfTool() {
  const catalog = await loadMenuMonsterCatalog();
  return <MenuMonsterPlanner catalog={catalog} />;
}
