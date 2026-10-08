/**
 * /library/menu-monster/menus/[menuId]/print — the cook sheet (Patrick, 2026-10-08): one menu on paper, no site
 * chrome (globals.css hides it for #mm-cook-sheet-page). Anyone who can open the menu can print it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { CookSheet } from '../../_components/cook-sheet';
import { PrintButton } from '../../_components/print-button';
import { MENUS_HREF, NO_INDEX, loadViewableMenu, menuViewer } from '../../_components/scout-menus';
import s from '../../_components/cook-sheet.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Cook sheet — Menu Monster', robots: NO_INDEX };

export default async function MenuPrintPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const view = await loadViewableMenu(menuId, await menuViewer());
  if (!view) notFound();
  const { stored, catalog } = view;
  return (
    <main>
      <div id="mm-cook-sheet-page">
        <div className={s.toolbar}>
          <Link href={`${MENUS_HREF}/${stored.id}`}>‹ Back to the menu</Link>
          <PrintButton label="Print" />
        </div>
        <CookSheet menu={resolveMenuAliases(stored.menu, catalog.aliases)} catalog={catalog} plannedBy={view.plannedBy} />
      </div>
    </main>
  );
}
