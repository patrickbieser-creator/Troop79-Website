'use server';

import { revalidatePath } from 'next/cache';
import { healthDeps, healthFamilyAccess } from '@/lib/health-access';
import { healthFilesConfigured } from '@/lib/health-files';
import { removeHealthPage, saveHealthDates, saveHealthPage } from '@/lib/health-store';

/**
 * A family's health-record writes (Plans/Health-Forms.md). Each action re-resolves who is signed in and who they
 * may act for; the posted person id is a request, checked against that list. One file per call: the phone has
 * already shrunk a photo under the request-size limit.
 */
export type HealthResult = { ok: true } | { ok: false; error: string };

const NOT_YOURS = 'Sign in as a parent to change health records.';
const OFF = 'Health form uploads aren’t switched on yet.';
const FAILED = 'Couldn’t save that. Try again in a minute.';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function uploadHealthPageAction(formData: FormData): Promise<HealthResult> {
  const access = await healthFamilyAccess();
  if (!access) return { ok: false, error: NOT_YOURS };
  if (!healthFilesConfigured()) return { ok: false, error: OFF };
  const personId = Number(formData.get('personId'));
  if (!access.personIds.includes(personId)) return { ok: false, error: NOT_YOURS };
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose a photo or a PDF first.' };
  try {
    const res = await saveHealthPage(
      {
        personId,
        kind: String(formData.get('kind') ?? ''),
        page: Number(formData.get('page')),
        bytes: new Uint8Array(await file.arrayBuffer()),
        parentSigned: text(formData.get('parentSigned')),
        doctorSigned: text(formData.get('doctorSigned'))
      },
      access.viewer,
      healthDeps()
    );
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] upload failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/member/health-forms');
  revalidatePath('/member');
  return { ok: true };
}

export async function saveHealthDatesAction(input: { personId: number; kind: string; parentSigned: string | null; doctorSigned: string | null }): Promise<HealthResult> {
  const access = await healthFamilyAccess();
  // Rebuilt from primitives: nothing posted reaches the store unchecked.
  const personId = typeof input?.personId === 'number' ? input.personId : NaN;
  if (!access || !access.personIds.includes(personId)) return { ok: false, error: NOT_YOURS };
  const date = (v: unknown) => (typeof v === 'string' && v ? v : null);
  try {
    const res = await saveHealthDates({ personId, kind: String(input.kind), parentSigned: date(input.parentSigned), doctorSigned: date(input.doctorSigned) }, healthDeps());
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] saving dates failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/member/health-forms');
  revalidatePath('/member');
  return { ok: true };
}

export async function removeHealthPageAction(id: string): Promise<HealthResult> {
  const access = await healthFamilyAccess();
  if (!access) return { ok: false, error: NOT_YOURS };
  try {
    const res = await removeHealthPage(String(id), access.personIds, access.viewer, healthDeps());
    if (!res.ok) return res;
  } catch (e) {
    console.error('[health] remove failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/member/health-forms');
  revalidatePath('/member');
  return { ok: true };
}
