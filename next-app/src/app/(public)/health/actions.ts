'use server';

import { revalidatePath } from 'next/cache';
import { healthAccess } from '@/lib/health-access';
import { createAdminClient } from '@/lib/supabase/server';
import { grantHealthViewer, revokeHealthViewer, setHealthReviewed } from '@/lib/health-store';

/**
 * The leader side's writes (Plans/Health-Forms.md, release 2). All three belong to the NAMED list only: an adult
 * who is merely on a trip can open records but cannot mark them reviewed or change who else can.
 */
export type HealthLeaderResult = { ok: true } | { ok: false; error: string };

const NOT_NAMED = 'Only the leaders who look after health records can do that.';
const FAILED = 'Couldn’t save that. Try again in a minute.';

async function named() {
  const access = await healthAccess();
  return access?.named ? access : null;
}

const idOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

export async function setHealthReviewedAction(personId: number, on: boolean): Promise<HealthLeaderResult> {
  const access = await named();
  const id = idOf(personId);
  if (!access || id == null) return { ok: false, error: NOT_NAMED };
  try {
    await setHealthReviewed(createAdminClient(), id, on === true, access.me);
  } catch (e) {
    console.error('[health] review failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/health', 'layout');
  return { ok: true };
}

export async function grantHealthViewerAction(personId: number): Promise<HealthLeaderResult> {
  const access = await named();
  const id = idOf(personId);
  if (!access || id == null) return { ok: false, error: NOT_NAMED };
  try {
    const res = await grantHealthViewer(createAdminClient(), id, access.me.personId);
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] grant failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/health', 'layout');
  return { ok: true };
}

export async function revokeHealthViewerAction(personId: number): Promise<HealthLeaderResult> {
  const access = await named();
  const id = idOf(personId);
  if (!access || id == null) return { ok: false, error: NOT_NAMED };
  try {
    const res = await revokeHealthViewer(createAdminClient(), id);
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] revoke failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/health', 'layout');
  return { ok: true };
}
