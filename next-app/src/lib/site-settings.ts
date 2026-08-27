import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/server';
import { loadSeoSettings } from '@/lib/seo';

/** The request-scoped `site_settings` read app code should use: the public
 *  layout AND the page it wraps both need these, and `cache()` can't dedupe
 *  loadSeoSettings() when each caller hands it a fresh client
 *  (Plans/Performance-Review-2026-08-27.md #1). Lives apart from seo.ts,
 *  which a client component imports and so must stay free of the server
 *  client. Route handlers that already hold a client keep calling
 *  loadSeoSettings(). */
export const loadSiteSettings = cache(async (): Promise<Map<string, string>> =>
  loadSeoSettings(createAdminClient())
);
