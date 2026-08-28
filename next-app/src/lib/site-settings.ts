import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { loadSeoSettings } from '@/lib/seo';

/**
 * The `site_settings` read app code should use.
 *
 * Two layers (Plans/Performance-Review-2026-08-27.md #1, #8):
 * - `unstable_cache` keeps the rows across requests under the
 *   `site-settings` tag; the Lookups saves that change them call
 *   `updateTag('site-settings')`, so an edit shows on the next request. The
 *   public layout reads this on EVERY page — it was a database round trip
 *   per visit for a table that changes a few times a year.
 * - `cache()` dedupes within one request: the layout AND the page it wraps
 *   both need it, and each used to hand loadSeoSettings() a fresh client.
 *
 * The cached value is an array of pairs, not the Map — Next serialises the
 * cache entry as JSON and a Map would come back as `{}`.
 *
 * Lives apart from seo.ts, which a client component imports and so must stay
 * free of the server client. Route handlers that already hold a client keep
 * calling loadSeoSettings().
 */
const cachedSettingPairs = unstable_cache(
  async (): Promise<[string, string][]> => [...(await loadSeoSettings(createAdminClient()))],
  ['site-settings'],
  // Hourly fallback for edits made outside the app (prod psql).
  { tags: ['site-settings'], revalidate: 3600 }
);

export const loadSiteSettings = cache(async (): Promise<Map<string, string>> => new Map(await cachedSettingPairs()));
