'use server';

/**
 * Scout Workspace menu actions (Plans/Menu-Monster-Scout-Workspace.md, Phase 1).
 *
 * Thin by design: each action checks the verified scout session, folds the
 * client's payload through sanitizeMenu(), and hands off to the menu store
 * (lib/menu-monster/menus-store.ts — the db-tested half), which also builds
 * the priced snapshot from the live catalog on every create and save. The owner is ALWAYS
 * session.personId; nothing the client sends can name another scout.
 * 'use server' files export async functions only — types and constants live
 * in lib/menu-monster/menus.ts.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedScoutIdentity } from '@/lib/family-access';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { MAX_ACTUALS_BYTES, MAX_MENU_BYTES, MAX_MENUS_PER_SCOUT, isMenuId, menuNameError, sanitizeActuals, sanitizeMenu, type Menu, type PaidStatus } from '@/lib/menu-monster/menus';
import { MAX_REVIEW_NOTE, MENU_LIMIT, addMenuIngredientWith, copyMenuWith, createMenuWith, deleteMenuWith, duplicateMenuWith, hideMenuWith, loadMenuWith, saveActualsWith, saveMenuWith, setMenuSharedWith, setReviewNoteWith } from '@/lib/menu-monster/menus-store';
import { resolveMealGearWith } from '@/lib/menu-monster/gear-store';
import { resolveAdminActor } from '@/lib/admin-actor';
import { sanitizeNewIngredients } from '@/lib/menu-monster/scout-ingredients';
import { sanitizeScoutPackage } from '@/lib/menu-monster/scout-packages';
import { addScoutPackageWith } from '@/lib/menu-monster/scout-packages-store';
import { reportPriceWith } from '@/lib/menu-monster/price-history';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { centralToday } from '@/lib/dates';
import { recordAuditAs, type AuditActor } from '@/lib/audit';
import { menuViewer, recipeAuthor } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };

/** The menu's owner-to-be: a verified scout (the epoch check every scout write makes), else any other signed-in
 *  person (a leader, a parent — menuViewer re-checks a parent's sign-in). Never taken from the payload. */
async function scoutActor(): Promise<AuditActor | Fail> {
  try {
    const s = await requireVerifiedScoutIdentity();
    return { personId: s.personId, label: s.displayName };
  } catch (e) {
    const viewer = await menuViewer();
    if (viewer && viewer.kind !== 'scout' && viewer.personId != null) {
      const who = await recipeAuthor();
      if (who) return { personId: who.personId, label: who.displayName };
    }
    // A scout hears why their sign-in ended; everyone else is simply asked to sign in.
    return { ok: false, error: e instanceof Error && viewer?.kind === 'scout' ? e.message : 'Sign in to save your menu.' };
  }
}

const isFail = (v: AuditActor | Fail): v is Fail => 'ok' in v;

const NOT_YOURS = 'That menu isn’t one of yours.';
const LIMIT_MESSAGE = `You have ${MAX_MENUS_PER_SCOUT} menus — delete one you don’t need to make room.`;
const NOT_SHARED = 'That menu isn’t shared any more.';
const TOO_BIG = 'This menu is too big to save. Remove some meals or edits and try again.';

/** True when the payload serializes past MAX_MENU_BYTES (or can't serialize at all). */
function tooBig(raw: unknown, cap: number = MAX_MENU_BYTES): boolean {
  try {
    return (JSON.stringify(raw) ?? '').length > cap;
  } catch {
    return true;
  }
}

/** Clean the payload and check the name; the error is what the name field shows. */
async function cleanMenu(raw: unknown, ownerPersonId: number | null) {
  const catalog = await loadMenuMonsterCatalog(ownerPersonId);
  const menu = sanitizeMenu(raw, catalog);
  return { menu, catalog, nameError: menuNameError(menu.name) };
}

/** A calendar link survives only if it is an outing a scout may pick today
 *  (published, on the calendar, an overnight category) or the one the menu
 *  already carries; anything else is dropped to "no outing". */
async function allowedOuting(menu: Menu, linkedId: number | null): Promise<Menu> {
  if (menu.calendarEntryId == null) return menu;
  const outings = await loadOutingsWith(createAdminClient(), centralToday(), linkedId == null ? [] : [linkedId]);
  return outings.some((o) => o.id === menu.calendarEntryId) ? menu : { ...menu, calendarEntryId: null };
}

