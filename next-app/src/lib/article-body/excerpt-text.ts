/**
 * A story's excerpt is inline markdown (links, bold, italic — see
 * ArticleExcerpt). Places that need plain text — the meta description,
 * Open Graph, Article JSON-LD — get it through here: link text kept, URLs
 * and emphasis marks dropped. Plain module on purpose (no 'use client'), so
 * server code and tests can both import it.
 */
export function excerptPlainText(md: string | null): string | null {
  if (md == null) return null;
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their words
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
