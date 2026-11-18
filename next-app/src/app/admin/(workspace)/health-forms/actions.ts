'use server';

/**
 * Admin Health Forms server actions (Plans/Admin-Health-Forms.md). Every action re-checks the health viewers list on
 * the request; nothing is trusted from the page.
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { healthAdminAccess, healthDeps } from '@/lib/health-access';
import {
  grantHealthViewer,
  loadHealthRecordView,
  logHealthReminder,
  openHealthRecord,
  removeHealthPage,
  revokeHealthViewer,
  saveHealthGoodUntil,
  saveHealthNote,
  saveHealthPage,
  setHealthReviewed,
  setImmunizationInBsaForm,
  type HealthRecordView,
  type HealthViewer
} from '@/lib/health-store';
import { healthFilesConfigured } from '@/lib/health-files';
import { HEALTH_MAX_BYTES } from '@/lib/health-records';
import { remindPeople } from '@/lib/health-reminders';
import { sendEmail } from '@/lib/email';
import { siteUrl } from '@/lib/site-url';
import { centralToday } from '@/lib/dates';

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

/* ── Writes in the record sheet (Plans/Completed/Admin-Health-Record-Sheet-Redesign.md) ─────────────────────────────────── */

/** Every sheet write answers with the record as it now is, read without another "opened" line. Each write leaves its
 *  own access-log line first (upload, replace, delete, review, unreview, edit, remind), naming who did it, so nothing
 *  about a person comes back unlogged (qa-lead, 2026-11-16). */
export type SheetResult = { ok: true; record: HealthRecordView } | { ok: false; error: string };

async function namedViewer(): Promise<HealthViewer | null> {
  const access = await healthAdminAccess();
  return access?.named ? { personId: access.me.personId, name: access.me.name, via: 'named' } : null;
}

async function sheetAfter(personId: number): Promise<SheetResult> {
  revalidatePath('/admin/health-forms');
  const record = await loadHealthRecordView(createAdminClient(), personId);
  return record ? { ok: true, record } : { ok: false, error: 'That record couldn’t be found.' };
}

async function sheetWrite(personId: unknown, work: (id: number, viewer: HealthViewer) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<SheetResult> {
  const viewer = await namedViewer();
  const id = typeof personId === 'number' ? idOf(personId) : null;
  if (!viewer || id == null) return { ok: false, error: NOT_NAMED };
  try {
    const res = await work(id, viewer);
    if (!res.ok) return res;
    return await sheetAfter(id);
  } catch (e) {
    console.error('[health] sheet write failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: FAILED };
  }
}

/** Upload for family: one page into one slot, logged as the named leader. */
export async function uploadHealthPageAdminAction(formData: FormData): Promise<SheetResult> {
  if (!healthFilesConfigured()) return { ok: false, error: 'Health form uploads aren’t switched on yet.' };
  const file = formData.get('file');
  const goodUntil = formData.get('goodUntil');
  return sheetWrite(Number(formData.get('personId')), async (personId, viewer) => {
    if (!(file instanceof File)) return { ok: false, error: 'Choose a photo or a PDF first.' };
    // Refused before the file is read into memory; the store checks the bytes again.
    if (file.size > HEALTH_MAX_BYTES) return { ok: false, error: 'That file is too big. Photograph each page instead of sending one large PDF.' };
    return saveHealthPage(
      {
        personId,
        kind: String(formData.get('kind') ?? ''),
        page: Number(formData.get('page')),
        bytes: new Uint8Array(await file.arrayBuffer()),
        goodUntil: typeof goodUntil === 'string' && goodUntil ? goodUntil : null
      },
      viewer,
      healthDeps()
    );
  });
}

export async function saveHealthGoodUntilAdminAction(input: { personId: number; kind: string; goodUntil: string | null }): Promise<SheetResult> {
  const goodUntil = typeof input?.goodUntil === 'string' && input.goodUntil ? input.goodUntil : null;
  return sheetWrite(input?.personId, (personId, viewer) => saveHealthGoodUntil({ personId, kind: String(input.kind), goodUntil }, viewer, healthDeps()));
}

/** Removes one page; the store refuses a page that isn't this person's. */
export async function removeHealthPageAdminAction(pageId: string, personId: number): Promise<SheetResult> {
  return sheetWrite(personId, (id, viewer) => removeHealthPage(String(pageId), [id], viewer, healthDeps()));
}

/** Mark reviewed / Undo review: both written to the access log, so the family sees them. */
export async function setHealthReviewedAdminAction(personId: number, on: boolean): Promise<SheetResult> {
  return sheetWrite(personId, async (id, viewer) => {
    await setHealthReviewed(healthDeps(), id, on === true, viewer);
    return { ok: true };
  });
}

/** "The immunizations are on the BSA form" on or off. */
export async function setImmunizationInBsaFormAdminAction(personId: number, on: boolean): Promise<SheetResult> {
  return sheetWrite(personId, async (id, viewer) => {
    await setImmunizationInBsaForm(healthDeps(), id, on === true, viewer);
    return { ok: true };
  });
}

/** The family note, typed or pasted in by a leader (notes families send by email). Blank clears it. */
export async function saveHealthNoteAdminAction(personId: number, text: string): Promise<SheetResult> {
  return sheetWrite(personId, (id, viewer) => saveHealthNote(id, typeof text === 'string' ? text : '', viewer, healthDeps()));
}

/** Email reminder: this one person's family, about what this person needs today. Recorded for the card. */
export async function sendHealthReminderAdminAction(personId: number): Promise<SheetResult> {
  return sheetWrite(personId, async (id, viewer) => {
    const supabase = createAdminClient();
    await logHealthReminder(id, viewer, healthDeps());
    const outcome = await remindPeople([id], true, { supabase, send: sendEmail, siteUrl: siteUrl(), today: centralToday(), sentBy: viewer });
    if (outcome.noEmail.length > 0) return { ok: false, error: 'There’s no email on file for this family. Call them instead.' };
    if (outcome.families === 0) return { ok: false, error: 'Nothing is missing or run out, so there’s nothing to remind them about.' };
    if (outcome.failed > 0) return { ok: false, error: 'The email didn’t go. Try again in a minute.' };
    return { ok: true };
  });
}
