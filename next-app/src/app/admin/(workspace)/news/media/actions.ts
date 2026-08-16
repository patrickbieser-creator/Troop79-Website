'use server';

import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import type { Media } from '@/lib/supabase/types';
import { IMAGE_UPLOAD_TYPES, checkUpload } from '@/lib/upload-limits';
import { BUNNY_NOT_CONFIGURED, bunnyConfig, uploadToBunny } from '@/lib/bunny-storage';

/* Upload rules live in lib/upload-limits.ts and the Bunny plumbing in
   lib/bunny-storage.ts — shared with the Resource Library's document upload so
   the two paths can't drift on size handling or error wording. Images keep
   their own allow-list; SYNCABLE_EXTENSIONS stays image-only on purpose, since
   the Utilities sync sweeps the CDN into `media` and must not pull in library
   PDFs. */
const SYNCABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** Derives a starter alt text from a filename (e.g. "bwca-crew_after six days.jpg" -> "Bwca crew after six days"). */
function filenameToAltText(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]+$/i, '');
  // Strip a leading UUID (app-uploaded files are named `${uuid}-${original name}`).
  const withoutUuid = base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
  const words = withoutUuid.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Untitled photo';
}

interface UploadResult {
  ok: boolean;
  error?: string;
  media?: Media;
}

/** Uploads an image to Bunny Storage and records it in the `media` table. */
export async function uploadMedia(formData: FormData): Promise<UploadResult> {
  const session = await requireCapability('news.write');

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file provided.' };
  const problem = checkUpload(file, IMAGE_UPLOAD_TYPES);
  if (problem) return { ok: false, error: problem };

  const altText = String(formData.get('altText') ?? '').trim();
  if (!altText) return { ok: false, error: 'Alt text is required for accessibility.' };
  const caption = String(formData.get('caption') ?? '').trim() || null;
  const width = Number(formData.get('width')) || null;
  const height = Number(formData.get('height')) || null;

  const uploaded = await uploadToBunny(file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };
  const { path, cdnUrl } = uploaded;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('media')
    .insert({
      bunny_path: path,
      cdn_url: cdnUrl,
      alt_text: altText,
      caption,
      uploaded_by: session.label,
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
  await requireCapability('news.write');

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
  await requireCapability('news.write');
  const trimmed = altText.trim();
  if (!trimmed) return { ok: false, error: 'Alt text is required.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('media').update({ alt_text: trimmed }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

interface BunnyStorageEntry {
  ObjectName: string;
  IsDirectory: boolean;
}

/** Recursively lists every file path in a Bunny Storage Zone below `prefix` (e.g. '' for the zone root). */
async function listBunnyPaths(
  storageHost: string,
  zone: string,
  apiKey: string,
  prefix: string
): Promise<string[]> {
  const res = await fetch(`https://${storageHost}/${zone}/${prefix}`, {
    headers: { AccessKey: apiKey, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Bunny list failed (${res.status}) for /${prefix}`);
  const entries: BunnyStorageEntry[] = await res.json();

  const paths: string[] = [];
  for (const entry of entries) {
    const path = `${prefix}${entry.ObjectName}`;
    if (entry.IsDirectory) {
      paths.push(...(await listBunnyPaths(storageHost, zone, apiKey, `${path}/`)));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

interface SyncResult {
  ok: boolean;
  error?: string;
  added?: number;
  alreadyIndexed?: number;
}

/**
 * Scans the whole Bunny Storage Zone and adds a `media` row for any image
 * file that doesn't have one yet — covers photos already sitting in Bunny
 * (e.g. bulk-uploaded before the News CMS existed) as well as anything
 * added outside this app since the last sync. Safe to re-run any time;
 * already-indexed paths are skipped.
 */
export async function syncBunnyLibrary(): Promise<SyncResult> {
  const session = await requireCapability('news.write');

  const cfg = bunnyConfig();
  if (!cfg) return { ok: false, error: BUNNY_NOT_CONFIGURED };
  const { zone, apiKey, pullZoneHost, storageHost } = cfg;

  let allPaths: string[];
  try {
    allPaths = await listBunnyPaths(storageHost, zone, apiKey, '');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to list Bunny storage.' };
  }
  const imagePaths = allPaths.filter((p) => SYNCABLE_EXTENSIONS.has(p.slice(p.lastIndexOf('.')).toLowerCase()));

  const supabase = createAdminClient();
  const { data: existing, error: existingError } = await supabase.from('media').select('bunny_path');
  if (existingError) return { ok: false, error: existingError.message };
  const indexed = new Set((existing ?? []).map((r) => r.bunny_path as string));

  const newPaths = imagePaths.filter((p) => !indexed.has(p));
  if (newPaths.length === 0) {
    return { ok: true, added: 0, alreadyIndexed: imagePaths.length };
  }

  const { error: insertError } = await supabase.from('media').insert(
    newPaths.map((path) => ({
      bunny_path: path,
      cdn_url: `https://${pullZoneHost}/${path}`,
      alt_text: filenameToAltText(path),
      caption: null,
      uploaded_by: session.label
    }))
  );
  if (insertError) return { ok: false, error: insertError.message };

  return { ok: true, added: newPaths.length, alreadyIndexed: imagePaths.length - newPaths.length };
}
