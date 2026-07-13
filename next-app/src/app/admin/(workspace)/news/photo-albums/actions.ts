'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import type { CalendarCategory } from '@/lib/supabase/types';

type ActionResult = { ok: boolean; error?: string };

function revalidateAlbums() {
  revalidatePath('/admin/news/photo-albums');
  revalidatePath('/photos');
}

function fieldsFromForm(fd: FormData) {
  const coverIdRaw = String(fd.get('cover_media_id') ?? '').trim();
  const countRaw = String(fd.get('photo_count') ?? '').trim();
  return {
    title: String(fd.get('title') ?? '').trim(),
    event_date: String(fd.get('event_date') ?? '').trim(),
    category: String(fd.get('category') ?? '').trim() as CalendarCategory,
    google_url: String(fd.get('google_url') ?? '').trim(),
    cover_media_id: coverIdRaw ? Number(coverIdRaw) : null,
    description: String(fd.get('description') ?? '').trim() || null,
    photo_count: countRaw ? Number(countRaw) : null,
    updated_at: new Date().toISOString()
  };
}

function validate(f: ReturnType<typeof fieldsFromForm>): string | null {
  if (!f.title) return 'Title is required.';
  if (!f.event_date) return 'Event date is required.';
  if (!f.category) return 'Category is required.';
  if (!f.google_url) return 'The Google Photos share link is required.';
  if (!/^https:\/\//.test(f.google_url)) return 'The share link should be a full https:// URL.';
  return null;
}

export async function createPhotoAlbum(fd: FormData): Promise<ActionResult> {
  await requireRole(['leader', 'scout']);
  const fields = fieldsFromForm(fd);
  const invalid = validate(fields);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from('photo_albums').insert(fields);
  if (error) return { ok: false, error: error.message };
  revalidateAlbums();
  return { ok: true };
}

export async function updatePhotoAlbum(fd: FormData): Promise<ActionResult> {
  await requireRole(['leader', 'scout']);
  const id = Number(fd.get('id'));
  const fields = fieldsFromForm(fd);
  const invalid = validate(fields);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase.from('photo_albums').update(fields).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAlbums();
  return { ok: true };
}

/** Leader-only, matching every other destructive News & Events action. */
export async function deletePhotoAlbum(id: number): Promise<ActionResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('photo_albums').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateAlbums();
  return { ok: true };
}
