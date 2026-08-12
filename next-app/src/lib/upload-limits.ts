/**
 * Shared upload guards for Bunny-backed file uploads.
 *
 * Extracted from news/media/actions.ts when the Resource Library gained
 * document uploads (Plans/Library-Admin-Resource-Entry.md): images and PDFs
 * take different allow-lists but must not drift apart on size handling or
 * error wording, and a pure guard is testable without a network or a Bunny
 * account.
 */

export const IMAGE_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

/**
 * PDF only, deliberately. Word/PowerPoint originals are editable documents
 * that families can't reliably open in a browser; the troop's own handouts go
 * out as PDFs, and anything else can still be linked by URL.
 */
export const DOCUMENT_UPLOAD_TYPES: ReadonlySet<string> = new Set(['application/pdf']);

/** 12MB — leaves headroom under the 15MB Server Action body limit. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const TYPE_LABEL: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'application/pdf': 'PDF'
};

function allowedLabel(allowed: ReadonlySet<string>): string {
  return [...allowed].map((t) => TYPE_LABEL[t] ?? t).join(', ');
}

/**
 * Validates one upload against an allow-list and the size cap. Returns a
 * human-readable problem, or null when the file is acceptable. Takes the two
 * fields it needs rather than a File, so tests don't need a DOM.
 */
export function checkUpload(
  file: { type: string; size: number },
  allowed: ReadonlySet<string>,
  maxBytes: number = MAX_UPLOAD_BYTES
): string | null {
  if (!allowed.has(file.type)) {
    return `Unsupported file type — allowed: ${allowedLabel(allowed)}.`;
  }
  if (file.size > maxBytes) {
    return `File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`;
  }
  return null;
}
