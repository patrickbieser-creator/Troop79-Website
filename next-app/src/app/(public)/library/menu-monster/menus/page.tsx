/**
 * /library/menu-monster/menus — My menus (Scout Workspace, Phase 1).
 * Per-user data: force-dynamic, nothing cached. A scout sees their own menus; a
 * leader (admin viewer) sees every scout's menus read-only; everyone else sees
 * one locked line.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listAllMenusWith, listMenusWith, ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { DraftOffer } from './_components/draft-offer';
import { loadMenuRows } from './_components/menu-rows';
import { MenusList } from './_components/menus-list';
import { LockedLine, MENUS_HREF, MenuHeader, menuViewer } from './_components/scout-menus';
import s from './_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My menus — Menu Monster' };

export default async function MyMenusPage() {
  const viewer = await menuViewer();
  if (!viewer) {
    return (
      <>
        <MenuHeader title="My menus" />
        <PageShell width="narrow">
          <LockedLine next={MENUS_HREF} />
        </PageShell>
      </>
    );
  }

  const sb = createAdminClient();
  if (viewer.kind === 'leader') {
    const all = await listAllMenusWith(sb);
    const [catalog, owners] = await Promise.all([
      // Costs for the leader's list only: an owner's draft recipe prices as missing here (read-only, never saved).
      loadMenuMonsterCatalog(null),
      ownerCreditNamesWith(sb, all.map((m) => m.ownerPersonId))]);
    const leaderRows = await loadMenuRows(sb, all, catalog, owners);
    return (
      <>
        <MenuHeader title="Scouts’ menus" listLabel="Scouts’ menus" />
        <PageShell width="narrow">
          <div className={s.listHead}>
            <span className={s.foot}>Read-only. Newest edits first.</span>
          </div>
          <MenusList rows={leaderRows} readOnly emptyText="No scout has saved a menu yet." />
        </PageShell>
      </>
    );
  }

  const summaries = await listMenusWith(sb, viewer.personId);
  const catalog = await loadMenuMonsterCatalog(viewer.personId);
  const rows = await loadMenuRows(sb, summaries, catalog);

  return (
    <>
      <MenuHeader title="My menus" />
      <PageShell width="narrow">
        <div className={s.listHead}>
          <span className={s.foot}>A person, per meal</span>
          <Button variant="primary" href={`${MENUS_HREF}/new`}>
            New menu
          </Button>
        </div>
        <MenusList rows={rows} />
        <DraftOffer catalog={catalog} />
      </PageShell>
    </>
  );
}
