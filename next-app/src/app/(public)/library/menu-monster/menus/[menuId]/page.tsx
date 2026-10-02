/**
 * /library/menu-monster/menus/[menuId] — the Plan tab. Owner only for now:
 * anyone else (or a missing menu) gets notFound(); Phase 3 adds leaders,
 * parents and shared viewers.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../_components/plan-tab';
import { MenuHeader, MenuTabs, loadOwnMenu, scoutViewer } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Menu plan — Menu Monster' };

export default async function MenuPlanPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const viewer = await scoutViewer();
  if (!viewer) notFound();
  const stored = await loadOwnMenu(menuId, viewer);
  if (!stored) notFound();
  const linked = stored.menu.calendarEntryId != null ? [stored.menu.calendarEntryId] : [];
  const [catalog, outings] = await Promise.all([
    loadMenuMonsterCatalog(),
    loadOutingsWith(createAdminClient(), centralToday(), linked)
  ]);
  return (
    <>
      <MenuHeader current="plan" />
      <PageShell>
        <PlanTab
          catalog={catalog}
          menuId={stored.id}
          menu={stored.menu}
          updatedAt={stored.updatedAt}
          outings={outings}
          tabs={<MenuTabs menuId={stored.id} active="plan" />}
        />
      </PageShell>
    </>
  );
}
