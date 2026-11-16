'use server';

/**
 * Admin Health Forms server actions (Plans/Admin-Health-Forms.md). Every action re-checks the health viewers list on
 * the request; nothing is trusted from the page.
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { healthAdminAccess, healthDeps } from '@/lib/health-access';
import { grantHealthViewer, openHealthRecord, revokeHealthViewer, type HealthRecordView } from '@/lib/health-store';

export type OpenRecordResult = { ok: true; record: HealthRecordView } | { ok: false; error: string };

/** Opens one person's record for the sheet: logs first, shows nothing if the log can't be written. */
export async function openHealthRecordAction(personId: number): Promise<OpenRecordResult> {
  const access = await healthAdminAccess();
  if (!access?.named) return { ok: false, error: 'Only leaders on the health records list can open these.' };
  if (!Number.isInteger(personId) || personId <= 0) return { ok: false, error: 'That record couldn’t be found.' };
  const record = await openHealthRecord(personId, { personId: access.me.personId, name: access.me.name, via: 'named' }, healthDeps());
  if (!record) return { ok: false, error: 'Couldn’t open these records. Nothing was shown. Try again.' };
  return { ok: true, record };
}

export type HealthAdminResult = { ok: true } | { ok: false; error: string };

const NOT_NAMED = 'Only leaders on the health records list can do that.';
const FAILED = 'That didn’t save. Try again.';
const idOf = (v: number) => (Number.isInteger(v) && v > 0 ? v : null);

/** Adds an adult to "Who can open health records". The store refuses scouts and Webelos. */
export async function grantHealthViewerAdminAction(personId: number): Promise<HealthAdminResult> {
  const access = await healthAdminAccess();
  const id = idOf(personId);
  if (!access?.named || id == null) return { ok: false, error: NOT_NAMED };
  try {
    const res = await grantHealthViewer(createAdminClient(), id, access.me.personId);
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] grant failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/admin', 'layout');
  return { ok: true };
}

/** Takes someone off the list. The store refuses to leave it empty. */
export async function revokeHealthViewerAdminAction(personId: number): Promise<HealthAdminResult> {
  const access = await healthAdminAccess();
  const id = idOf(personId);
  if (!access?.named || id == null) return { ok: false, error: NOT_NAMED };
  try {
    const res = await revokeHealthViewer(createAdminClient(), id);
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] revoke failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/admin', 'layout');
  return { ok: true };
}
