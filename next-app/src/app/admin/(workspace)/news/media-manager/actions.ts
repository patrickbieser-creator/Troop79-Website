'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import type { Media } from '@/lib/supabase/types';

function revalidateNews() {
  revalidatePath('/admin/news/articles');
  revalidatePath('/');
  revalidatePath('/events');
}

interface ListResult {
  ok: boolean;
  error?: string;
  media: Media[];
  total: number;
}

/** Paginated browse/list of the whole media library (unlike the picker's fixed 60-row `listMedia`). */
export async function listMediaManager(search: string, offset: number, limit: number): Promise<ListResult> {
  await requireRole(['leader', 'scout']);

  const supabase = createAdminClient();
  let query = supabase
    .from('media')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const term = search.trim();
  if (term) {
    query = query.or(`alt_text.ilike.%${term}%,caption.ilike.%${term}%,bunny_path.ilike.%${term}%`);
  }
  const { data, error, count } = await query;
  if (error) return { ok: false, error: error.message, media: [], total: 0 };
  return { ok: true, media: (data ?? []) as Media[], total: count ?? 0 };
}

export interface MediaUsage {
  id: number;
  slug: string;
  title: string;
  type: string;
  status: string;
  roles: ('hero' | 'body')[];
}

/** Where a media item is referenced: as an article's hero image, or embedded in a body (single image or {{gallery}} token — both store the raw cdn_url). */
async function findMediaUsage(
  supabase: ReturnType<typeof createAdminClient>,
  media: Pick<Media, 'id' | 'cdn_url'>
): Promise<MediaUsage[]> {
  const [heroRes, bodyRes] = await Promise.all([
    supabase.from('articles').select('id, slug, title, type, status').eq('hero_media_id', media.id),
    supabase.from('articles').select('id, slug, title, type, status').ilike('body', `%${media.cdn_url}%`)
  ]);

  const byId = new Map<number, MediaUsage>();
  for (const row of heroRes.data ?? []) {
    byId.set(row.id, { ...row, roles: ['hero'] });
  }
  for (const row of bodyRes.data ?? []) {
    const existing = byId.get(row.id);
    if (existing) existing.roles.push('body');
    else byId.set(row.id, { ...row, roles: ['body'] });
  }
  return Array.from(byId.values());
}

export async function getMediaUsage(id: number): Promise<{ ok: boolean; error?: string; articles: MediaUsage[] }> {
  await requireRole(['leader', 'scout']);
  const supabase = createAdminClient();
  const { data: media, error } = await supabase.from('media').select('id, cdn_url').eq('id', id).single();
  if (error || !media) return { ok: false, error: error?.message ?? 'Photo not found.', articles: [] };
  return { ok: true, articles: await findMediaUsage(supabase, media) };
}

interface UpdateResult {
  ok: boolean;
  error?: string;
  media?: Media;
}

export async function updateMediaMetadata(
  id: number,
  altText: string,
  caption: string
): Promise<UpdateResult> {
  await requireRole(['leader', 'scout']);
  const trimmedAlt = altText.trim();
  if (!trimmedAlt) return { ok: false, error: 'Alt text is required for accessibility.' };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('media')
    .update({ alt_text: trimmedAlt, caption: caption.trim() || null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };

  const usage = await findMediaUsage(supabase, data as Media);
  if (usage.length > 0) {
    revalidateNews();
    for (const article of usage) revalidatePath(`/news/${article.slug}`);
  }
  return { ok: true, media: data as Media };
}

interface DeleteResult {
  ok: boolean;
  error?: string;
  blockedBy?: MediaUsage[];
}

/**
 * Leader-only, matching every other destructive News & Events action
 * (deleteArticle, archiveArticle, etc.). Untracks the row only — the file
 * stays in Bunny storage; a Bunny Library Sync will re-index it if needed.
 */
export async function deleteMedia(id: number): Promise<DeleteResult> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: media, error: fetchError } = await supabase
    .from('media')
    .select('id, cdn_url')
    .eq('id', id)
    .single();
  if (fetchError || !media) return { ok: false, error: fetchError?.message ?? 'Photo not found.' };

  const usage = await findMediaUsage(supabase, media);
  if (usage.length > 0) return { ok: false, blockedBy: usage };

  const { error } = await supabase.from('media').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
