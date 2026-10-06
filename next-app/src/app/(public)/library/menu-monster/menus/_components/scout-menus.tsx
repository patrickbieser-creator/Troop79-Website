/**
 * Server-side pieces the menu pages share: who is looking, the owner-only menu
 * read, the page header, the step strip and summary rail, and the one-line locked
 * state for anyone who isn't a signed-in scout.
 *
 * Reads (Phase 3, menu-access.ts): the owner scout edits; an admin viewer (any
 * adult holding at least one admin capability, Decision 2) reads any menu; a
 * parent reads their scouts' menus; anyone else reads a SHARED menu. All but
 * the owner read-only and redacted. A menu that is missing OR not viewable is
 * the same null, so the pages answer both with notFound(). Writes re-check the
 * session in the server actions, so a read-only viewer can never save; this
 * read uses the signature-only session, like every page.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid, requireVerifiedScoutIdentity } from '@/lib/family-access';
import { resolveAdminActor } from '@/lib/admin-actor';
import { resolveFamilyScope } from '@/lib/household-scope';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { loadMenuWith, ownerCreditNamesWith, type StoredMenu } from '@/lib/menu-monster/menus-store';
import { isMenuId, menuCredit } from '@/lib/menu-monster/menus';
import { canEditPlan, canRecord, menuAccess, redactMenu, type AccessViewer, type MenuAccess, isPublic } from '@/lib/menu-monster/menu-access';
import type { Catalog } from '@/lib/menu-monster/types';
import type { Menu } from '@/lib/menu-monster/menus';
import { outingOver, planProgress } from '@/lib/menu-monster/menu-view';
import { centralToday } from '@/lib/dates';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { Button } from '@/app/_components/button';
import { StepStrip, type StepCurrent, type StepStripConfig } from './step-strip';
import { SummaryRail } from './summary-rail';
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

/**
 * Who may write a recipe or save a menu: anyone signed in who is one person — a scout, a leader, a parent
 * (Patrick, 2026-10-03: "anyone signed in can create recipes, not just scouts"; 2026-10-04: "adults do need
 * to get access to saved menus also"). The name is the public credit form
 * ("Sam K."), read from `people`. Null for everyone else, and for a leader cookie that names no one person.
 */
export async function recipeAuthor(): Promise<ScoutViewer | null> {
  const viewer = await menuViewer();
  if (!viewer || viewer.personId == null) return null;
  if (viewer.kind === 'scout') return { personId: viewer.personId, displayName: viewer.displayName };
  const names = await ownerCreditNamesWith(createAdminClient(), [viewer.personId]);
  return { personId: viewer.personId, displayName: names.get(viewer.personId) ?? (viewer.kind === 'leader' ? viewer.label : 'A parent') };
}

export interface LeaderViewer {
  /** Null for a legacy leader-cookie session whose label does not resolve to one person. */
  personId: number | null;
  label: string;
}

export interface ParentViewer {
  personId: number;
  /** Themselves and the children in their family scope (parent_of / guardian_of), read per request. */
  familyIds: number[];
}

/** Who is looking at the menus: a scout (own menus, editable), a leader (every
 *  menu, read-only), a parent (their scouts' menus, read-only) or nobody. A
 *  scout session wins if both somehow apply; an admin viewer wins over parent. */
export type MenuViewer = ({ kind: 'scout' } & ScoutViewer) | ({ kind: 'leader' } & LeaderViewer) | ({ kind: 'parent' } & ParentViewer);

