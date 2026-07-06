'use server';

import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import type { Media } from '@/lib/supabase/types';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024; // 12MB — leaves headroom under the 15mb server-action body limit

function sanitizeFilename(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
  return base || 'upload';
}

interface UploadResult {
  ok: boolean;
  error?: string;
  media?: Media;
}

/** Uploads an image to Bunny Storage and records it in the `media` table. */
export async function uploadMedia(formData: FormData): Promise<UploadResult> {
  const session = await requireRole(['leader', 'scout']);

  const zone = process.env.BUNNY_STORAGE_ZONE;
  const apiKey = process.env.BUNNY_STORAGE_API_KEY;
  const pullZoneHost = process.env.BUNNY_PULL_ZONE_HOSTNAME;
  if (!zone || !apiKey || !pullZoneHost) {
    return {
      ok: false,
      error:
        'Bunny CDN is not configured yet. Set BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY, and BUNNY_PULL_ZONE_HOSTNAME in .env.local.'
    };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file provided.' };
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: `Unsupported file type: ${file.type || 'unknown'}. Use JPEG, PNG, WEBP, or GIF.` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). Max is 12MB.` };
  }

  const altText = String(formData.get('altText') ?? '').trim();
  if (!altText) return { ok: false, error: 'Alt text is required for accessibility.' };
  const caption = String(formData.get('caption') ?? '').trim() || null;
  const width = Number(formData.get('width')) || null;
  const height = Number(formData.get('height')) || null;

  const path = `articles/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadRes = await fetch(`https://storage.bunnycdn.com/${zone}/${path}`, {
    method: 'PUT',
    headers: { AccessKey: apiKey, 'Content-Type': 'application/octet-stream' },
    body: bytes
  });
  if (!uploadRes.ok) {
    return { ok: false, error: `Bunny upload failed (${uploadRes.status}).` };
  }

  const cdnUrl = `https://${pullZoneHost}/${path}`;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('media')
    .insert({
      bunny_path: path,
      cdn_url: cdnUrl,
      alt_text: altText,
      caption,
      uploaded_by: session.leader,
      width,
      height
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, media: data as Media };
}

interface ListMediaResult {
  ok: boolean;
  error?: string;
  media: Media[];
}

/** Browse/search already-uploaded media for the "Browse Existing" picker tab. */
export async function listMedia(search: string): Promise<ListMediaResult> {
  await requireRole(['leader', 'scout']);

  const supabase = createAdminClient();
  let query = supabase.from('media').select('*').order('created_at', { ascending: false }).limit(60);
  const term = search.trim();
  if (term) {
    query = query.or(`alt_text.ilike.%${term}%,caption.ilike.%${term}%,bunny_path.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message, media: [] };
  return { ok: true, media: (data ?? []) as Media[] };
}

/**
 * Backfills alt text on a media row that predates the requirement (e.g.
 * imported from the troop's existing Bunny library). Called when a picker
 * user supplies alt text to unblock selecting an undescribed photo.
 */
export async function setMediaAltText(
  id: number,
  altText: string
): Promise<{ ok: boolean; error?: string }> {
  await requireRole(['leader', 'scout']);
  const trimmed = altText.trim();
  if (!trimmed) return { ok: false, error: 'Alt text is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('media').update({ alt_text: trimmed }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
