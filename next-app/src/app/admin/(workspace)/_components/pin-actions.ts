'use server';

/**
 * Pin, unpin and reorder (Plans/Completed/Admin-Portal-Nav.md phase 3). Each action resolves the actor on the request and acts
 * on THEIR pins only: no person id is ever taken from the page.
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { actorCanEnterAdmin, resolveAdminActor } from '@/lib/admin-actor';
import { addPin, removePin, savePins, type PinResult } from './pins-store';
import { visibleFeaturesFor } from './nav-visibility';

const FAILED = 'That didn’t save. Try again.';
const NOT_YOURS = 'You can only pin items you can open.';

interface Me {
  personId: number;
  /** Keys this person may pin: what they can open, less Home (the rail's first entry already). */
  pinnable: ReadonlySet<string>;
}

async function me(): Promise<Me | null> {
  const actor = await resolveAdminActor();
  if (!actor || !actorCanEnterAdmin(actor) || actor.personId == null) return null;
  const visible = await visibleFeaturesFor(actor);
  return { personId: actor.personId, pinnable: new Set(visible.filter((f) => f.key !== 'home').map((f) => f.key)) };
}

async function run(fn: (me: Me) => Promise<PinResult>): Promise<PinResult> {
  let who: Me | null;
  try {
    who = await me();
  } catch (e) {
    console.error('[pins]', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  if (who == null) return { ok: false, error: 'Pins need a personal sign-in.' };
  try {
    const res = await fn(who);
    if (res.ok) revalidatePath('/admin', 'layout');
    return res;
  } catch (e) {
    console.error('[pins]', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
}

export async function pinFeatureAction(key: string): Promise<PinResult> {
  if (typeof key !== 'string') return { ok: false, error: FAILED };
  return run(async ({ personId, pinnable }) => (pinnable.has(key) ? addPin(createAdminClient(), personId, key) : { ok: false, error: NOT_YOURS }));
}

export async function unpinFeatureAction(key: string): Promise<PinResult> {
  if (typeof key !== 'string') return { ok: false, error: FAILED };
  // Unpinning is always allowed: it is how a pin the person can no longer open gets cleared.
  return run(({ personId }) => removePin(createAdminClient(), personId, key));
}

/** Edit pins' Save: the whole list, in order. */
export async function savePinsAction(keys: string[]): Promise<PinResult> {
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) return { ok: false, error: FAILED };
  return run(async ({ personId, pinnable }) =>
    keys.every((k) => pinnable.has(k)) ? savePins(createAdminClient(), personId, keys) : { ok: false, error: NOT_YOURS }
  );
}
