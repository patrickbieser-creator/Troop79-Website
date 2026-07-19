/**
 * Same-origin redirect guard for user-supplied `next` params.
 *
 * The obvious check — `next.startsWith('/') && !next.startsWith('//')` — is
 * NOT sufficient. The WHATWG URL parser (and every browser resolving a
 * Location header) treats a backslash as a slash for special schemes, so
 * "/\evil.com" resolves to https://evil.com/ and sails past a prefix test.
 * On a login/gate form that is an off-site phishing redirect aimed at the
 * very password being typed.
 *
 * Resolving against a sentinel origin and comparing origins catches every
 * variant — absolute URLs, protocol-relative "//host", and the backslash
 * trick — instead of trying to enumerate bad prefixes.
 */

const SENTINEL_ORIGIN = 'http://internal.invalid';

export function safeInternalPath(
  next: string | null | undefined,
  fallback: string
): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, SENTINEL_ORIGIN);
    // Anything that escapes the sentinel origin was trying to leave the site.
    if (url.origin !== SENTINEL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
