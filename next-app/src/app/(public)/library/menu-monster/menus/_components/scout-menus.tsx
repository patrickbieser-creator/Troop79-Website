/**
 * Server-side pieces the menu pages share: who is looking, the owner-only menu
 * read, the page header, the Plan / Shopping tabs, and the one-line locked
 * state for anyone who isn't a signed-in scout.
 *
 * Reads are owner-only for now (Phase 3 adds leaders, parents and shared
 * menus): a menu that is missing OR someone else's is the same null, so the
 * pages answer both with notFound(). Writes re-check the verified scout in the
 * server actions; this read uses the signature-only session, like every page.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { loadMenuWith, type StoredMenu } from '@/lib/menu-monster/menus-store';
import { isMenuId } from '@/lib/menu-monster/menus';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { TabStrip } from '@/app/_components/tab-strip';
import s from './workspace.module.css';

export const MENUS_HREF = '/library/menu-monster/menus';

export interface ScoutViewer {
  personId: number;
  displayName: string;
}

/** The signed-in scout, or null for everyone else (anonymous, adults, leaders). */
export async function scoutViewer(): Promise<ScoutViewer | null> {
  const session = await getIdentitySessionIfValid();
  if (!session || session.subjectKind !== 'scout') return null;
  return { personId: session.personId, displayName: session.displayName };
}

/** The viewer's own menu by id, or null (missing, malformed id, or not theirs). */
export async function loadOwnMenu(menuId: string, viewer: ScoutViewer): Promise<StoredMenu | null> {
  if (!isMenuId(menuId)) return null;
  const stored = await loadMenuWith(createAdminClient(), menuId);
  return stored && stored.ownerPersonId === viewer.personId ? stored : null;
}

/**
 * The page header's kicker line. The h1 is the page's own: My menus passes a
 * `title`; a menu's pages render the live menu name (Plan, Shopping) or the
 * meal title (meal page) themselves, so there is exactly one title on screen.
 * `menu` adds the menu's name as a link back to its Plan tab (the meal page's
 * way back).
 */
export function MenuHeader({ title, current, menu }: { title?: string; current?: string; menu?: { id: string; name: string } }) {
  return (
    <PageHeader
      kicker={
        <>
          <Link href="/library/topic/menu-monster">Menu Monster</Link>
          <KickerSep />
          {current ? <Link href={MENUS_HREF}>My menus</Link> : 'My menus'}
          {menu && (
            <>
              <KickerSep />
              <Link href={`${MENUS_HREF}/${menu.id}`}>{menu.name}</Link>
            </>
          )}
        </>
      }
      title={title}
    />
  );
}

export function MenuTabs({ menuId, active }: { menuId: string; active: 'plan' | 'shopping' }) {
  return (
    <TabStrip
      ariaLabel="Menu sections"
      activeKey={active}
      items={[
        { key: 'plan', label: 'Plan', href: `${MENUS_HREF}/${menuId}` },
        { key: 'shopping', label: 'Shopping', href: `${MENUS_HREF}/${menuId}/shopping` }
      ]}
    />
  );
}

/** Not a scout: one locked line, a way in, and the planner that needs no sign-in. */
export function LockedLine({ next }: { next: string }) {
  return (
    <p className={s.locked}>
      Scouts: <Link className={s.link} href={`/signin?next=${encodeURIComponent(next)}`}>sign in to save your menu</Link>
      {'. '}
      <Link className={s.link} href="/library/topic/menu-monster">
        Plan a meal without signing in
      </Link>
    </p>
  );
}
