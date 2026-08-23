/**
 * backfill-photo-thumbnails — re-encode the heavy album covers
 * (Plans/Photo-Thumbnails.md step 4/5).
 *
 *   npm run backfill-photo-thumbnails                 # DRY RUN (default): byte table only
 *   npm run backfill-photo-thumbnails -- --write      # upload derivatives + repoint covers
 *   npm run backfill-photo-thumbnails -- --write --allow-remote   # against production (see below)
 *
 * For each photo_albums row with a cover: HEAD the CDN URL for its size; skip
 * anything ≤ 250 KB, not an image, or already a derivative; otherwise
 * download, re-encode with sharp (long edge 1200, JPEG q82 — PNG only when
 * the source has alpha), upload under a NEW path (`<stem>-1200.jpg`, next
 * free name on a clash — never an overwrite), VERIFY the object answers at its
 * CDN URL, insert a NEW media row, and only then repoint the album's
 * cover_media_id. Originals — object and media row — are never deleted.
 * Idempotent: a second run finds a derivative under target and skips it. The
 * decision logic is src/lib/photo-backfill.ts (tested); this file is the I/O.
 *
 * Targets: .env.local points at the LOCAL Supabase (and the REAL Bunny zone —
 * the CDN is shared). A production run needs the prod REST target on the
 * command line plus --allow-remote:
 *   NEXT_PUBLIC_SUPABASE_URL=https://qyovupepjdxikyepieps.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<prod service key> \
 *   npm run backfill-photo-thumbnails -- --write --allow-remote
 * (prod keys: `npx supabase projects api-keys --project-ref qyovupepjdxikyepieps`)
 *
 * --alt  also fills an EMPTY cover alt text with "<album title> — album cover"
 *        (never overwrites text a leader wrote).
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import {
  backfillAlbum,
  type BackfillIo,
  type BackfillOutcome,
  type CoverRow,
  COVER_LONG_EDGE,
  TARGET_BYTES
} from '../src/lib/photo-backfill';
import { formatBytes } from '../src/lib/image-resize';
import { bunnyConfig, findAvailablePath } from '../src/lib/bunny-storage';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const WRITE = flag('write');
const FILL_ALT = flag('alt');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (run via npm script so .env.local loads).');
  process.exit(2);
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL);
if (!isLocal && !flag('allow-remote')) {
  console.error(`Refusing: ${SUPABASE_URL} is not the local dev database. Pass --allow-remote only for a reviewed production run.`);
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cfg = bunnyConfig();
if (WRITE && !cfg) {
  console.error('Bunny is not configured (BUNNY_STORAGE_ZONE / BUNNY_STORAGE_API_KEY / BUNNY_PULL_ZONE_HOSTNAME) — --write needs it.');
  process.exit(2);
}

async function headSize(url: string): Promise<{ bytes: number | null; contentType: string | null }> {
  try {
    const res = await fetch(encodeURI(decodeURI(url)), { method: 'HEAD' });
    if (!res.ok) return { bytes: null, contentType: null };
    const len = res.headers.get('content-length');
    return { bytes: len ? Number(len) : null, contentType: res.headers.get('content-type') };
  } catch {
    return { bytes: null, contentType: null };
  }
}

const io: BackfillIo = {
  async download(cdnUrl) {
    const res = await fetch(encodeURI(decodeURI(cdnUrl)));
    if (!res.ok) throw new Error(`download ${cdnUrl}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  async encode(original) {
    const img = sharp(original, { failOn: 'none' });
    // A screenshot PNG CARRIES an alpha channel while every pixel is opaque
    // (probed 2026-08-23: all 26 covers report hasAlpha) — metadata.hasAlpha
    // would keep them PNG and miss the target. stats().isOpaque looks at the
    // pixels; only real transparency stays PNG.
    const transparent = !(await img.stats()).isOpaque;
    const resized = img.resize({ width: COVER_LONG_EDGE, height: COVER_LONG_EDGE, fit: 'inside', withoutEnlargement: true });
    if (transparent) {
      const out = await resized.png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true });
      return { bytes: new Uint8Array(out.data), mime: 'image/png', width: out.info.width, height: out.info.height };
    }
    // q82 first; the worst screenshot lands just over 250 KB there, so step
    // down once or twice rather than ship 253 KB against a 250 KB promise.
    let out = await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    for (const q of [74, 66]) {
      if (out.data.length <= TARGET_BYTES) break;
      out = await resized.jpeg({ quality: q, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    }
    return { bytes: new Uint8Array(out.data), mime: 'image/jpeg', width: out.info.width, height: out.info.height };
  },
  async upload(path, bytes, mime) {
    const c = cfg!;
    // Next free name — never overwrite an existing object.
    const free = await findAvailablePath(c, path);
    const res = await fetch(`https://${c.storageHost}/${c.zone}/${free}`, {
      method: 'PUT',
      headers: { AccessKey: c.apiKey, 'Content-Type': mime },
      // A fresh ArrayBuffer-backed copy: fetch's BodyInit does not accept a
      // Buffer-backed (ArrayBufferLike) view.
      body: new Uint8Array(bytes)
    });
    if (!res.ok) throw new Error(`Bunny PUT ${free}: ${res.status}`);
    return { path: free, cdnUrl: `https://${c.pullZoneHost}/${free}` };
  },
  async verify(cdnUrl) {
    // The CDN may take a moment; the storage endpoint is authoritative, then
    // the pull zone must answer too (that is what /photos will fetch).
    const c = cfg!;
    const path = cdnUrl.slice(`https://${c.pullZoneHost}/`.length);
    const st = await fetch(`https://${c.storageHost}/${c.zone}/${path}`, { method: 'HEAD', headers: { AccessKey: c.apiKey } });
    if (!st.ok) return false;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(cdnUrl, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return true;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  },
  async insertMedia(row) {
    const { data, error } = await supabase
      .from('media')
      .insert({
        bunny_path: row.bunnyPath,
        cdn_url: row.cdnUrl,
        alt_text: row.altText,
        caption: null,
        uploaded_by: 'backfill-photo-thumbnails',
        width: row.width,
        height: row.height
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`media insert: ${error?.message}`);
    return data.id as number;
  },
  async repointCover(albumId, mediaId) {
    const { error } = await supabase.from('photo_albums').update({ cover_media_id: mediaId, updated_at: new Date().toISOString() }).eq('id', albumId);
    if (error) throw new Error(`repoint album ${albumId}: ${error.message}`);
  }
};

async function main() {
  console.log(`Target: ${SUPABASE_URL}${isLocal ? ' (local)' : ' (REMOTE)'}  ·  ${WRITE ? 'WRITE' : 'DRY RUN'}  ·  ≤ ${formatBytes(TARGET_BYTES)} · ${COVER_LONG_EDGE}px`);

  const { data: albums, error } = await supabase
    .from('photo_albums')
    .select('id, title, cover_media_id')
    .order('id');
  if (error) throw new Error(error.message);
  const rows = (albums ?? []) as { id: number; title: string; cover_media_id: number | null }[];
  const mediaIds = rows.map((a) => a.cover_media_id).filter((v): v is number => v != null);
  const { data: media } = mediaIds.length
    ? await supabase.from('media').select('id, bunny_path, cdn_url, alt_text').in('id', mediaIds)
    : { data: [] as unknown[] };
  const mediaById = new Map(((media ?? []) as { id: number; bunny_path: string; cdn_url: string; alt_text: string | null }[]).map((m) => [m.id, m]));

  const covers: (CoverRow | null)[] = [];
  for (const a of rows) {
    const m = a.cover_media_id != null ? mediaById.get(a.cover_media_id) : undefined;
    if (!m) {
      covers.push(null);
      continue;
    }
    const head = await headSize(m.cdn_url);
    covers.push({
      albumId: a.id,
      albumTitle: a.title,
      mediaId: m.id,
      bunnyPath: m.bunny_path,
      cdnUrl: m.cdn_url,
      altText: m.alt_text,
      bytes: head.bytes,
      contentType: head.contentType
    });
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let heavy = 0;
  const outcomes: { title: string; row: CoverRow | null; out: BackfillOutcome }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = covers[i];
    const out = await backfillAlbum(row, io, { write: WRITE });
    outcomes.push({ title: rows[i].title, row, out });
    const before = row?.bytes ?? 0;
    totalBefore += before;
    if (out.status === 'done') {
      totalAfter += out.after;
      heavy++;
    } else if (out.status === 'dry-run') {
      // Projection: 1200 px JPEG q82 of a screenshot lands ~150–250 KB.
      totalAfter += Math.min(before, 200 * 1024);
      heavy++;
    } else {
      totalAfter += before;
    }
  }

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log('');
  console.log(`${pad('album', 44)} ${'now'.padStart(9)}  ${'→'.padStart(9)}  outcome`);
  for (const { title, row, out } of outcomes) {
    const now = row?.bytes != null ? formatBytes(row.bytes) : '—';
    let after = '';
    let note = '';
    switch (out.status) {
      case 'skipped':
        after = now;
        note = `skip (${out.reason})`;
        break;
      case 'dry-run':
        after = '~200 KB';
        note = `would encode → ${out.derivativePath}`;
        break;
      case 'done':
        after = formatBytes(out.after);
        note = `done → ${out.cdnUrl} (media ${out.mediaId})`;
        break;
      case 'failed':
        after = now;
        note = `FAILED: ${out.reason}`;
        break;
    }
    console.log(`${pad(title, 44)} ${now.padStart(9)}  ${after.padStart(9)}  ${note}`);
  }
  console.log('');
  console.log(`${rows.length} albums · ${heavy} heavy covers ${WRITE ? 're-encoded' : 'to re-encode'} · ${formatBytes(totalBefore)} → ${WRITE ? '' : '~'}${formatBytes(totalAfter)} total`);

  if (FILL_ALT) {
    let filled = 0;
    for (const { row } of outcomes) {
      if (!row || (row.altText && row.altText.trim())) continue;
      const alt = `${row.albumTitle} — album cover`;
      if (WRITE) {
        const { error: e } = await supabase.from('media').update({ alt_text: alt }).eq('id', row.mediaId);
        if (e) console.error(`alt for media ${row.mediaId}: ${e.message}`);
        else filled++;
      } else {
        console.log(`would set alt on media ${row.mediaId}: "${alt}"`);
        filled++;
      }
    }
    console.log(`${filled} empty cover alt text${filled === 1 ? '' : 's'} ${WRITE ? 'filled' : 'to fill'}`);
  }
  if (!WRITE) console.log('Dry run — nothing written. Re-run with --write to upload and repoint.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
