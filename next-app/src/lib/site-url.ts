/**
 * Canonical public origin for absolute URLs (the .ics feed, subscribe links).
 *
 * NEXT_PUBLIC_SITE_URL still wins when set, but production defaults to the
 * real domain — the var was never configured in Vercel, and the old
 * 'http://localhost:3000' fallback shipped to families in the Subscribe
 * links (caught 2026-07-12, the day troop-79.com went live).
 */
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === 'production' ? 'https://www.troop-79.com' : 'http://localhost:3000')
  );
}
