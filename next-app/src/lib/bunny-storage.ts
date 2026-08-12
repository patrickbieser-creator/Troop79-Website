/**
 * Bunny Storage upload — the bytes-to-CDN half of media handling, with no
 * opinion about what the uploaded file is FOR.
 *
 * Extracted from news/media/actions.ts when the Resource Library gained
 * document uploads (Plans/Library-Admin-Resource-Entry.md). Images continue to
 * be recorded in the `media` table by their caller; library documents
 * deliberately are NOT — a PDF in `media` would surface in the image picker
 * that News, photo albums and hero selection share, where every row is assumed
 * to be a displayable image. The library resource is already that file's index
 * record.
 *
 * Server-only (it holds the storage API key) but framework-free: no
 * next/headers, so it is callable from any Server Action.
 */

interface BunnyConfig {
  zone: string;
  apiKey: string;
  pullZoneHost: string;
  storageHost: string;
}

export function bunnyConfig(): BunnyConfig | null {
  const zone = process.env.BUNNY_STORAGE_ZONE;
  const apiKey = process.env.BUNNY_STORAGE_API_KEY;
  const pullZoneHost = process.env.BUNNY_PULL_ZONE_HOSTNAME;
  // Storage Zones only accept requests at their own region's endpoint (e.g.
  // ny.storage.bunnycdn.com) — the default host below only works for zones
  // whose primary region is the default (Falkenstein, DE).
  const storageHost = process.env.BUNNY_STORAGE_HOSTNAME || 'storage.bunnycdn.com';
  if (!zone || !apiKey || !pullZoneHost) return null;
  return { zone, apiKey, pullZoneHost, storageHost };
}

export const BUNNY_NOT_CONFIGURED =
  'Bunny CDN is not configured yet. Set BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY, and BUNNY_PULL_ZONE_HOSTNAME in .env.local.';

export function sanitizeFilename(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
  return base || 'upload';
}

/**
 * Finds an unused path at the Bunny Storage root for this filename's slug,
 * appending -2, -3, ... on a name clash so a same-named upload never silently
 * overwrites an existing file. Root-level + slugged (rather than a
 * uuid-prefixed subfolder) keeps the CDN text-searchable.
 */
export async function findAvailablePath(cfg: BunnyConfig, filename: string): Promise<string> {
  const sanitized = sanitizeFilename(filename);
  const dot = sanitized.lastIndexOf('.');
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const ext = dot > 0 ? sanitized.slice(dot) : '';

  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? sanitized : `${stem}-${n + 1}${ext}`;
    const res = await fetch(`https://${cfg.storageHost}/${cfg.zone}/${candidate}`, {
      method: 'HEAD',
      headers: { AccessKey: cfg.apiKey }
    });
    if (res.status === 404) return candidate;
  }
  return `${stem}-${crypto.randomUUID().slice(0, 8)}${ext}`;
}

export interface BunnyUpload {
  ok: boolean;
  error?: string;
  path?: string;
  cdnUrl?: string;
}

/** PUTs the file at an unused path and returns its CDN URL. */
export async function uploadToBunny(file: File): Promise<BunnyUpload> {
  const cfg = bunnyConfig();
  if (!cfg) return { ok: false, error: BUNNY_NOT_CONFIGURED };

  const path = await findAvailablePath(cfg, file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await fetch(`https://${cfg.storageHost}/${cfg.zone}/${path}`, {
    method: 'PUT',
    headers: { AccessKey: cfg.apiKey, 'Content-Type': 'application/octet-stream' },
    body: bytes
  });
  if (!res.ok) return { ok: false, error: `Bunny upload failed (${res.status}).` };

  return { ok: true, path, cdnUrl: `https://${cfg.pullZoneHost}/${path}` };
}
