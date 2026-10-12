/**
 * Parsing + construction helpers for the custom content-block tokens:
 * {{gallery: ...}}, {{gallerylink: ...}}, {{video: ...}}, plus the two page blocks
 * {{cta: ...}} and {{stats: ...}} (content-managed pages, PageBody). Single images and
 * tables deliberately do NOT get a custom token — standard markdown
 * (`![alt](url "caption")` and GFM pipe tables) already covers them, so we
 * only invented syntax for the things markdown has no native construct for.
 *
 * Token grammar (whole-paragraph, case-insensitive type):
 *   {{gallery: url1::alt1 | url2::alt2 | url3::alt3}}
 *   {{gallerylink: url | caption | coverUrl}}
 *   {{video: url | caption}}
 *   {{cta: Headline | sub text | Label->/href | Label->/href}}
 *   {{stats: 2022::Founded | ~30::Scouts}}
 * Caption and coverUrl are always optional. The editor's toolbar constructs
 * these strings from picked Media records — authors are not expected to
 * hand-type them.
 */

export interface GalleryImage {
  url: string;
  alt: string;
}

export interface GalleryLinkData {
  url: string;
  caption: string | null;
  coverUrl: string | null;
  source: 'Google Photos' | 'Facebook' | 'Photo Album';
}

export interface VideoData {
  url: string;
  caption: string | null;
  embedUrl: string | null; // null if the URL isn't a recognized YouTube/Vimeo link
}

export type BlockType = 'gallery' | 'gallerylink' | 'video' | 'cta' | 'stats';

/** Matches an entire paragraph's text against `{{type: args}}`. Returns null if it isn't one. */
export function matchBlockToken(text: string): { type: BlockType; raw: string } | null {
  const m = /^\{\{\s*(gallery|gallerylink|video|cta|stats)\s*:\s*([\s\S]*)\}\}$/i.exec(text.trim());
  if (!m) return null;
  return { type: m[1].toLowerCase() as BlockType, raw: m[2].trim() };
}

export function parseGalleryToken(raw: string): GalleryImage[] {
  return raw
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, alt] = entry.split('::');
      return { url: (url ?? '').trim(), alt: (alt ?? '').trim() };
    })
    .filter((img) => img.url);
}

export function buildGalleryToken(images: GalleryImage[]): string {
  return `{{gallery: ${images.map((i) => `${i.url}::${i.alt}`).join(' | ')}}}`;
}

export function detectGalleryLinkSource(url: string): GalleryLinkData['source'] {
  try {
    const host = new URL(url).hostname;
    if (host.includes('photos.google.com') || host.includes('photos.app.goo.gl')) return 'Google Photos';
    if (host.includes('facebook.com') || host.includes('fb.com')) return 'Facebook';
  } catch {
    // not a valid absolute URL — fall through to generic label
  }
  return 'Photo Album';
}

export function parseGalleryLinkToken(raw: string): GalleryLinkData {
  const [urlPart, captionPart, coverPart] = raw.split('|');
  const url = (urlPart ?? '').trim();
  const caption = captionPart?.trim() || null;
  const coverUrl = coverPart?.trim() || null;
  return { url, caption, coverUrl, source: detectGalleryLinkSource(url) };
}

export function buildGalleryLinkToken(url: string, caption?: string, coverUrl?: string): string {
  const parts = [url, caption ?? '', coverUrl ?? ''];
  while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
  return `{{gallerylink: ${parts.join(' | ')}}}`;
}

/** Returns an embeddable iframe URL for a YouTube or Vimeo link, or null otherwise. */
export function toVideoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    // not a valid absolute URL
  }
  return null;
}

export function parseVideoToken(raw: string): VideoData {
  const [urlPart, captionPart] = raw.split('|');
  const url = (urlPart ?? '').trim();
  const caption = captionPart?.trim() || null;
  return { url, caption, embedUrl: toVideoEmbedUrl(url) };
}

