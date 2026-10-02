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
import { menuNameError, sanitizeMenu } from '@/lib/menu-monster/menus';
import { createMenuWith, deleteMenuWith, duplicateMenuWith, saveMenuWith } from '@/lib/menu-monster/menus-store';
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

/** Clean the payload and check the name; the error is what the name field shows. */
async function cleanMenu(raw: unknown) {
  const catalog = await loadMenuMonsterCatalog();
  const menu = sanitizeMenu(raw, catalog);
  return { menu, catalog, nameError: menuNameError(menu.name) };
}

export async function createMenuAction(raw: unknown): Promise<{ ok: true; id: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  const { menu, catalog, nameError } = await cleanMenu(raw);
  if (nameError) return { ok: false, error: nameError };
  return { ok: true, id: await createMenuWith(createAdminClient(), actor, menu, catalog) };
}

export async function saveMenuAction(
  id: string,
  raw: unknown,
  expectedUpdatedAt: string
): Promise<{ ok: true; updatedAt: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  const { menu, catalog, nameError } = await cleanMenu(raw);
  if (nameError) return { ok: false, error: nameError };
  const res = await saveMenuWith(createAdminClient(), actor, id, menu, expectedUpdatedAt, catalog);
  if (res.status === 'saved') return { ok: true, updatedAt: res.updatedAt };
  if (res.status === 'conflict') {
    return { ok: false, error: 'This menu was changed in another window since you opened it. Reload to see the latest, then make your change again.' };
  }
  return { ok: false, error: 'That menu isn’t one of yours.' };
}

export async function duplicateMenuAction(id: string): Promise<{ ok: true; id: string } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  const copy = await duplicateMenuWith(createAdminClient(), actor, id);
  return copy ? { ok: true, id: copy } : { ok: false, error: 'That menu isn’t one of yours.' };
}

export async function deleteMenuAction(id: string): Promise<{ ok: true } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  return (await deleteMenuWith(createAdminClient(), actor, id)) ? { ok: true } : { ok: false, error: 'That menu isn’t one of yours.' };
}