/** Scout, admin viewer (an actor holding at least one capability), parent (any other verified adult), or null. */
export async function menuViewer(): Promise<MenuViewer | null> {
  const session = await getIdentitySessionIfValid();
  if (session?.subjectKind === 'scout') return { kind: 'scout', personId: session.personId, displayName: session.displayName };
  const actor = await resolveAdminActor();
  if (actor && actor.subjectKind !== 'scout' && actor.capabilities.size > 0) return { kind: 'leader', personId: actor.personId, label: actor.label };
  if (session?.subjectKind === 'adult') {
    const sb = createAdminClient();
    // A parent reads unshared menus (prices paid included), so a revoked session ends here, not at cookie expiry (qa-lead).
    if (!(await isEpochCurrent(sb, session))) return null;
    // Read at request time, never cached: a removed relationship ends access on the next load (specialist review).
    const familyIds = await resolveFamilyScope(sb, session.personId, 'adult');
    return { kind: 'parent', personId: session.personId, familyIds };
  }
  return null;
}

/** A menu a viewer may open, how, and (read-only) whose it is. */
export interface ViewableMenu {
  /** Redacted for the viewer (menu-access.ts redactMenu): a non-owner never gets the snapshot, a shared viewer no review note. */
  stored: StoredMenu;
  access: MenuAccess;
  readOnly: boolean;
  /** A leader editing a menu that is not theirs (menu-access.ts canEditPlan): everything saves, as the owner's menu. */
  helping: boolean;
  /** For the owner: who made the latest save when it was a leader ("Pat B.", or "A leader"); null otherwise. */
  leaderEditBy: string | null;
  /** Credit name of the owner scout ("Sam K."), set for every view that is not the owner's. */
  plannedBy: string | null;
  /** The owner's catalog for the owner; the public catalog for everyone else. */
  catalog: Catalog;
  /** Recipes in the menu the viewer can't see (the owner's unshared drafts). */
  hiddenRecipes: number;
  /** A signed-in scout looking at someone else's menu: Copy to My menus. */
  canCopy: boolean;
}

const accessViewer = (v: MenuViewer | null): AccessViewer =>
  v == null
    ? { kind: 'anon', personId: null, familyIds: [] }
    : { kind: v.kind, personId: v.personId, familyIds: v.kind === 'parent' ? v.familyIds : [] };

/**
 * The menu by id for this viewer, or null (missing, malformed id, or not
 * theirs to see — one answer, so the pages notFound() both). The single
 * redaction point (tech-lead review): whatever a page renders for a non-owner
 * comes through here.
 */
export async function loadViewableMenu(menuId: string, viewer: MenuViewer | null): Promise<ViewableMenu | null> {
  if (!isMenuId(menuId)) return null;
  const sb = createAdminClient();
  const raw = await loadMenuWith(sb, menuId);
  if (!raw) return null;
  const access = menuAccess(accessViewer(viewer), raw);
  if (!access) return null;
  if (access === 'owner') {
    const by = raw.leaderEdit?.byPersonId ?? null;
    const [catalog, names] = await Promise.all([
      loadMenuMonsterCatalog(raw.ownerPersonId),
      by != null ? ownerCreditNamesWith(sb, [by]) : Promise.resolve(new Map<number, string>())
    ]);
    const leaderEditBy = raw.leaderEdit ? ((by != null ? names.get(by) : null) ?? 'A leader') : null;
    return { stored: raw, access, readOnly: false, helping: false, leaderEditBy, plannedBy: null, catalog, hiddenRecipes: 0, canCopy: false };
  }
  // A leader signed in as one person edits the menu (Patrick, 2026-10-05). They get it exactly as the owner
  // has it — the OWNER'S catalog, nothing redacted — because a save writes back what was loaded: the public
  // catalog would silently drop the scout's unshared recipes and typed-in ingredients from their own menu.
  // A legacy leader cookie that names no person still only reads (a save needs someone to credit).
  if (canEditPlan(access) && viewer?.personId != null) {
    const [catalog, names] = await Promise.all([loadMenuMonsterCatalog(raw.ownerPersonId), ownerCreditNamesWith(sb, [raw.ownerPersonId])]);
    return { stored: raw, access, readOnly: false, helping: true, leaderEditBy: null, plannedBy: menuCredit(raw.menu.patrol, names.get(raw.ownerPersonId) ?? null), catalog, hiddenRecipes: 0, canCopy: false };
  }
  // Crew reads another scout's unshared menu, so a revoked sign-in ends here, not at cookie expiry (qa-lead; the
  // parent branch of menuViewer makes the same check).
  if (access === 'crew') {
    try {
      await requireVerifiedScoutIdentity();
    } catch {
      return null;
    }
  }
  const [catalog, names] = await Promise.all([loadMenuMonsterCatalog(null), ownerCreditNamesWith(sb, [raw.ownerPersonId])]);
  const { menu, hiddenRecipes } = redactMenu(raw.menu, access, catalog);
  const stored: StoredMenu = { ...raw, menu, snapshot: null, review: access === 'shared' || access === 'crew' ? null : raw.review, leaderEdit: null };
  return { stored, access, readOnly: true, helping: false, leaderEditBy: null, plannedBy: menuCredit(raw.menu.patrol, names.get(raw.ownerPersonId) ?? null), catalog, hiddenRecipes, canCopy: viewer != null && viewer.personId != null && isPublic(raw) };
}

