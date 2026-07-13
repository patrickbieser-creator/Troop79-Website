'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import type { CalendarCategory } from '@/lib/supabase/types';

type ActionResult = { ok: boolean; error?: string };

function revalidateCalendar() {
  revalidatePath('/admin/news/calendar');
  revalidatePath('/events');
  revalidatePath('/calendar.ics');
}

function fieldsFromForm(fd: FormData) {
  const entryDate = String(fd.get('entry_date') ?? '').trim();
  const endDate = String(fd.get('end_date') ?? '').trim();
  const dayNote = String(fd.get('day_note') ?? '').trim();
  const category = String(fd.get('category') ?? '').trim() as CalendarCategory;
  const title = String(fd.get('title') ?? '').trim();
  const description = String(fd.get('description') ?? '').trim();
  const location = String(fd.get('location') ?? '').trim();
  const startTime = String(fd.get('start_time') ?? '').trim();
  const endTime = String(fd.get('end_time') ?? '').trim();
  const articleIdRaw = String(fd.get('article_id') ?? '').trim();

  return {
    entry_date: entryDate,
    end_date: endDate || null,
    day_note: dayNote || null,
    category,
    title,
    description: description || null,
    location: location || null,
    start_time: startTime || null,
    end_time: endTime || null,
    article_id: articleIdRaw ? Number(articleIdRaw) : null
  };
}

export async function createCalendarEntry(fd: FormData): Promise<ActionResult> {
  await requireRole(['leader', 'scout']);
  const fields = fieldsFromForm(fd);
  if (!fields.entry_date) return { ok: false, error: 'Date is required.' };
  if (!fields.category) return { ok: false, error: 'Category is required.' };
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('calendar_entries').insert(fields);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}

export async function updateCalendarEntry(fd: FormData): Promise<ActionResult> {
  await requireRole(['leader', 'scout']);
  const id = Number(fd.get('id'));
  const fields = fieldsFromForm(fd);
  if (!fields.entry_date) return { ok: false, error: 'Date is required.' };
  if (!fields.category) return { ok: false, error: 'Category is required.' };
  if (!fields.title) return { ok: false, error: 'Title is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('calendar_entries').update(fields).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}

// ── CSV import ──────────────────────────────────────────────────────────────

const IMPORT_CATEGORIES = [
  'Troop Meeting', 'No Meeting', 'Campout', 'High Adventure', 'Summer Camp',
  'Service Project', 'Outing', 'Fundraiser', 'Court of Honor', 'Committee Meeting', 'Ceremony'
];

/** The fields the Bugle sheet carries. day_note and article_id are NOT here
 *  on purpose — the sheet doesn't know about them, so imports never clobber
 *  them on update. */
export interface ImportRowFields {
  entry_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  category: string;
  title: string;
  description: string | null;
  location: string | null;
}

export interface ImportUpdate {
  id: number;
  fields: ImportRowFields;
}

export type ImportResult = { ok: boolean; error?: string; inserted: number; updated: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function validateImportRow(f: ImportRowFields): string | null {
  if (!DATE_RE.test(f.entry_date)) return `bad date "${f.entry_date}"`;
  if (f.end_date && !DATE_RE.test(f.end_date)) return `bad end date "${f.end_date}"`;
  if (f.start_time && !TIME_RE.test(f.start_time)) return `bad start time "${f.start_time}"`;
  if (f.end_time && !TIME_RE.test(f.end_time)) return `bad end time "${f.end_time}"`;
  if (!IMPORT_CATEGORIES.includes(f.category)) return `unknown category "${f.category}"`;
  if (!f.title.trim()) return 'missing title';
  return null;
}

/** Applies a reviewed CSV import: batch insert + per-row updates. The review
 *  UI (calendar-import.tsx) built the plan; this just validates and writes. */
export async function importCalendarEntries(
  inserts: ImportRowFields[],
  updates: ImportUpdate[]
): Promise<ImportResult> {
  await requireRole(['leader']);

  for (const f of [...inserts, ...updates.map((u) => u.fields)]) {
    const problem = validateImportRow(f);
    if (problem) return { ok: false, error: `Rejected: ${problem}.`, inserted: 0, updated: 0 };
  }

  const supabase = createAdminClient();
  if (inserts.length > 0) {
    const { error } = await supabase.from('calendar_entries').insert(inserts);
    if (error) return { ok: false, error: error.message, inserted: 0, updated: 0 };
  }
  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('calendar_entries')
      .update({ ...u.fields, updated_at: new Date().toISOString() })
      .eq('id', u.id);
    if (error) {
      return { ok: false, error: `Update #${u.id}: ${error.message}`, inserted: inserts.length, updated };
    }
    updated++;
  }

  revalidateCalendar();
  return { ok: true, inserted: inserts.length, updated };
}

/** Leader-only, matching every other destructive News & Events action. */
export async function deleteCalendarEntry(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('calendar_entries').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}
