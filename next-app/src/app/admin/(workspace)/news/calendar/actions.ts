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

/** Leader-only, matching every other destructive News & Events action. */
export async function deleteCalendarEntry(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('calendar_entries').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateCalendar();
  return { ok: true };
}