/**
 * Who is acting on a menu for a write its crew may make — a Gear tab tick, what was bought — or null when
 * they may not (menu-access.ts canRecord: the owner, any signed-in scout on an outing's menu, a leader).
 * A scout's sign-in is epoch-checked here, like every other scout write. `name` is what the row will show.
 */
export async function menuRecorder(menuId: string): Promise<{ access: MenuAccess; stored: StoredMenu; personId: number | null; name: string } | null> {
  if (!isMenuId(menuId)) return null;
  const viewer = await menuViewer();
  if (!viewer) return null;
  const sb = createAdminClient();
  const stored = await loadMenuWith(sb, menuId);
  if (!stored) return null;
  const access = menuAccess(accessViewer(viewer), stored);
  if (!canRecord(access)) return null;
  if (viewer.kind === 'scout') {
    try {
      await requireVerifiedScoutIdentity();
    } catch {
      return null;
    }
    const names = await ownerCreditNamesWith(sb, [viewer.personId]);
    return { access: access as MenuAccess, stored, personId: viewer.personId, name: names.get(viewer.personId) ?? viewer.displayName };
  }
  const adult = viewer.personId != null ? (await ownerCreditNamesWith(sb, [viewer.personId])).get(viewer.personId) : undefined;
  return { access: access as MenuAccess, stored, personId: viewer.personId, name: adult ?? (viewer.kind === 'leader' ? viewer.label : 'A parent') };
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
  listLabel = 'My menus',
  listHref = MENUS_HREF
}: {
  title?: string;
  current?: string;
  menu?: { id: string; name: string };
  /** The list's name in the kicker: a leader's list is "Scouts' menus". */
  listLabel?: string;
  /** Where the list crumb goes (a shared viewer's goes to the shared-menus list). */
  listHref?: string;
}) {
  return (
    <PageHeader
      kicker={
        <>
          <Link href="/library/topic/menu-monster">Menu Monster</Link>
          <KickerSep />
          {current ? <Link href={listHref}>{listLabel}</Link> : listLabel}
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

export const SHARED_HREF = `${MENUS_HREF}/shared`;

/** The kicker's list crumb for a viewer: their own list, or the shared-menus list. */
export function listCrumb(access: MenuAccess): { listLabel?: string; listHref?: string } {
  if (access === 'admin') return { listLabel: 'Everyone’s menus' };
  if (access === 'parent') return { listLabel: 'Your scouts’ menus' };
  if (access === 'shared' || access === 'crew') return { listLabel: 'Shared with the troop', listHref: SHARED_HREF };
  return {};
}

/** Menu pages are per-viewer and carry scouts' names: never indexed (tech-lead review). */
export const NO_INDEX = { index: false, follow: false } as const;

export type MenuPage = 'plan' | 'shopping' | 'gear' | 'bought' | 'conversions' | 'share';

const CURRENT: Record<MenuPage, StepCurrent[]> = {
  plan: ['eating', 'meals'],
  gear: ['gear'],
  shopping: ['shopping'],
  // Conversions is a quiet link from the Shopping footer: it belongs to that step.
  conversions: ['shopping'],
  bought: ['bought'],
  share: ['share']
};

/**
 * The step strip's routes for a menu (also the Plan tab's, so its ticks can follow the draft). What we bought
 * joins once the outing's last day has passed, or while you are on it (never locked, never lost); a shared
 * viewer never sees what was paid. Share is a quiet action for the owner, Review for a leader.
 */
export function stepConfig(menuId: string, access: MenuAccess, menu: Menu, page: MenuPage, today: string): StepStripConfig {
  const base = `${MENUS_HREF}/${menuId}`;
  const showBought = access !== 'shared' && (page === 'bought' || outingOver(menu, today));
  const shareLabel = access === 'owner' ? 'Share' : access === 'admin' ? 'Review' : null;
  return {
    plan: base,
    gear: `${base}/gear`,
    shopping: `${base}/shopping`,
    ...(showBought ? { bought: `${base}/bought` } : {}),
    ...(shareLabel ? { share: { label: shareLabel, href: `${base}/share` } } : {})
  };
}

/** The strip on every page but the Plan tab (which draws its own from the draft): ticks come from the saved menu. */
export function MenuSteps({ menuId, active, access = 'owner', menu, catalog }: { menuId: string; active: MenuPage; access?: MenuAccess; menu: Menu; catalog: Catalog }) {
  const p = planProgress(menu, catalog);
  return (
    <StepStrip
      config={stepConfig(menuId, access, menu, active, centralToday())}
      done={{ eating: p.steps.eating.done, meals: p.steps.meals.done, gear: p.steps.gear.done, shopping: p.steps.shopping.done }}
      current={CURRENT[active]}
    />
  );
}

/** The summary rail on every page but the Plan tab: the SAVED menu's headcount, cost and things to fix, and the next step. */
export function MenuRail({ menuId, active, access = 'owner', menu, catalog }: { menuId: string; active: MenuPage; access?: MenuAccess; menu: Menu; catalog: Catalog }) {
  const base = `${MENUS_HREF}/${menuId}`;
  const share = access === 'owner' ? 'Share' : access === 'admin' ? 'Review' : null;
  const next = active === 'gear' ? { label: 'Next: Shopping ›', href: `${base}/shopping` } : active === 'shopping' && share ? { label: `Next: ${share} ›`, href: `${base}/share` } : null;
  return (
    <SummaryRail progress={planProgress(menu, catalog)} hrefs={{ plan: base, gear: `${base}/gear`, shopping: `${base}/shopping` }}>
      {next && (
        <Button variant="primary" href={next.href}>
          {next.label}
        </Button>
      )}
    </SummaryRail>
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
        <Link className={s.link} href={`/signin?next=${encodeURIComponent(next)}`}>
          Sign in
        </Link>{' '}
        to save menus, plan several meals and share a shopping list.
      </p>
    );
  }
  return (
    <p className={s.locked}>
      <Link className={s.link} href={`/signin?next=${encodeURIComponent(next)}`}>Sign in to save your menu</Link>
      {'. '}
      <Link className={s.link} href="/library/topic/menu-monster">
        Plan a meal without signing in
      </Link>
    </p>
  );
}

/**
 * The local menu pages (/menus/local…) are for visitors. Anyone signed in as one
 * person has saved menus instead: send them to the hub, where an unsaved menu
 * left on this computer is offered for saving. `redirect` throws, so nothing
 * below the call runs for a scout.
 */
export async function redirectScoutFromLocal(): Promise<void> {
  if (await recipeAuthor()) redirect(MENU_HUB_HREF);
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
