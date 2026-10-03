/**
 * Server-side pieces the menu pages share: who is looking, the owner-only menu
 * read, the page header, the Plan / Shopping tabs, and the one-line locked
 * state for anyone who isn't a signed-in scout.
 *
 * Reads: the owner scout edits; an admin viewer (any adult holding at least one
 * admin capability — Plans/Menu-Monster-Scout-Workspace.md Decision 2) reads any
 * menu read-only. A menu that is missing OR not viewable is the same null, so
 * the pages answer both with notFound(). Phase 3 adds parents and shared
 * viewers. Writes re-check the verified scout in the server actions, so a
 * leader's session can never save; this read uses the signature-only session,
 * like every page.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { resolveAdminActor } from '@/lib/admin-actor';
import { loadMenuWith, ownerCreditNamesWith, type StoredMenu } from '@/lib/menu-monster/menus-store';
import { isMenuId } from '@/lib/menu-monster/menus';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { TabStrip } from '@/app/_components/tab-strip';
import s from './workspace.module.css';

export const MENUS_HREF = '/library/menu-monster/menus';
export const MENU_HUB_HREF = '/library/topic/menu-monster';

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

export interface LeaderViewer {
  /** Null for a legacy leader-cookie session whose label does not resolve to one person. */
  personId: number | null;
  label: string;
}

/** Who is looking at the menus: a scout (own menus, editable), a leader (every
 *  menu, read-only) or nobody. A scout session wins if both somehow apply. */
export type MenuViewer = ({ kind: 'scout' } & ScoutViewer) | ({ kind: 'leader' } & LeaderViewer);

/** Scout, admin viewer (an actor holding at least one capability), or null. */
export async function menuViewer(): Promise<MenuViewer | null> {
  const scout = await scoutViewer();
  if (scout) return { kind: 'scout', ...scout };
  const actor = await resolveAdminActor();
  if (!actor || actor.subjectKind === 'scout' || actor.capabilities.size === 0) return null;
  return { kind: 'leader', personId: actor.personId, label: actor.label };
}

/** A menu a viewer may open, how, and (read-only) whose it is. */
export interface ViewableMenu {
  stored: StoredMenu;
  readOnly: boolean;
  /** Credit name of the owner scout ("Sam K."), set for a leader's read-only view. */
  plannedBy: string | null;
}

/** The menu by id for this viewer, or null: the scout gets their own to edit,
 *  a leader gets any menu read-only. */
export async function loadViewableMenu(menuId: string, viewer: MenuViewer): Promise<ViewableMenu | null> {
  if (viewer.kind === 'scout') {
    const stored = await loadOwnMenu(menuId, viewer);
    return stored ? { stored, readOnly: false, plannedBy: null } : null;
  }
  if (!isMenuId(menuId)) return null;
  const sb = createAdminClient();
  const stored = await loadMenuWith(sb, menuId);
  if (!stored) return null;
  const names = await ownerCreditNamesWith(sb, [stored.ownerPersonId]);
  return { stored, readOnly: true, plannedBy: names.get(stored.ownerPersonId) ?? null };
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
export function MenuHeader({
  title,
  current,
  menu,
  listLabel = 'My menus'
}: {
  title?: string;
  current?: string;
  menu?: { id: string; name: string };
  /** The list's name in the kicker: a leader's list is "Scouts' menus". */
  listLabel?: string;
}) {
  return (
    <PageHeader
      kicker={
        <>
          <Link href="/library/topic/menu-monster">Menu Monster</Link>
          <KickerSep />
          {current ? <Link href={MENUS_HREF}>{listLabel}</Link> : listLabel}
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

/**
 * Not a scout: one locked line and a way in. On the workspace pages it also
 * points at the planner that needs no sign-in; `hub` is the Menu Monster
 * shelf's own quiet version (the planner is already right below it).
 */
export function LockedLine({ next, hub = false }: { next: string; hub?: boolean }) {
  if (hub) {
    return (
      <p className={s.foot}>
        Scouts:{' '}
        <Link className={s.link} href={`/signin?next=${encodeURIComponent(next)}`}>
          sign in
        </Link>{' '}
        to save menus, plan several meals and share a shopping list.
      </p>
    );
  }
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

/**
 * The local menu pages (/menus/local…) are for visitors and leaders. A signed-in
 * scout has saved menus instead: send them to the hub, where an unsaved menu
 * left on this computer is offered for saving. `redirect` throws, so nothing
 * below the call runs for a scout.
 */
export async function redirectScoutFromLocal(): Promise<void> {
  if (await scoutViewer()) redirect(MENU_HUB_HREF);
}

/** The kicker for the local menu's pages: Menu Monster › Menu on this computer. */
export function LocalMenuHeader({ current }: { current: 'plan' | 'shopping' | 'meal' }) {
  return (
    <PageHeader
      kicker={
        <>
          <Link href={MENU_HUB_HREF}>Menu Monster</Link>
          <KickerSep />
          {current === 'plan' ? 'Menu on this computer' : <Link href={`${MENUS_HREF}/local`}>Menu on this computer</Link>}
        </>
      }
    />
  );
}