/**
 * Page blocks (content-managed pages, PageBody) — authored by hand in the page
 * editor, not built by the toolbar (phase 2 adds insert buttons):
 *   {{cta: Headline | sub text | Label->/href | Label->/href}}
 *   {{stats: 2022::Founded | ~30::Scouts}}
 * The first button is the primary one; the rest render as ghost buttons. A
 * button with no `->` is dropped rather than rendered as a dead link.
 */
export interface CtaData {
  headline: string;
  sub: string;
  buttons: { label: string; href: string }[];
}

/** A CTA button skips react-markdown's URL sanitising: only a site path, http(s) or mailto may reach an href. */
const SAFE_CTA_HREF = /^(\/(?!\/)|https?:\/\/|mailto:)/i;

export function parseCtaToken(raw: string): CtaData {
  const [headline = '', sub = '', ...rest] = raw.split('|').map((p) => p.trim());
  const buttons = rest.flatMap((entry) => {
    const at = entry.lastIndexOf('->');
    if (at < 0) return [];
    const label = entry.slice(0, at).trim();
    const href = entry.slice(at + 2).trim();
    return label && SAFE_CTA_HREF.test(href) ? [{ label, href }] : [];
  });
  return { headline, sub, buttons };
}

export interface StatData {
  value: string;
  label: string;
}

export function parseStatsToken(raw: string): StatData[] {
  return raw
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf('::');
      return at < 0
        ? { value: entry, label: '' }
        : { value: entry.slice(0, at).trim(), label: entry.slice(at + 2).trim() };
    })
    .filter((s) => s.value);
}

export function buildVideoToken(url: string, caption?: string): string {
  return `{{video: ${url}${caption ? ` | ${caption}` : ''}}}`;
}

/**
 * Linked images (Plans/Article-Image-Flexibility.md, 2026-09-21) are native
 * markdown — `[![alt](src "caption")](href)` — never a token. What the link
 * MEANS decides how it opens and what the caption-less label says:
 *   full     — href is the image's own file: "View full size", new tab
 *              (the v1.126.1 proof-photo pattern)
 *   internal — a site path: ordinary navigation, same tab
 *   external — anywhere else: new tab + noopener
 */
export type ImageLinkKind = 'full' | 'internal' | 'external';

export function classifyImageLink(href: string, src: string): ImageLinkKind {
  if (href === src) return 'full';
  if (href.startsWith('/') && !href.startsWith('//')) return 'internal';
  return 'external';
}

/**
 * What the editor's image form reads and writes: plain markdown, `![alt](src
 * "caption")` wrapped in `[...](href)` when linked. Build and parse must
 * round-trip exactly — Edit → Save changes with nothing touched must not
 * rewrite the author's text.
 */
export interface ImageMarkdown {
  src: string;
  alt: string;
  caption: string | null;
  href: string | null;
}

const escapeAlt = (s: string) => s.replace(/([[\]\\])/g, '\\$1');
const escapeCaption = (s: string) => s.replace(/(["\\])/g, '\\$1');
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

export function buildImageMarkdown({ src, alt, caption, href }: ImageMarkdown): string {
  const img = `![${escapeAlt(alt)}](${src}${caption ? ` "${escapeCaption(caption)}"` : ''})`;
  return href ? `[${img}](${href})` : img;
}

/** The whole string must be exactly one (optionally linked) image, or null. */
export function parseImageMarkdown(raw: string): ImageMarkdown | null {
  const m =
    /^(\[)?!\[((?:\\.|[^[\]\\])*)\]\(\s*(\S+?)(?:\s+"((?:\\.|[^"\\])*)")?\s*\)(?:\]\(\s*(\S+?)\s*\))?$/.exec(
      raw.trim()
    );
  if (!m) return null;
  const [, open, alt, src, caption, href] = m;
  // An opening `[` needs its `](href)` and vice versa.
  if (!!open !== (href !== undefined)) return null;
  return { src, alt: unescape(alt), caption: caption ? unescape(caption) : null, href: href ?? null };
}

/** The label rendered in the caption slot when a linked image has no caption. */
export function imageLinkLabel(kind: ImageLinkKind): string {
  switch (kind) {
    case 'full':
      return 'View full size ↗';
    case 'external':
      return 'Open link ↗';
    case 'internal':
      return 'Open →';
  }
}
