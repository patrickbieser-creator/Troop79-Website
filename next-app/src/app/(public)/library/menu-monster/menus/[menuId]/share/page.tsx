/**
 * /library/menu-monster/menus/[menuId]/share — the menu's third tab (Phase 3,
 * Decision 11). The owner scout's "Share": Share with the troop / Stop sharing
 * and where a shared menu shows. A leader's "Review": the one review note the
 * scout sees, and Hide from the shelf. Nobody else has this tab: a parent or
 * a shared viewer gets notFound() here.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { PageShell } from '@/app/_components/page-shell';
import { MenuHeader, MenuTabs, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ReadOnlyLine } from '../../_components/read-only-line';
import { ReviewPanel } from '../../_components/review-panel';
import { SharePanel } from '../../_components/share-panel';
import s from '../../_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Share — Menu Monster', robots: NO_INDEX };

export default async function MenuSharePage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view || (view.access !== 'owner' && view.access !== 'admin')) notFound();
  const { stored } = view;
  const sb = createAdminClient();
  const [credit, outing] = await Promise.all([
    ownerCreditNamesWith(sb, [stored.ownerPersonId]).then((m) => m.get(stored.ownerPersonId) ?? null),
    stored.menu.calendarEntryId == null
      ? Promise.resolve(null)
      : sb.from('calendar_entries').select('title').eq('id', stored.menu.calendarEntryId).maybeSingle().then((r) => (r.data?.title as string | undefined) ?? null)
  ]);
  const status = { sharedAt: stored.sharedAt, outingTitle: outing, outingPublished: stored.entryPublished };
  return (
    <>
      <MenuHeader current="share" {...listCrumb(view.access)} />
      <PageShell>
        <div className={s.titleLine}>
          <h1 className={s.menuTitle}>{stored.menu.name.trim() || 'Untitled menu'}</h1>
        </div>
        {view.readOnly && <ReadOnlyLine plannedBy={view.plannedBy} />}
        <div className={s.tabs}>
          <MenuTabs menuId={stored.id} active="share" access={view.access} />
        </div>
        {/* The owner shares; a leader reviews — and, working on the scout's menu, can share it for them too. */}
        {(view.access === 'owner' || view.helping) && <SharePanel menuId={stored.id} credit={credit} status={status} />}
        {view.access !== 'owner' && <ReviewPanel menuId={stored.id} note={stored.review?.note ?? ''} status={status} plannedBy={view.plannedBy} />}
      </PageShell>
    </>
  );
}
