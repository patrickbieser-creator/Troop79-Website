/**
 * /library/menu-monster/menus/new — a blank Plan tab. Nothing is stored until
 * the scout's first Save, which creates the menu and moves to its own URL.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { DEFAULT_MENU_BUDGET, DEFAULT_MENU_DAYS, emptyShopping, type Menu } from '@/lib/menu-monster/menus';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { PageShell } from '@/app/_components/page-shell';
import { PlanTab } from '../_components/plan-tab';
import { LockedLine, MENUS_HREF, MenuHeader, scoutViewer } from '../_components/scout-menus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New menu — Menu Monster' };

const BLANK: Menu = {
  name: '',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: DEFAULT_MENU_BUDGET,
  dayCount: DEFAULT_MENU_DAYS,
  shopping: emptyShopping(),
  meals: []
};

export default async function NewMenuPage() {
  const viewer = await scoutViewer();
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
  const [catalog, outings] = await Promise.all([loadMenuMonsterCatalog(), loadOutingsWith(createAdminClient(), centralToday())]);
  return (
    <>
      <MenuHeader current="new" />
      <PageShell>
        <PlanTab catalog={catalog} menuId={null} menu={BLANK} updatedAt={null} outings={outings} />
      </PageShell>
    </>
  );
}
