import { describe, it, expect } from 'vitest';
import {
  resizePlan,
  formatBytes,
  beforeAfterLine,
  TARGET_BYTES,
  COVER_LONG_EDGE,
  GENERAL_LONG_EDGE,
  JPEG_QUALITY
} from '../src/lib/image-resize';

/**
 * Photo thumbnails (Plans/Photo-Thumbnails.md): the DECISION half of
 * resize-before-upload is pure and tested here; the canvas call is verified
 * in the browser. A 4 MB screenshot must come out ≤ 250 KB at ~1200 px; a
 * small file, a transparent logo and a PDF must each be left exactly alone.
 */
const png = (w: number, h: number, size: number, hasAlpha = false) => ({ type: 'image/png', size, width: w, height: h, hasAlpha });
const jpeg = (w: number, h: number, size: number) => ({ type: 'image/jpeg', size, width: w, height: h });

describe('resizePlan (pure)', () => {
  it('ResizePlan_TargetsLongEdge1200_ForACoverImage', () => {
    expect(resizePlan(png(3456, 2160, 4_000_000), { kind: 'cover' })).toEqual({
      longEdge: COVER_LONG_EDGE,
      mime: 'image/jpeg',
      quality: JPEG_QUALITY
    });
    expect(COVER_LONG_EDGE).toBe(1200);
  });

  it('ResizePlan_TargetsLongEdge1600_ForAGeneralMediaUpload', () => {
    expect(resizePlan(jpeg(4032, 3024, 3_000_000), { kind: 'general' })).toEqual({
      longEdge: GENERAL_LONG_EDGE,
      mime: 'image/jpeg',
      quality: JPEG_QUALITY
    });
    expect(GENERAL_LONG_EDGE).toBe(1600);
  });

  it('ResizePlan_LeavesASmallImageAlone_WhenItIsAlreadyUnderTheTarget', () => {
    // The 0.20 MB WinterCampAlbumCover must come out byte-identical.
    expect(resizePlan(png(800, 500, 200 * 1024), { kind: 'cover' })).toBeNull();
    // Under the pixel target but over the byte target → still re-encode (a
    // 1100 px PNG screenshot is the common 1–2 MB case).
    expect(resizePlan(png(1100, 700, 1_500_000), { kind: 'cover' })).not.toBeNull();
    // Over the pixel target but a tiny file (a big flat PNG) → leave it.
    expect(resizePlan(png(2400, 1200, 90_000), { kind: 'cover' })).toBeNull();
  });

  it('ResizePlan_NeverUpscales_AShortEdgeStaysPutButStillReencodes', () => {
    // Smaller than the box yet heavy: the plan keeps the source's own long
    // edge (no upscale) and only changes the encoding.
    expect(resizePlan(png(1000, 600, 1_200_000), { kind: 'cover' })).toEqual({
      longEdge: 1000,
      mime: 'image/jpeg',
      quality: JPEG_QUALITY
    });
  });

  it('ResizePlan_ChoosesJpeg_ForAPhotographicSource', () => {
    expect(resizePlan(png(2000, 1500, 2_900_000), { kind: 'general' })?.mime).toBe('image/jpeg');
    expect(resizePlan({ type: 'image/webp', size: 2_900_000, width: 2000, height: 1500 }, { kind: 'general' })?.mime).toBe('image/jpeg');
  });

  it('ResizePlan_KeepsPng_WhenTheSourceHasTransparency', () => {
    const plan = resizePlan(png(2000, 2000, 1_000_000, true), { kind: 'general' });
    expect(plan?.mime).toBe('image/png');
    expect(plan?.longEdge).toBe(GENERAL_LONG_EDGE);
  });

  it('ResizePlan_RefusesANonImage_AndPassesItThroughUntouched', () => {
    expect(resizePlan({ type: 'application/pdf', size: 9_000_000, width: 0, height: 0 }, { kind: 'general' })).toBeNull();
    // Animated GIFs would lose their frames on a canvas — untouched.
    expect(resizePlan({ type: 'image/gif', size: 3_000_000, width: 2000, height: 2000 }, { kind: 'general' })).toBeNull();
    // Unknown dimensions (decode failed) → don't guess.
    expect(resizePlan({ type: 'image/jpeg', size: 3_000_000, width: 0, height: 0 }, { kind: 'general' })).toBeNull();
  });

  it('ResizePlan_TargetBytes_Is250KB', () => {
    expect(TARGET_BYTES).toBe(250 * 1024);
  });
});

describe('formatBytes / beforeAfterLine (pure)', () => {
  it('FormatBytes_RendersTheBeforeAndAfterLine', () => {
    expect(formatBytes(4.02 * 1024 * 1024)).toBe('4.0 MB');
    expect(formatBytes(180 * 1024)).toBe('180 KB');
    expect(formatBytes(999)).toBe('999 B');
    expect(beforeAfterLine(4.02 * 1024 * 1024, 180 * 1024)).toBe('4.0 MB → 180 KB');
  });
});
