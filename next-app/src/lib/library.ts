/**
 * Resource Library — shared shapes and pure helpers (Plans/Resource-Library.md).
 *
 * Client-safe: no next/headers, no supabase — usable from Client Components,
 * Server Components, Server Actions, and tests alike. DB access lives in
 * lib/library-data.ts.
 *
 * ADDRESSING (tech-lead review 2026-07-21): placements/notes/submissions key
 * off (target_kind, target_key) using the SAME composite codes the ledger
 * uses — `rank_req` keys are '{rankId}-{code}' (never bare code: "9a"
 * legitimately repeats across ranks), `mb_req` keys are '{mbId}-{code}',
 * `mb` is the badge id alone, `topic` is the shelf slug.
 */

export type LibraryTargetKind = 'rank_req' | 'mb' | 'mb_req' | 'topic';

export type ResourceKind = 'link' | 'video' | 'document' | 'image' | 'post';

export type ResourceStatus = 'pending' | 'published' | 'archived';

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  link: 'Link',
  video: 'Video',
  document: 'Document',
  image: 'Image',
  post: 'Troop Post'
};

export function rankReqKey(rankId: string, code: string): string {
  return `${rankId}-${code}`;
}

export function mbReqKey(mbId: string, code: string): string {
  return `${mbId}-${code}`;
}

/** Splits a rank_req target_key back into (rankId, code) given the known
 *  rank ids — rank ids themselves contain hyphens ('first-class'), so a
 *  blind split on the first '-' would be wrong. */
export function splitRankReqKey(
  key: string,
  rankIds: string[]
): { rankId: string; code: string } | null {
  for (const rankId of rankIds) {
    if (key.startsWith(`${rankId}-`)) {
      return { rankId, code: key.slice(rankId.length + 1) };
    }
  }
  return null;
}

/** Display host chip for an outbound URL — presentation only, never trust. */
export function detectHost(url: string | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes('youtube.com') || host === 'youtu.be') return 'YouTube';
  if (host.includes('docs.google.com') || host.includes('drive.google.com')) return 'Google Doc';
  if (host.includes('amazon.')) return 'Amazon';
  if (host.includes('scouting.org')) return 'BSA';
  if (url.toLowerCase().endsWith('.pdf')) return 'PDF';
  return host.replace(/^www\./, '');
}

/** Best-guess resource kind from a URL — a default for the submit form and
 *  queue; the webmaster can always override before publishing. */
export function inferKind(url: string | null): ResourceKind {
  if (!url) return 'post';
  const lower = url.toLowerCase();
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'link';
  }
  if (host.includes('youtube.com') || host === 'youtu.be' || host.includes('vimeo.com')) {
    return 'video';
  }
  if (
    host.includes('docs.google.com') ||
    host.includes('drive.google.com') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.ppt') ||
    lower.endsWith('.pptx')
  ) {
    return 'document';
  }
  if (/\.(jpe?g|png|gif|webp|heic)$/.test(lower)) return 'image';
  return 'link';
}

/** Extracts a YouTube video id from any of the common URL shapes
 *  (watch?v=, youtu.be/, /shorts/, /embed/, /live/) — null for anything else. */
export function youtubeVideoId(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v');
    } else {
      const m = parsed.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
      id = m ? m[2] : null;
    }
  }
  // Video ids are 11 URL-safe chars — reject anything else rather than
  // building a broken image URL.
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/**
 * Display thumbnail for a resource: an explicit thumbnail_url wins; otherwise
 * YouTube links get the video's own thumbnail (a static image from ytimg —
 * NOT an embed; the no-iframe decision stands). Null = render the kind icon.
 */
export function resourceThumbnail(resource: {
  thumbnail_url: string | null;
  url: string | null;
}): string | null {
  // Same http(s)-only guard as resource URLs (qa-lead 2026-07-21): this value
  // lands in an <img src>, and no write path validates thumbnail_url yet —
  // guard at render so a future admin thumbnail field can't regress it.
  if (resource.thumbnail_url && /^https?:\/\//i.test(resource.thumbnail_url)) {
    return resource.thumbnail_url;
  }
  const id = youtubeVideoId(resource.url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** Icon glyph per resource kind — used by both public cards and admin queue. */
export const RESOURCE_KIND_ICON: Record<ResourceKind, string> = {
  link: '🔗',
  video: '▶',
  document: '📄',
  image: '🖼',
  post: '📝'
};
