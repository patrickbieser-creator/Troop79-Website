/**
 * Reimbursement receipt storage (Plans/Troop-Finances.md Phase 4). Same
 * pattern as lib/proof-media.ts's proof-photo bucket — private Supabase
 * Storage, zero storage.objects policies (only the service-role client
 * bypasses RLS), namespaced path per uploader. See
 * 20260818210000_receipt_media_bucket.sql for the bucket itself.
 *
 * Wider allowlist than proof-media: a receipt is as often a PDF as a photo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const RECEIPT_MEDIA_BUCKET = 'receipt-media';

/** Long enough to load the treasurer's reimbursement queue and view every
 *  receipt on it; short enough that a copied/forwarded link goes stale
 *  quickly — same TTL rationale as proof-media. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf'
]);
const MAX_BYTES = 10 * 1024 * 1024;

export interface ReceiptMediaEntry {
  /** Storage object path — what reimbursement_requests.receipt_path stores.
   *  Never a URL: a public URL for this bucket must never exist. */
  path: string;
  contentType: string;
}

/** Validates and uploads one receipt. Path is namespaced by the requesting
 *  person so a future retention job can purge by prefix without a DB
 *  round-trip per file, same reasoning as uploadProofMedia(). */
export async function uploadReceiptMedia(
  supabase: SupabaseClient,
  file: File,
  requesterPersonId: number
): Promise<{ entry: ReceiptMediaEntry | null; error: string | null }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { entry: null, error: 'Receipts must be JPEG, PNG, HEIC, WebP, or PDF.' };
  }
  if (file.size > MAX_BYTES) {
    return { entry: null, error: 'That file is too large (10 MB max).' };
  }

  const ext =
    file.type === 'application/pdf'
      ? 'pdf'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : file.type === 'image/heic'
            ? 'heic'
            : 'jpg';
  const path = `${requesterPersonId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(RECEIPT_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) return { entry: null, error: error.message };
  return { entry: { path, contentType: file.type }, error: null };
}

/** Short-lived signed URL for one stored receipt — call only from admin
 *  server code rendering the treasurer's reimbursement queue. Null on any
 *  storage error, so a broken/missing file degrades to "unavailable" rather
 *  than throwing. */
export async function signedReceiptMediaUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPT_MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
