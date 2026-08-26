'use server';

/**
 * The email template library (Plans/Signup-Confirmation-Email.md) — Lookups &
 * Admin → Email templates. `kind` is validated against the registry in
 * lib/email-templates.ts, never a DB enum. A template in use by a signup is
 * retired, not deleted, so the signup keeps working.
 */

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { isTemplateKind } from '@/lib/email-templates';

type Result = { ok: boolean; error?: string; id?: number };

export interface EmailTemplateRow {
  id: number;
  name: string;
  kind: string;
  subject: string;
  body: string;
  retired_at: string | null;
}

function fields(fd: FormData) {
  return {
    name: String(fd.get('name') ?? '').trim(),
    kind: String(fd.get('kind') ?? '').trim(),
    subject: String(fd.get('subject') ?? '').trim(),
    body: String(fd.get('body') ?? '').trim()
  };
}

function validate(f: ReturnType<typeof fields>): string | null {
  if (!f.name) return 'Give the template a name.';
  if (!isTemplateKind(f.kind)) return 'Pick a kind.';
  if (!f.subject) return 'A subject is required.';
  if (!f.body) return 'The message is empty.';
  return null;
}

function revalidate() {
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/admin/calendar', 'layout');
}

export async function createEmailTemplate(fd: FormData): Promise<Result> {
  await requireCapability('calendar.write');
  const f = fields(fd);
  const problem = validate(f);
  if (problem) return { ok: false, error: problem };
  const { data, error } = await createAdminClient().from('email_templates').insert(f).select('id').single();
  if (error) return { ok: false, error: error.message.includes('duplicate') ? 'A template with that name already exists.' : error.message };
  revalidate();
  return { ok: true, id: data.id as number };
}

export async function updateEmailTemplate(fd: FormData): Promise<Result> {
  await requireCapability('calendar.write');
  const id = Number(fd.get('id'));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Missing template.' };
  const f = fields(fd);
  const problem = validate(f);
  if (problem) return { ok: false, error: problem };
  const { error } = await createAdminClient()
    .from('email_templates')
    .update({ ...f, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message.includes('duplicate') ? 'A template with that name already exists.' : error.message };
  revalidate();
  return { ok: true, id };
}

/** Retire = hide from pickers, keep the row (Patrick, 2026-08-26). The first
 *  cut deleted an unreferenced template outright, which could lose a leader's
 *  writing under a button that said "Retire"; Restore undoes this. */
export async function retireEmailTemplate(fd: FormData): Promise<Result> {
  await requireCapability('calendar.write');
  const id = Number(fd.get('id'));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Missing template.' };
  const { error } = await createAdminClient()
    .from('email_templates')
    .update({ retired_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id };
}

export async function restoreEmailTemplate(fd: FormData): Promise<Result> {
  await requireCapability('calendar.write');
  const id = Number(fd.get('id'));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Missing template.' };
  const { error } = await createAdminClient().from('email_templates').update({ retired_at: null }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id };
}

export async function loadEmailTemplates(): Promise<EmailTemplateRow[]> {
  const { data } = await createAdminClient().from('email_templates').select('id, name, kind, subject, body, retired_at').order('kind').order('name');
  return (data ?? []) as EmailTemplateRow[];
}
