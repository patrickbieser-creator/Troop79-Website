/**
 * /library/menu-monster/menus/[menuId] — the Plan tab. The owner scout edits; a
 * leader (admin viewer) reads any menu read-only; anyone else (or a missing
 * menu) gets notFound(). Phase 3 adds parents and shared viewers.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../_components/plan-tab';
import { MenuHeader, MenuTabs, loadViewableMenu, menuViewer } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Menu plan — Menu Monster' };

export default async function MenuPlanPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const viewer = await menuViewer();
  if (!viewer) notFound();
  const view = await loadViewableMenu(menuId, viewer);
  if (!view) notFound();
  const { stored, readOnly, plannedBy } = view;
  const linked = stored.menu.calendarEntryId != null ? [stored.menu.calendarEntryId] : [];
  const [catalog, outings] = await Promise.all([
    loadMenuMonsterCatalog(stored.ownerPersonId),
    loadOutingsWith(createAdminClient(), centralToday(), linked)
  ]);
  return (
    <>
      <MenuHeader current="plan" listLabel={readOnly ? 'Scouts’ menus' : undefined} />
      <PageShell>
        <PlanTab
          catalog={catalog}
          menuId={stored.id}
          menu={stored.menu}
          updatedAt={stored.updatedAt}
          outings={outings}
          readOnly={readOnly}
          plannedBy={plannedBy}
          tabs={<MenuTabs menuId={stored.id} active="plan" />}
        />
      </PageShell>
    </>
  );
}
