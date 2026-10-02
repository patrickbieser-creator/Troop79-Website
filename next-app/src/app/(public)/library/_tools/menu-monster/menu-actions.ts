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
import { MAX_MENU_BYTES, MAX_MENUS_PER_SCOUT, isMenuId, menuNameError, sanitizeMenu, type Menu } from '@/lib/menu-monster/menus';
import { MENU_LIMIT, createMenuWith, deleteMenuWith, duplicateMenuWith, loadMenuWith, saveMenuWith } from '@/lib/menu-monster/menus-store';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { centralToday } from '@/lib/dates';
import type { AuditActor } from '@/lib/audit';

type Fail = { ok: false; error: string };

async function scoutActor(): Promise<AuditActor | Fail> {
  try {
    const s = await requireVerifiedScoutIdentity();
    return { personId: s.personId, label: s.displayName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Scouts: sign in to save your menu.' };
  }
}

const isFail = (v: AuditActor | Fail): v is Fail => 'ok' in v;

const NOT_YOURS = 'That menu isn’t one of yours.';
const LIMIT_MESSAGE = `You have ${MAX_MENUS_PER_SCOUT} menus — delete one you don’t need to make room.`;
const TOO_BIG = 'This menu is too big to save. Remove some meals or edits and try again.';

/** True when the payload serializes past MAX_MENU_BYTES (or can't serialize at all). */
function tooBig(raw: unknown): boolean {
  try {
    return (JSON.stringify(raw) ?? '').length > MAX_MENU_BYTES;
  } catch {
    return true;
  }
}

/** Clean the payload and check the name; the error is what the name field shows. */
async function cleanMenu(raw: unknown) {
  const catalog = await loadMenuMonsterCatalog();
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

export async function createMenuAction(raw: unknown): Promise<{ ok: true; id: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (tooBig(raw)) return { ok: false, error: TOO_BIG };
  const { menu: cleaned, catalog, nameError } = await cleanMenu(raw);
  if (nameError) return { ok: false, error: nameError };
  const menu = await allowedOuting(cleaned, null);
  const id = await createMenuWith(createAdminClient(), actor, menu, catalog);
  return id === MENU_LIMIT ? { ok: false, error: LIMIT_MESSAGE } : { ok: true, id };
}

export async function saveMenuAction(
  id: string,
  raw: unknown,
  expectedUpdatedAt: string
): Promise<{ ok: true; updatedAt: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: NOT_YOURS };
  if (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return { ok: false, error: 'Reload this menu, then make your change again.' };
  }
  if (tooBig(raw)) return { ok: false, error: TOO_BIG };
  const { menu: cleaned, catalog, nameError } = await cleanMenu(raw);
  if (nameError) return { ok: false, error: nameError };
  const sb = createAdminClient();
  const current = await loadMenuWith(sb, id);
  const owned = current && current.ownerPersonId === actor.personId ? current : null;
  const menu = await allowedOuting(cleaned, owned?.menu.calendarEntryId ?? null);
  const res = await saveMenuWith(sb, actor, id, menu, expectedUpdatedAt, catalog);
  if (res.status === 'saved') return { ok: true, updatedAt: res.updatedAt };
  if (res.status === 'conflict') {
    return { ok: false, error: 'This menu was changed in another window since you opened it. Reload to see the latest, then make your change again.' };
  }
  return { ok: false, error: NOT_YOURS };
}

export async function duplicateMenuAction(id: string): Promise<{ ok: true; id: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: NOT_YOURS };
  const copy = await duplicateMenuWith(createAdminClient(), actor, id);
  if (copy === MENU_LIMIT) return { ok: false, error: LIMIT_MESSAGE };
  return copy ? { ok: true, id: copy } : { ok: false, error: NOT_YOURS };
}

export async function deleteMenuAction(id: string): Promise<{ ok: true } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: NOT_YOURS };
  return (await deleteMenuWith(createAdminClient(), actor, id)) ? { ok: true } : { ok: false, error: NOT_YOURS };
}
