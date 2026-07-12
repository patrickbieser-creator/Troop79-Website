'use server';

import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import type { Media } from '@/lib/supabase/types';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024; // 12MB — leaves headroom under the 15mb server-action body limit
const SYNCABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function sanitizeFilename(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
  return base || 'upload';
}

/**
 * Finds an unused path at the Bunny Storage root for this filename's slug,
 * appending -2, -3, ... on a name clash so a same-named upload never
 * silently overwrites an existing file. Root-level + slugged (rather than a
 * uuid-prefixed articles/ subfolder) keeps the CDN text-searchable.
 */
async function findAvailablePath(
  storageHost: string,
  zone: string,
  apiKey: string,
  filename: string
): Promise<string> {
  const sanitized = sanitizeFilename(filename);
  const dot = sanitized.lastIndexOf('.');
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const ext = dot > 0 ? sanitized.slice(dot) : '';

  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? sanitized : `${stem}-${n + 1}${ext}`;
    const res = await fetch(`https://${storageHost}/${zone}/${candidate}`, {
      method: 'HEAD',
      headers: { AccessKey: apiKey }
    });
    if (res.status === 404) return candidate;
  }
  return `${stem}-${crypto.randomUUID().slice(0, 8)}${ext}`;
}

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
  const session = await requireRole(['leader', 'scout']);

  const zone = process.env.BUNNY_STORAGE_ZONE;
  const apiKey = process.env.BUNNY_STORAGE_API_KEY;
  const pullZoneHost = process.env.BUNNY_PULL_ZONE_HOSTNAME;
  // Storage Zones only accept requests at their own region's endpoint (e.g.
  // ny.storage.bunnycdn.com) — the default host below only works for zones
  // whose primary region is the default (Falkenstein, DE).
  const storageHost = process.env.BUNNY_STORAGE_HOSTNAME || 'storage.bunnycdn.com';
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

  const path = await findAvailablePath(storageHost, zone, apiKey, file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadRes = await fetch(`https://${storageHost}/${zone}/${path}`, {
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
  const session = await requireRole(['leader', 'scout']);

  const zone = process.env.BUNNY_STORAGE_ZONE;
  const apiKey = process.env.BUNNY_STORAGE_API_KEY;
  const pullZoneHost = process.env.BUNNY_PULL_ZONE_HOSTNAME;
  const storageHost = process.env.BUNNY_STORAGE_HOSTNAME || 'storage.bunnycdn.com';
  if (!zone || !apiKey || !pullZoneHost) {
    return { ok: false, error: 'Bunny CDN is not configured yet. See .env.example.' };
  }

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
      uploaded_by: session.leader
    }))
  );
  if (insertError) return { ok: false, error: insertError.message };

  return { ok: true, added: newPaths.length, alreadyIndexed: imagePaths.length - newPaths.length };
}
