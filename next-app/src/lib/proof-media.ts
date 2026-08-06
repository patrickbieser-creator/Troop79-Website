/**
 * Proof-of-completion photo storage (Plans/Resource-Library.md Phase 2).
 *
 * Private Supabase Storage bucket (`proof-media`, migration
 * 20260806100000_proof_media_bucket.sql) — no storage.objects policies, so
 * only the service-role client (createAdminClient(), which bypasses RLS)
 * can read or write. This is the first Supabase Storage bucket in the
 * project — Bunny CDN (news CMS, media library) is a public HTTP API and is
 * the wrong tool here: photos of minors must never be reachable by URL.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PROOF_MEDIA_BUCKET = 'proof-media';

/** Long enough to load an admin review page and view every photo on it;
 *  short enough that a copied/forwarded link goes stale quickly. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp'
]);
const MAX_BYTES = 10 * 1024 * 1024;

export interface ProofMediaEntry {
  /** Storage object path — what requirement_submissions.media stores.
   *  Never a URL: a public URL for this bucket must never exist. */
  path: string;
  contentType: string;
}

/**
 * Validates and uploads one proof photo. Path is namespaced by scout so the
 * eventual retention job (delete 3 months post-review, Backlog) can purge by
 * prefix without a DB round-trip per file.
 */
export async function uploadProofMedia(
  supabase: SupabaseClient,
  file: File,
  scoutId: string
): Promise<{ entry: ProofMediaEntry | null; error: string | null }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { entry: null, error: 'Photos must be JPEG, PNG, HEIC, or WebP.' };
  }
  if (file.size > MAX_BYTES) {
    return { entry: null, error: 'That photo is too large (10 MB max).' };
  }

  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'image/heic'
          ? 'heic'
          : 'jpg';
  const path = `${scoutId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(PROOF_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) return { entry: null, error: error.message };
  return { entry: { path, contentType: file.type }, error: null };
}

/** Short-lived signed URL for one stored proof photo — call only from admin
 *  server code rendering the review screen. Null on any storage error
 *  (missing object, etc.) so a broken photo degrades to "unavailable"
 *  rather than throwing. */
export async function signedProofMediaUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(PROOF_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
