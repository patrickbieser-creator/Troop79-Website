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
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { MAX_ACTUALS_BYTES, MAX_MENU_BYTES, MAX_MENUS_PER_SCOUT, isMenuId, menuNameError, sanitizeActuals, sanitizeMenu, type Menu, type PaidStatus } from '@/lib/menu-monster/menus';
import { MAX_REVIEW_NOTE, MENU_LIMIT, addMenuIngredientWith, copyMenuWith, createMenuWith, deleteMenuWith, duplicateMenuWith, hideMenuWith, loadMenuWith, saveActualsWith, saveMenuWith, setMenuSharedWith, setReviewNoteWith } from '@/lib/menu-monster/menus-store';
import { resolveMealGearWith } from '@/lib/menu-monster/gear-store';
import { sanitizeNewIngredients } from '@/lib/menu-monster/scout-ingredients';
import { MAX_SCOUT_RECIPES } from '@/lib/menu-monster/scout-recipes';
import { listMyRecipesWith, saveScoutRecipeWith } from '@/lib/menu-monster/scout-recipes-store';
import { sanitizeSingleFood, singleFoodDraft } from '@/lib/menu-monster/single-food';
import { sanitizeScoutPackage } from '@/lib/menu-monster/scout-packages';
import { addScoutPackageWith } from '@/lib/menu-monster/scout-packages-store';
import { reportPriceWith } from '@/lib/menu-monster/price-history';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { centralToday } from '@/lib/dates';
import { recordAuditAs } from '@/lib/audit';

import { NOT_YOURS, isFail, isRefused, leaderActor, menuWriter, scoutActor, typedInOwner, type Fail } from './typed-in-owner';

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

const SCOUT_RECIPE_CAP = `You already have ${MAX_SCOUT_RECIPES} recipes of your own. Delete one you don’t need to make room for a new food.`;

/**
 * A food the price book doesn't have, added straight onto a meal (Patrick, 2026-10-06: "Scouts need the
 * ability to add items right at this point, without too much friction"). Only the name and its Kind of
 * food (the store section) are required; the package is optional, so an unpriced food is saved and
 * shows "No price yet" until someone prices it. Two writes under the owner (typedInOwner): the
 * typed-in ingredient (addMenuIngredientWith — private, a leader checks it later from Needs attention)
 * and the owner's unshared one-line recipe that puts it on a menu. `existingIngredientId` skips the
 * first for a food the book already has. The caller adds `recipeId` to the meal.
 */
export async function addFoodToMealAction(
  raw: unknown,
  onMenuId?: string
): Promise<{ ok: true; ingredientId: string; recipeId: string; name: string } | (Fail & { existingIngredientId?: string })> {
  const actor = await typedInOwner(onMenuId);
  if (isFail(actor)) return actor;
  if (tooBig(raw, 4 * 1024)) return { ok: false, error: TYPED_IN_ERRORS.invalid };
  const sb = createAdminClient();
  const catalog = await loadMenuMonsterCatalog(actor.personId);
  const clean = sanitizeSingleFood(raw, catalog);
  if (!clean.ok) return clean;
  const { food } = clean;
  // Refuse a full recipe shelf BEFORE the typed-in is written, so a refusal leaves nothing behind.
  if (actor.personId == null) return { ok: false, error: 'Sign in to add a food.' };
  const mine = await listMyRecipesWith(sb, actor.personId);
  if (mine.filter((r) => r.status !== 'retired').length >= MAX_SCOUT_RECIPES) return { ok: false, error: SCOUT_RECIPE_CAP };

  let ingredientId = food.existingIngredientId;
  let name = catalog.ingredients.find((i) => i.id === ingredientId)?.name ?? '';
  if (food.ingredient) {
    const added = await addMenuIngredientWith(sb, actor, food.ingredient);
    if (added.status !== 'added') return { ok: false, error: TYPED_IN_ERRORS[added.status] };
    ingredientId = added.id;
    name = food.ingredient.name;
  }
  if (!ingredientId) return { ok: false, error: TYPED_IN_ERRORS.invalid };
  const saved = await saveScoutRecipeWith(sb, actor, singleFoodDraft(name, food.mealSlot, ingredientId, food.eachPerson, food.unit), null);
  if (saved.status !== 'saved') return { ok: false, error: saved.status === 'cap' ? SCOUT_RECIPE_CAP : TYPED_IN_ERRORS.invalid };
  return { ok: true, ingredientId, recipeId: saved.id, name };
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
  const sb = createAdminClient();
  // A typed-in food may be priced by the person who typed it (the owner; a helping leader acts as the owner).
  // The ingredient's author comes from the row, never the payload; anyone else's typed-in stays refused.
  const ingId = typeof (raw as { ingredientId?: unknown } | null)?.ingredientId === 'string' ? (raw as { ingredientId: string }).ingredientId : '';
  let ownTypedIn = false;
  if (ingId.startsWith('x-')) {
    const { data } = await sb.from('mm_ingredients').select('added_by_person_id').eq('id', ingId).maybeSingle();
    ownTypedIn = data?.added_by_person_id != null && data.added_by_person_id === actor.personId;
  }
  const pkg = sanitizeScoutPackage(raw, await loadMenuMonsterCatalog(actor.personId), ownTypedIn);
  if (!pkg) return { ok: false, error: PACKAGE_ERRORS.invalid };
  const res = await addScoutPackageWith(sb, actor, pkg);
  if (!('id' in res)) return { ok: false, error: PACKAGE_ERRORS[res.status] };
  return { ok: true, status: res.status, id: res.id };
}