/**
 * Who is writing to this menu, and whose it is. The owner writes their own. A LEADER — an adult holding an
 * admin capability, signed in as one person, re-checked on every call — writes anyone's (Patrick,
 * 2026-10-05: "Leaders need full rights to scout menus. They often will work side by side with scouts on
 * their menus at troop meetings"). The owner always comes from the row, never the payload; everyone else
 * gets the answer a missing menu gets.
 */
async function menuWriter(id: unknown): Promise<{ actor: AuditActor; ownerId: number; own: boolean; current: NonNullable<Awaited<ReturnType<typeof loadMenuWith>>> } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: NOT_YOURS };
  const current = await loadMenuWith(createAdminClient(), id);
  if (!current) return { ok: false, error: NOT_YOURS };
  const own = current.ownerPersonId === actor.personId;
  if (!own) {
    // The leader check and the person the write is credited to must be the same sign-in (qa-lead).
    const leader = await leaderActor();
    if (isFail(leader) || leader.personId == null || leader.personId !== actor.personId) return { ok: false, error: NOT_YOURS };
  }
  return { actor, ownerId: current.ownerPersonId, own, current };
}
const isRefused = (v: object): v is Fail => 'ok' in v;

export async function createMenuAction(raw: unknown): Promise<{ ok: true; id: string; dropped?: string[] } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (tooBig(raw)) return { ok: false, error: TOO_BIG };
  const { menu: cleaned, catalog, nameError } = await cleanMenu(raw, actor.personId);
  if (nameError) return { ok: false, error: nameError };
  const sb = createAdminClient();
  // A meal's gear is picked from the troop's list (Patrick, 2026-10-05): a name not on it is dropped, and said so.
  const { menu: listed, dropped } = await resolveMealGearWith(sb, await allowedOuting(cleaned, null));
  const id = await createMenuWith(sb, actor, listed, catalog);
  return id === MENU_LIMIT ? { ok: false, error: LIMIT_MESSAGE } : { ok: true, id, ...(dropped.length > 0 ? { dropped } : {}) };
}

export async function saveMenuAction(
  id: string,
  raw: unknown,
  expectedUpdatedAt: string
): Promise<{ ok: true; updatedAt: string; dropped?: string[] } | Fail> {
  const signedIn = await scoutActor();
  if (isFail(signedIn)) return signedIn;
  if (!isMenuId(id)) return { ok: false, error: NOT_YOURS };
  if (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return { ok: false, error: 'Reload this menu, then make your change again.' };
  }
  if (tooBig(raw)) return { ok: false, error: TOO_BIG };
  const who = await menuWriter(id);
  if (isRefused(who)) return who;
  const { actor, own, current } = who;
  const sb = createAdminClient();
  // Cleaned against the OWNER'S catalog either way: the menu keeps the owner's own recipes and typed-in
  // ingredients, and a leader cannot put one of their private recipes on a scout's menu.
  const { menu: cleaned, catalog, nameError } = await cleanMenu(raw, current.ownerPersonId);
  if (nameError) return { ok: false, error: nameError };
  // A meal's gear is picked from the troop's list (Patrick, 2026-10-05): a name not on it is dropped, and said so.
  const { menu, dropped } = await resolveMealGearWith(sb, await allowedOuting(cleaned, current.menu.calendarEntryId), current.menu);
  const res = await saveMenuWith(sb, actor, id, menu, expectedUpdatedAt, catalog, { asLeader: !own });
  if (res.status === 'saved') return { ok: true, updatedAt: res.updatedAt, ...(dropped.length > 0 ? { dropped } : {}) };
  if (res.status === 'conflict') {
    return { ok: false, error: 'This menu was changed since you opened it, in another window or by someone else. Reload to see the latest, then make your change again.' };
  }
  return { ok: false, error: NOT_YOURS };
}

/** A copy of the menu — the OWNER'S copy, whoever made it (a leader duplicating a scout's menu leaves the scout with two). */
export async function duplicateMenuAction(id: string): Promise<{ ok: true; id: string } | Fail> {
  const who = await menuWriter(id);
  if (isRefused(who)) return who;
  const copy = await duplicateMenuWith(createAdminClient(), who.actor, id, who.ownerId);
  if (copy === MENU_LIMIT) return { ok: false, error: who.own ? LIMIT_MESSAGE : `They already have ${MAX_MENUS_PER_SCOUT} menus. Delete one they don’t need to make room.` };
  return copy ? { ok: true, id: copy } : { ok: false, error: NOT_YOURS };
}

