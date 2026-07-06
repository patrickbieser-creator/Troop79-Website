/**
 * Parsing + construction helpers for the three custom content-block tokens:
 * {{gallery: ...}}, {{gallerylink: ...}}, {{video: ...}}. Single images and
 * tables deliberately do NOT get a custom token — standard markdown
 * (`![alt](url "caption")` and GFM pipe tables) already covers them, so we
 * only invented syntax for the things markdown has no native construct for.
 *
 * Token grammar (whole-paragraph, case-insensitive type):
 *   {{gallery: url1::alt1 | url2::alt2 | url3::alt3}}
 *   {{gallerylink: url | caption | coverUrl}}
 *   {{video: url | caption}}
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

export type BlockType = 'gallery' | 'gallerylink' | 'video';

/** Matches an entire paragraph's text against `{{type: args}}`. Returns null if it isn't one. */
export function matchBlockToken(text: string): { type: BlockType; raw: string } | null {
  const m = /^\{\{\s*(gallery|gallerylink|video)\s*:\s*([\s\S]*)\}\}$/i.exec(text.trim());
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

export function buildVideoToken(url: string, caption?: string): string {
  return `{{video: ${url}${caption ? ` | ${caption}` : ''}}}`;
}
