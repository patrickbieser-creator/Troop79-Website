/**
 * /library/menu-monster/menus/[menuId]/review — a leader's fifth step (Patrick, 2026-10-06: "Add Review as
 * a 5th step in the step flow, but only show it to those who are authorized"): the one review note the
 * scout sees on their Plan tab, Hide from the shelf, and — when the leader is working on the scout's menu —
 * Share on their behalf. Anyone but a leader gets notFound().
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { PageShell } from '@/app/_components/page-shell';
import { MENUS_HREF, MenuHeader, MenuRail, MenuSteps, NO_INDEX, listCrumb, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import { ReadOnlyLine } from '../../_components/read-only-line';
import { ReviewPanel } from '../../_components/review-panel';
import { SharePanel } from '../../_components/share-panel';
import s from '../../_components/workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review — Menu Monster', robots: NO_INDEX };

export default async function MenuReviewPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view || view.access !== 'admin') notFound();
  const { stored } = view;
  const menu = resolveMenuAliases(stored.menu, view.catalog.aliases);
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
      <MenuHeader current="review" {...listCrumb(view.access)} />
      <PageShell>
        <MenuRail menuId={stored.id} active="review" access={view.access} menu={menu} catalog={view.catalog} />
        <div className={s.titleLine}>
          <h1 className={s.menuTitle}>{stored.menu.name.trim() || 'Untitled menu'}</h1>
        </div>
        {view.readOnly && <ReadOnlyLine plannedBy={view.plannedBy} />}
        <MenuSteps menuId={stored.id} active="review" access={view.access} menu={menu} catalog={view.catalog} shoppingDone={view.shoppingDone} hasReceipt={view.hasReceipt} />
        {/* The cook sheet (Patrick, 2026-10-08): the whole plan on paper, two columns. */}
        <p className={s.foot}>
          <Link href={`${MENUS_HREF}/${stored.id}/print`}>Print plan</Link> as a cook sheet.
        </p>
        <ReviewPanel menuId={stored.id} note={stored.review?.note ?? ''} status={status} plannedBy={view.plannedBy} />
        {/* Working on the scout's menu, a leader can share it for them too. */}
        {view.helping && <SharePanel menuId={stored.id} credit={credit} status={status} />}
      </PageShell>
    </>
  );
}