export async function deleteMenuAction(id: string): Promise<{ ok: true } | Fail> {
  const who = await menuWriter(id);
  if (isRefused(who)) return who;
  return (await deleteMenuWith(createAdminClient(), who.actor, id, who.ownerId)) ? { ok: true } : { ok: false, error: NOT_YOURS };
}

/**
 * "What you paid" (Phase 2 release B). Writes only the menu's `actuals`, never
 * `updated_at` (an open Plan tab keeps its version). Each line whose price paid
 * (or package) changed since the last saved actuals is reported to the troop
 * price book through mm_report_price: inside the band it applies, outside it
 * waits for a leader. Unchanged lines call nothing. The reporter is ALWAYS the
 * session scout; the menu always keeps what the scout paid, whatever the
 * outcome. Free-text items are not in this release.
 */
export async function saveActualsAction(
  menuId: string,
  rawActuals: unknown
): Promise<{ ok: true; applied: number; held: number; results: Record<string, PaidStatus> } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(menuId)) return { ok: false, error: NOT_YOURS };
  if (tooBig(rawActuals, MAX_ACTUALS_BYTES)) return { ok: false, error: TOO_BIG };
  const sb = createAdminClient();
  const current = await loadMenuWith(sb, menuId);
  if (!current || current.ownerPersonId !== actor.personId) return { ok: false, error: NOT_YOURS };

  const catalog = await loadMenuMonsterCatalog(actor.personId);
  const actuals = sanitizeActuals(rawActuals, catalog);
  const results: Record<string, PaidStatus> = {};
  let applied = 0;
  let held = 0;
  for (const [ingredientId, a] of Object.entries(actuals)) {
    const before = current.menu.actuals[ingredientId];
    if (before && before.pricePaid === a.pricePaid && before.packageId === a.packageId) continue;
    const outcome = await reportPriceWith(
      sb,
      { packageId: a.packageId, newPrice: a.pricePaid, reportedBy: actor.personId, menuId },
      (entry) => recordAuditAs(sb, actor, entry)
    );
    if (outcome === 'applied') applied++;
    else if (outcome === 'held') held++;
    if (outcome === 'applied' || outcome === 'held' || outcome === 'same') results[ingredientId] = outcome;
  }

  // An applied price moved the book: re-snapshot against the fresh catalog so the scout's own change is not "drift".
  const fresh = applied > 0 ? await loadMenuMonsterCatalog(actor.personId) : catalog;
  const saved = await saveActualsWith(sb, actor, menuId, actuals, fresh, { resnapshot: applied > 0 });
  if (saved.status !== 'saved') return { ok: false, error: NOT_YOURS };
  return { ok: true, applied, held, results };
}

/** Share with the troop (`on`) or Stop sharing — the session scout's own menu only (Phase 3). */
export async function shareMenuAction(id: string, on: boolean): Promise<{ ok: true } | Fail> {
  const who = await menuWriter(id);
  if (isRefused(who)) return who;
  return (await setMenuSharedWith(createAdminClient(), who.actor, id, on === true, who.ownerId)) ? { ok: true } : { ok: false, error: NOT_YOURS };
}

/**
 * Copy to My menus (Phase 3): another scout's shared menu (or one of their
 * own) becomes a new, unshared menu the session scout owns. Recipes they can't
 * see stay behind and are counted; the outing link follows the create rule.
 */
export async function copyMenuAction(id: string): Promise<{ ok: true; id: string; droppedRecipes: number } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: NOT_SHARED };
  const catalog = await loadMenuMonsterCatalog(actor.personId);
  const res = await copyMenuWith(createAdminClient(), actor, id, catalog, (m) => allowedOuting(m, m.calendarEntryId));
  if (res === MENU_LIMIT) return { ok: false, error: LIMIT_MESSAGE };
  if (!res) return { ok: false, error: NOT_SHARED };
  return { ok: true, id: res.id, droppedRecipes: res.droppedRecipes };
}

/** Any adult with admin access (Decision 2) — never a scout identity, even one holding a capability. */
async function leaderActor(): Promise<AuditActor | Fail> {
  const actor = await resolveAdminActor();
  if (!actor || actor.subjectKind === 'scout' || actor.capabilities.size === 0) {
    return { ok: false, error: 'Only leaders can do that.' };
  }
  return { personId: actor.personId, label: actor.label };
}

