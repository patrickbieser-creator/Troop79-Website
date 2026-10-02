/**
 * /library/menu-monster/menus/[menuId]/shopping — the Shopping tab. Slice 5
 * builds the merged cross-meal list; until then it is an honest empty state.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/app/_components/page-shell';
import { EmptyState } from '@/app/_components/empty-state';
import { MENUS_HREF, MenuHeader, MenuTabs, loadOwnMenu, scoutViewer } from '../../_components/scout-menus';
import s from '../../_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shopping — Menu Monster' };

export default async function MenuShoppingPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const viewer = await scoutViewer();
  if (!viewer) notFound();
  const stored = await loadOwnMenu(menuId, viewer);
  if (!stored) notFound();
  return (
    <>
      <MenuHeader current="shopping" />
      <PageShell>
        <div className={s.titleLine}>
          <h1 className={s.menuTitle}>{stored.menu.name}</h1>
        </div>
        <div className={s.tabs}>
          <MenuTabs menuId={stored.id} active="shopping" />
        </div>
        <EmptyState>
          The shopping list for the whole menu is coming next. Until then, each meal has its own list:{' '}
          <Link href={`${MENUS_HREF}/${stored.id}`}>back to the Plan tab</Link> and open a meal.
        </EmptyState>
      </PageShell>
    </>
  );
}
