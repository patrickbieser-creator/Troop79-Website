/**
 * Pure helpers for the nav's account control (account-control.tsx). A plain
 * module, not the 'use client' file, so a server component (the public
 * styleguide) can call them and get values rather than client references.
 */
import { safeInternalPath } from '@/lib/safe-redirect';

function words(label: string): string[] {
  return label.trim().replace(/\./g, '').split(/\s+/).filter(Boolean);
}

/** "Patrick Bieser" → "Patrick B" (first name + last initial, no period). */
export function accountShortName(label: string): string {
  const w = words(label);
  if (w.length < 2) return w[0] ?? label.trim();
  return `${w[0]} ${w[w.length - 1][0].toUpperCase()}`;
}

/** "Patrick Bieser" → "PB", for the phone's circle. */
export function accountInitials(label: string): string {
  const w = words(label);
  if (w.length === 0) return '';
  const first = w[0][0];
  const last = w.length > 1 ? w[w.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

/** The path + query the visitor is on, guarded to stay on this site. */
export function currentPath(pathname: string, search: string): string {
  const q = search.startsWith('?') ? search.slice(1) : search;
  return safeInternalPath(q ? `${pathname}?${q}` : pathname, '/');
}

/** /signin, carrying the page to come back to (omitted on the home page). */
export function signInHref(pathname: string, search: string): string {
  const back = currentPath(pathname, search);
  return back === '/' ? '/signin' : `/signin?next=${encodeURIComponent(back)}`;
}

/** Sign-in screens carry their own flow; the control would only distract. */
export function isSignInRoute(pathname: string): boolean {
  return pathname === '/signin' || pathname.startsWith('/signin/');
}