/** A leader's one review note on a menu, replacing the last; blank clears it (Phase 3). */
export async function setReviewNoteAction(id: string, note: string): Promise<{ ok: true } | Fail> {
  const actor = await leaderActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id) || typeof note !== 'string') return { ok: false, error: 'That note could not be saved.' };
  if (note.trim().length > MAX_REVIEW_NOTE) return { ok: false, error: `Keep the note under ${MAX_REVIEW_NOTE} characters.` };
  return (await setReviewNoteWith(createAdminClient(), actor, id, note)) ? { ok: true } : { ok: false, error: 'That menu is gone.' };
}

/** Hide from the shelf: a leader stops a menu being shared (Phase 3 take-down). */
export async function hideMenuAction(id: string): Promise<{ ok: true } | Fail> {
  const actor = await leaderActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: 'That menu is gone.' };
  return (await hideMenuWith(createAdminClient(), actor, id)) ? { ok: true } : { ok: false, error: 'That menu is not shared any more.' };
}

/**
 * Who a typed-in ingredient or package belongs to. Normally the person typing. When a leader types one while
 * working on a scout's menu (`onMenuId`, checked by menuWriter), it is filed under the MENU'S OWNER: a
 * typed-in is private to its owner until a leader keeps it, so one filed under the leader could not be used
 * on the scout's menu at all. The label stays the leader's, so the audit trail says who typed it.
 */
async function typedInOwner(onMenuId: string | undefined): Promise<AuditActor | Fail> {
  if (onMenuId === undefined) return scoutActor();
  const who = await menuWriter(onMenuId);
  if (isRefused(who)) return who;
  return who.own ? who.actor : { personId: who.ownerId, label: `${who.actor.label} (a leader, on their menu)` };
}

const TYPED_IN_ERRORS = {
  ingredient_cap: 'You have 10 new ingredients waiting for a leader to check them. Share a menu or recipe that uses one, or remove one you don’t need.',
  duplicate_ingredient: 'The troop’s price book already has that. Pick it from the search instead.',
  invalid: 'Check the name, the package size and the price, then try again.'
} as const;

/**
 * An ingredient the price book doesn't have, added from a menu meal (release
 * C): the same typed-in as a recipe's (4B) — a name, how it's measured, one
 * package (size in the recipe unit + price). Cleaned with the recipe editor's
 * rules, owned by the session scout; the meal then adds it like any other.
 */
export async function addMenuIngredientAction(raw: unknown, onMenuId?: string): Promise<{ ok: true; id: string } | Fail> {
  const actor = await typedInOwner(onMenuId);
  if (isFail(actor)) return actor;
  if (tooBig(raw, 4 * 1024)) return { ok: false, error: TYPED_IN_ERRORS.invalid };
  const catalog = await loadMenuMonsterCatalog(actor.personId);
  const [clean] = sanitizeNewIngredients([raw], catalog);
  if (!clean) return { ok: false, error: TYPED_IN_ERRORS.invalid };
  const res = await addMenuIngredientWith(createAdminClient(), actor, clean);
  return res.status === 'added' ? { ok: true, id: res.id } : { ok: false, error: TYPED_IN_ERRORS[res.status] };
}

const PACKAGE_ERRORS = {
  cap: 'You have packages waiting for a leader to check them. Wait for a leader before adding more.',
  invalid: 'Check the name, the size on the label and the price, then try again.'
} as const;

/**
 * A package the scout bought that the price book doesn't list (release C,
 * P2.3a): name, store, size in any unit the ingredient can be bridged to, and
 * price. Inside the band of the cheapest live package it goes live at once;
 * outside it waits for a leader and, meanwhile, prices only this scout's menus.
 */
export async function addScoutPackageAction(raw: unknown, onMenuId?: string): Promise<{ ok: true; status: 'live' | 'held' | 'same'; id: string } | Fail> {
  const actor = await typedInOwner(onMenuId);
  if (isFail(actor)) return actor;
  if (tooBig(raw, 2 * 1024)) return { ok: false, error: PACKAGE_ERRORS.invalid };
  const pkg = sanitizeScoutPackage(raw, await loadMenuMonsterCatalog(actor.personId));
  if (!pkg) return { ok: false, error: PACKAGE_ERRORS.invalid };
  const res = await addScoutPackageWith(createAdminClient(), actor, pkg);
  if (!('id' in res)) return { ok: false, error: PACKAGE_ERRORS[res.status] };
  return { ok: true, status: res.status, id: res.id };
}
