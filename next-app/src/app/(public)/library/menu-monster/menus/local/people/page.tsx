/**
 * /library/menu-monster/menus/local/people — the Who's eating step of the unsaved menu kept on this computer
 * (visitors and leaders). A signed-in scout is sent to the hub. Nothing here reads the menu: the client shell
 * does, after mount.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { LocalPlan } from '../../_components/local-menu-shells';
import { LocalMenuHeader, redirectScoutFromLocal } from '../../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Who’s eating — Menu Monster' };

export default async function LocalMenuPeoplePage() {
  await redirectScoutFromLocal();
  const [catalog, outings] = await Promise.all([loadMenuMonsterCatalog(null), loadOutingsWith(createAdminClient(), centralToday())]);
  return (
    <>
      <LocalMenuHeader current="plan" />
      <PageShell>
        <LocalPlan catalog={catalog} outings={outings} page="people" />
      </PageShell>
    </>
  );
}
