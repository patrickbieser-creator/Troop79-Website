/**
 * Photo-thumbnail backfill — the DECISION half of
 * scripts/backfill-photo-thumbnails.ts (Plans/Photo-Thumbnails.md step 4),
 * kept pure so the things that matter can be asserted without Bunny, sharp
 * or a database:
 *
 *   - a cover already under target (≤ 250 KB) or already a derivative is
 *     SKIPPED — running the script twice does nothing the second time;
 *   - the album's cover is REPOINTED only after the new object is verified
 *     fetchable — a repoint with no object behind it is a broken cover on the
 *     public page, the one failure that must never happen;
 *   - originals are never deleted or overwritten; the derivative is a NEW
 *     object at a new path and a NEW media row.
 *
 * The script supplies the I/O (`BackfillIo`) and runs `backfillAlbum` per
 * album; tests supply fakes.
 */

import { TARGET_BYTES, COVER_LONG_EDGE } from './image-resize';

export { TARGET_BYTES, COVER_LONG_EDGE };

export const DERIVATIVE_SUFFIX = `-${COVER_LONG_EDGE}`;
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface CoverRow {
  albumId: number;
  albumTitle: string;
  mediaId: number;
  bunnyPath: string;
  cdnUrl: string;
  altText: string | null;
  /** From a HEAD of the CDN URL; null when unknown. */
  bytes: number | null;
  contentType: string | null;
}

export type BackfillDecision =
  | { action: 'skip'; reason: 'no-cover' | 'already-derivative' | 'under-target' | 'not-image' | 'size-unknown' }
  | { action: 'encode'; derivativePath: string };

/** `<stem>-1200.jpg` beside the original, slugged like uploadToBunny does.
 *  The extension is decided by the encoder (PNG only with alpha); callers
 *  pass the mime they actually produced. */
export function derivativePath(bunnyPath: string, mime: 'image/jpeg' | 'image/png' = 'image/jpeg'): string {
  const base = bunnyPath.split('/').pop() ?? bunnyPath;
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
  return `${stem || 'cover'}${DERIVATIVE_SUFFIX}${mime === 'image/png' ? '.png' : '.jpg'}`;
}

export function isDerivativePath(bunnyPath: string): boolean {
  return new RegExp(`${DERIVATIVE_SUFFIX}\\.(jpe?g|png)$`, 'i').test(bunnyPath);
}

export function decideCover(row: CoverRow | null): BackfillDecision {
  if (!row) return { action: 'skip', reason: 'no-cover' };
  if (isDerivativePath(row.bunnyPath)) return { action: 'skip', reason: 'already-derivative' };
  if (row.contentType && !IMAGE_TYPES.has(row.contentType.split(';')[0].trim())) return { action: 'skip', reason: 'not-image' };
  if (row.bytes == null) return { action: 'skip', reason: 'size-unknown' };
  if (row.bytes <= TARGET_BYTES) return { action: 'skip', reason: 'under-target' };
  return { action: 'encode', derivativePath: derivativePath(row.bunnyPath) };
}

export interface EncodedCover {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

/** Everything the script does to the outside world, injectable. */
export interface BackfillIo {
  download(cdnUrl: string): Promise<Uint8Array>;
  encode(original: Uint8Array): Promise<EncodedCover>;
  /** Returns the CDN URL of the uploaded object. Must not overwrite: if the
   *  path exists the implementation picks the next free one. */
  upload(path: string, bytes: Uint8Array, mime: string): Promise<{ path: string; cdnUrl: string }>;
  /** True only when the object answers at its CDN URL. */
  verify(cdnUrl: string): Promise<boolean>;
  insertMedia(row: { bunnyPath: string; cdnUrl: string; altText: string | null; width: number; height: number }): Promise<number>;
  repointCover(albumId: number, mediaId: number): Promise<void>;
}

export type BackfillOutcome =
  | { albumId: number; status: 'skipped'; reason: Extract<BackfillDecision, { action: 'skip' }>['reason'] }
  | { albumId: number; status: 'dry-run'; before: number; derivativePath: string }
  | { albumId: number; status: 'done'; before: number; after: number; cdnUrl: string; mediaId: number }
  | { albumId: number; status: 'failed'; reason: string };

/**
 * One album, start to finish. With `write: false` nothing is downloaded,
 * encoded or written — the decision and the projected path are reported.
 * The order download → encode → upload → VERIFY → insert media → repoint is
 * the contract the tests pin: the album never points at an unverified object.
 */
export async function backfillAlbum(row: CoverRow | null, io: BackfillIo, opts: { write: boolean }): Promise<BackfillOutcome> {
  const decision = decideCover(row);
  const albumId = row?.albumId ?? -1;
  if (decision.action === 'skip') return { albumId, status: 'skipped', reason: decision.reason };
  const cover = row as CoverRow;
  if (!opts.write) return { albumId, status: 'dry-run', before: cover.bytes as number, derivativePath: decision.derivativePath };

  const original = await io.download(cover.cdnUrl);
  const encoded = await io.encode(original);
  const path = derivativePath(cover.bunnyPath, encoded.mime);
  const uploaded = await io.upload(path, encoded.bytes, encoded.mime);
  const ok = await io.verify(uploaded.cdnUrl);
  if (!ok) return { albumId, status: 'failed', reason: `uploaded ${uploaded.path} but it does not answer at ${uploaded.cdnUrl} — cover left untouched` };
  const mediaId = await io.insertMedia({
    bunnyPath: uploaded.path,
    cdnUrl: uploaded.cdnUrl,
    altText: cover.altText,
    width: encoded.width,
    height: encoded.height
  });
  await io.repointCover(cover.albumId, mediaId);
  return { albumId, status: 'done', before: cover.bytes as number, after: encoded.bytes.byteLength, cdnUrl: uploaded.cdnUrl, mediaId };
}

/** Percent-encode the one thing Bunny-synced URLs carry that an <img> should
 *  not be asked to guess about: spaces and other raw characters in the path
 *  (`Klondike Team-….jpg`). Idempotent — an already-encoded URL is unchanged. */
export function safeImageUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    return encodeURI(decodeURI(url));
  } catch {
    return encodeURI(url);
  }
}
