/**
 * /library/menu-monster/menus — My menus (Scout Workspace, Phase 1).
 * Per-user data: force-dynamic, nothing cached. A scout sees their own menus;
 * everyone else sees one locked line.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { MENU_CONTEXTS } from '@/lib/menu-monster/menus';
import { listMenusWith, loadMenuWith } from '@/lib/menu-monster/menus-store';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { menuCost } from '@/lib/menu-monster/menu-view';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { DraftOffer } from './_components/draft-offer';
import { MenusList, type MenuRowData } from './_components/menus-list';
import { LockedLine, MENUS_HREF, MenuHeader, scoutViewer } from './_components/scout-menus';
import s from './_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My menus — Menu Monster' };

export default async function MyMenusPage() {
  const viewer = await scoutViewer();
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
  const summaries = await listMenusWith(sb, viewer.personId);
  const [catalog, stored, outings] = await Promise.all([
    loadMenuMonsterCatalog(),
    Promise.all(summaries.map((m) => loadMenuWith(sb, m.id))),
    loadOutingsWith(
      sb,
      centralToday(),
      summaries.flatMap((m) => (m.calendarEntryId != null ? [m.calendarEntryId] : []))
    )
  ]);
  const outingName = new Map(outings.map((o) => [o.id, o.title]));

  const rows: MenuRowData[] = summaries.map((m, i) => {
    const menu = stored[i]?.menu;
    const cost = menu ? menuCost(menu, catalog) : null;
    return {
      id: m.id,
      name: m.name,
      contextLabel: MENU_CONTEXTS.find((c) => c.key === m.context)?.label ?? m.context,
      outingName: m.calendarEntryId != null ? (outingName.get(m.calendarEntryId) ?? null) : null,
      mealCount: m.mealCount,
      perPersonMeal: cost && cost.total > 0 ? cost.perPersonMeal : null
    };
  });

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
