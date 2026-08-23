/**
 * Resize-before-upload (Plans/Photo-Thumbnails.md).
 *
 * /photos served ~62 MB of album covers — 26 of them PNG *screenshots* of
 * 1–4 MB rendered into a ~400 px box — because `uploadToBunny` sends exactly
 * the bytes a leader chose and the Bunny Optimizer is not enabled. The fix
 * happens in the browser, before a single byte crosses the wire: decide
 * (pure, tested here) and then draw to a canvas (thin, verified by eye).
 *
 * The decision, in order:
 *   - not a still image (PDF, GIF — animation would flatten) → null: leave it;
 *   - unknown dimensions (decode failed) → null: don't guess;
 *   - already ≤ 250 KB → null: BYTE-IDENTICAL passthrough, whatever its
 *     pixel size (the 0.20 MB cover must not be touched, and a big flat PNG
 *     that is already tiny gains nothing from a JPEG pass);
 *   - otherwise: long edge = min(source, target) — never upscale — and
 *     JPEG q≈0.82, except a source WITH transparency, which stays PNG (a logo
 *     with alpha must not get a black box behind it).
 *
 * Targets: 1200 px for covers (~2× the largest cover box, the retina case),
 * 1600 px for general media. WebP would be smaller still, but JPEG keeps
 * "right-click, save" behaving the way families expect from a photo — revisit
 * if 250 KB is missed in practice.
 */

export const TARGET_BYTES = 250 * 1024;
export const COVER_LONG_EDGE = 1200;
export const GENERAL_LONG_EDGE = 1600;
export const JPEG_QUALITY = 0.82;

export type ResizeKind = 'cover' | 'general';

export interface ImageMeta {
  /** MIME type as reported by the browser (File.type). */
  type: string;
  size: number;
  width: number;
  height: number;
  /** PNG sources only — sampled from the canvas by the browser helper. */
  hasAlpha?: boolean;
}

export interface ResizePlan {
  /** The output's long edge in px (never larger than the source's). */
  longEdge: number;
  mime: 'image/jpeg' | 'image/png';
  /** Canvas encoder quality (JPEG only; ignored for PNG). */
  quality: number;
}

/** Types the canvas path can re-encode without losing anything that matters. */
const RESIZABLE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function targetLongEdge(kind: ResizeKind): number {
  return kind === 'cover' ? COVER_LONG_EDGE : GENERAL_LONG_EDGE;
}

/** null = leave the file exactly as it is. */
export function resizePlan(meta: ImageMeta, opts: { kind: ResizeKind }): ResizePlan | null {
  if (!RESIZABLE_TYPES.has(meta.type)) return null;
  if (!(meta.width > 0 && meta.height > 0)) return null;
  if (meta.size <= TARGET_BYTES) return null;
  const target = targetLongEdge(opts.kind);
  const sourceLong = Math.max(meta.width, meta.height);
  return {
    longEdge: Math.min(sourceLong, target),
    mime: meta.hasAlpha ? 'image/png' : 'image/jpeg',
    quality: JPEG_QUALITY
  };
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** "4.0 MB → 180 KB" — the line that teaches the behaviour. */
export function beforeAfterLine(before: number, after: number): string {
  return `${formatBytes(before)} → ${formatBytes(after)}`;
}

/* ── Browser half ─────────────────────────────────────────────────────────── */

export interface PreparedUpload {
  file: File;
  /** Set when the file was re-encoded: the original byte count. */
  before: number | null;
  width: number | null;
  height: number | null;
}

function decode(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Cheap alpha probe: draw the image into a 64 px canvas and look for any
 *  pixel that is not fully opaque. Good enough to tell a logo from a
 *  screenshot; a photo with a stray translucent corner just stays PNG. */
function sampleHasAlpha(img: HTMLImageElement): boolean {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function renamed(name: string, mime: ResizePlan['mime']): string {
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) + ext;
}

/** Draws `file` at the plan's long edge and encodes it. Throws only if the
 *  canvas cannot encode — callers treat that as "upload the original". */
export async function resizeImageFile(file: File, plan: ResizePlan, img: HTMLImageElement): Promise<File> {
  const sourceLong = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, plan.longEdge / sourceLong);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, plan.mime, plan.quality));
  if (!blob) throw new Error('canvas encode failed');
  return new File([blob], renamed(file.name, plan.mime), { type: plan.mime, lastModified: file.lastModified });
}

/**
 * The one call the upload UIs make: decode, decide, resize-or-not. A
 * non-image, an undecodable file or a file that is already fine comes back
 * unchanged (`before: null`). Never throws — a failed resize falls back to
 * the original so resizing can't become a new way to lose an upload.
 */
export async function prepareImageForUpload(file: File, kind: ResizeKind): Promise<PreparedUpload> {
  if (!RESIZABLE_TYPES.has(file.type)) return { file, before: null, width: null, height: null };
  const img = await decode(file);
  if (!img) return { file, before: null, width: null, height: null };
  const meta: ImageMeta = {
    type: file.type,
    size: file.size,
    width: img.naturalWidth,
    height: img.naturalHeight,
    hasAlpha: file.type === 'image/png' ? sampleHasAlpha(img) : false
  };
  const plan = resizePlan(meta, { kind });
  if (!plan) return { file, before: null, width: meta.width, height: meta.height };
  try {
    let out = await resizeImageFile(file, plan, img);
    // Still over target as a JPEG? One step down in quality before giving up
    // — the heaviest screenshots land just past 250 KB at q0.82.
    if (plan.mime === 'image/jpeg' && out.size > TARGET_BYTES) {
      const lower = await resizeImageFile(file, { ...plan, quality: 0.72 }, img);
      if (lower.size < out.size) out = lower;
    }
    // A re-encode that somehow grew the file is not an improvement — keep the original.
    if (out.size >= file.size) return { file, before: null, width: meta.width, height: meta.height };
    const scale = Math.min(1, plan.longEdge / Math.max(meta.width, meta.height));
    return {
      file: out,
      before: file.size,
      width: Math.max(1, Math.round(meta.width * scale)),
      height: Math.max(1, Math.round(meta.height * scale))
    };
  } catch {
    return { file, before: null, width: meta.width, height: meta.height };
  }
}
