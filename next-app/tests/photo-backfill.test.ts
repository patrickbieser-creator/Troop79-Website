import { describe, it, expect } from 'vitest';
import {
  decideCover,
  derivativePath,
  isDerivativePath,
  backfillAlbum,
  safeImageUrl,
  type BackfillIo,
  type CoverRow
} from '../src/lib/photo-backfill';

/**
 * scripts/backfill-photo-thumbnails.ts decision logic (Plans/Photo-Thumbnails.md):
 * skip what is already fine, repoint only behind a verified object, and be
 * idempotent so a partial run is simply re-run.
 */
const heavy: CoverRow = {
  albumId: 18,
  albumTitle: 'Summer Camp 2025',
  mediaId: 109,
  bunnyPath: 'summercamp2025-0a961ab0.png',
  cdnUrl: 'https://cdn.test/summercamp2025-0a961ab0.png',
  altText: 'Summer Camp 2025',
  bytes: 4_216_066,
  contentType: 'image/png'
};

/** An in-memory Bunny + DB that records the ORDER of side effects. */
function fakeIo(opts: { verifyOk?: boolean; existing?: Set<string> } = {}) {
  const log: string[] = [];
  const objects = opts.existing ?? new Set<string>();
  let nextMediaId = 500;
  const repoints: { albumId: number; mediaId: number }[] = [];
  const io: BackfillIo = {
    async download(url) {
      log.push(`download ${url}`);
      return new Uint8Array([1, 2, 3]);
    },
    async encode() {
      log.push('encode');
      return { bytes: new Uint8Array(180 * 1024), mime: 'image/jpeg', width: 1200, height: 665 };
    },
    async upload(path, bytes, mime) {
      log.push(`upload ${path} ${bytes.byteLength} ${mime}`);
      if (objects.has(path)) throw new Error('would overwrite');
      objects.add(path);
      return { path, cdnUrl: `https://cdn.test/${path}` };
    },
    async verify(url) {
      log.push(`verify ${url}`);
      return opts.verifyOk ?? true;
    },
    async insertMedia(row) {
      log.push(`insertMedia ${row.bunnyPath}`);
      return nextMediaId++;
    },
    async repointCover(albumId, mediaId) {
      log.push(`repoint ${albumId} -> ${mediaId}`);
      repoints.push({ albumId, mediaId });
    }
  };
  return { io, log, objects, repoints };
}

describe('backfill decisions (pure)', () => {
  it('BackfillScript_SkipsACoverAlreadyUnderTarget', () => {
    expect(decideCover({ ...heavy, bytes: 200 * 1024 })).toEqual({ action: 'skip', reason: 'under-target' });
    expect(decideCover({ ...heavy, bytes: 250 * 1024 })).toEqual({ action: 'skip', reason: 'under-target' });
    expect(decideCover({ ...heavy, bytes: 250 * 1024 + 1 })).toEqual({ action: 'encode', derivativePath: 'summercamp2025-0a961ab0-1200.jpg' });
  });

  it('BackfillScript_SkipsNonImages_UnknownSizes_AndExistingDerivatives', () => {
    expect(decideCover(null)).toEqual({ action: 'skip', reason: 'no-cover' });
    expect(decideCover({ ...heavy, contentType: 'application/pdf' })).toEqual({ action: 'skip', reason: 'not-image' });
    expect(decideCover({ ...heavy, bytes: null })).toEqual({ action: 'skip', reason: 'size-unknown' });
    expect(decideCover({ ...heavy, bunnyPath: 'summercamp2025-0a961ab0-1200.jpg' })).toEqual({ action: 'skip', reason: 'already-derivative' });
  });

  it('DerivativePath_SitsBesideTheOriginal_SluggedAndSuffixed', () => {
    expect(derivativePath('Klondike Team-BoyScoutChallenge-03-22.jpg')).toBe('klondike-team-boyscoutchallenge-03-22-1200.jpg');
    expect(derivativePath('logo.png', 'image/png')).toBe('logo-1200.png');
    expect(isDerivativePath('logo-1200.png')).toBe(true);
    expect(isDerivativePath('logo.png')).toBe(false);
  });

  it('BackfillScript_RepointsCoverUrl_OnlyAfterTheNewObjectExists', async () => {
    const bad = fakeIo({ verifyOk: false });
    const out = await backfillAlbum(heavy, bad.io, { write: true });
    expect(out.status).toBe('failed');
    expect(bad.repoints).toEqual([]);
    expect(bad.log.some((l) => l.startsWith('insertMedia'))).toBe(false);

    const good = fakeIo({ verifyOk: true });
    const ok = await backfillAlbum(heavy, good.io, { write: true });
    expect(ok.status).toBe('done');
    expect(good.log).toEqual([
      'download https://cdn.test/summercamp2025-0a961ab0.png',
      'encode',
      'upload summercamp2025-0a961ab0-1200.jpg 184320 image/jpeg',
      'verify https://cdn.test/summercamp2025-0a961ab0-1200.jpg',
      'insertMedia summercamp2025-0a961ab0-1200.jpg',
      'repoint 18 -> 500'
    ]);
    // The original is never touched: no delete, no overwrite.
    expect(good.log.some((l) => /delete|overwrite/.test(l))).toBe(false);
  });

  it('BackfillScript_IsIdempotent_WhenRunTwice', async () => {
    const io = fakeIo();
    const first = await backfillAlbum(heavy, io.io, { write: true });
    expect(first.status).toBe('done');
    // After the first run the album points at the derivative — the second
    // run sees a derivative path and a small file and does nothing.
    const afterFirst: CoverRow = { ...heavy, mediaId: 500, bunnyPath: 'summercamp2025-0a961ab0-1200.jpg', bytes: 180 * 1024, contentType: 'image/jpeg' };
    const second = await backfillAlbum(afterFirst, io.io, { write: true });
    expect(second).toEqual({ albumId: 18, status: 'skipped', reason: 'already-derivative' });
    expect(io.repoints.length).toBe(1);
  });

  it('DryRun_TouchesNothing_AndReportsTheProjectedPath', async () => {
    const io = fakeIo();
    const out = await backfillAlbum(heavy, io.io, { write: false });
    expect(out).toEqual({ albumId: 18, status: 'dry-run', before: 4_216_066, derivativePath: 'summercamp2025-0a961ab0-1200.jpg' });
    expect(io.log).toEqual([]);
  });
});

describe('safeImageUrl (pure)', () => {
  it('EncodesARawSpace_AndLeavesAnEncodedUrlAlone', () => {
    expect(safeImageUrl('https://troop79.b-cdn.net/Klondike Team-BoyScoutChallenge-03-22.jpg')).toBe(
      'https://troop79.b-cdn.net/Klondike%20Team-BoyScoutChallenge-03-22.jpg'
    );
    expect(safeImageUrl('https://troop79.b-cdn.net/Klondike%20Team.jpg')).toBe('https://troop79.b-cdn.net/Klondike%20Team.jpg');
    expect(safeImageUrl('https://troop79.b-cdn.net/plain.png')).toBe('https://troop79.b-cdn.net/plain.png');
    expect(safeImageUrl(null)).toBeNull();
  });
});
