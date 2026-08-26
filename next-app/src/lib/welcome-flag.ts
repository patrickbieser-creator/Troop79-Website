/**
 * Signals a first-successful-sign-in on an event signup page, so it can show
 * the one-time passkey offer (Plans/Verified-Signup.md, Phase A: "the offer
 * renders when … signalled via `?welcome=1` on the `next` redirect").
 *
 * Pure and narrow on purpose: it only ever adds the flag to an /events/ path,
 * and it is meant to run AFTER safeInternalPath() has already resolved the
 * redirect target — this never parses or re-validates the path itself, so it
 * carries none of that guard's security properties on its own.
 */
export function withWelcomeFlag(path: string): string {
  if (!path.startsWith('/events/')) return path;

  // Split off any hash first so `welcome=1` lands in the query, not after a
  // fragment (`/events/1/signup#jobs` -> `...?welcome=1#jobs`, never
  // `...#jobs?welcome=1`).
  const hashIndex = path.indexOf('#');
  const base = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}welcome=1${hash}`;
}
