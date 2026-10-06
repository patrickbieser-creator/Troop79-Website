'use server';

/**
 * The Gear tab's writes (Plans/Menu-Monster-Brands-Gear.md, release 2). Both save at once and neither touches
 * the menu's version, so a Plan tab open elsewhere never goes stale because someone packed a skillet.
 *
 *   setGearPackedAction   a Packed tick, by anyone who may record on the menu: the owner, any signed-in scout
 *                         on an outing's menu, a leader (scout-menus.tsx menuRecorder).
 *   setGearExtrasAction   the menu's own extra gear, replaced whole — the owner only. Gear is picked from the
 *                         troop's list: a name not on it is dropped and reported in `dropped` (Patrick, 2026-10-05).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { MAX_GEAR_COUNT, gearKey } from '@/lib/menu-monster/gear';
import { canEditPlan } from '@/lib/menu-monster/menu-access';
import { setGearExtrasWith, setGearPackedWith } from '@/lib/menu-monster/gear-store';
import { menuRecorder } from '../../menu-monster/menus/_components/scout-menus';

type Fail = { ok: false; error: string };
const NOT_ALLOWED = 'Sign in as a scout on this outing to tick gear off.';

export async function setGearPackedAction(menuId: unknown, key: unknown, count: unknown, packed: unknown): Promise<{ ok: true } | Fail> {
  if (typeof menuId !== 'string' || typeof key !== 'string' || !gearKey(key) || key.length > 60) return { ok: false, error: NOT_ALLOWED };
  const who = await menuRecorder(menuId);
  if (!who) return { ok: false, error: NOT_ALLOWED };
  const n = Math.min(MAX_GEAR_COUNT, Math.max(1, Math.round(Number(count)) || 1));
  const done = await setGearPackedWith(createAdminClient(), menuId, { key, count: n, packed: packed === true }, { personId: who.personId, label: who.name });
  return done ? { ok: true } : { ok: false, error: 'That menu is gone.' };
}

export async function setGearExtrasAction(menuId: unknown, extras: unknown): Promise<{ ok: true; extras: string[]; dropped: string[] } | Fail> {
  if (typeof menuId !== 'string' || !Array.isArray(extras) || extras.length > 60) return { ok: false, error: 'That didn’t save. Try again.' };
  const who = await menuRecorder(menuId);
  // The owner, or a leader fixing the menu (menu-access.ts canEditPlan); the crew only ticks.
  if (!who || !canEditPlan(who.access) || who.personId == null) return { ok: false, error: 'Only the person who planned this menu, or a leader, can change its gear.' };
  const saved = await setGearExtrasWith(createAdminClient(), menuId, who.stored.ownerPersonId, extras);
  return saved ? { ok: true, extras: saved.extras, dropped: saved.dropped } : { ok: false, error: 'That menu is gone.' };
}
