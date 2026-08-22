import { createAdminClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';
import { buildRobotsTxt, loadSeoSettings, resolveSeo } from '@/lib/seo';

/**
 * /robots.txt — EDITABLE (Patrick, 2026-08-22: "implement and make available
 * editing of the robots.txt").
 *
 * A Route Handler rather than Next's `app/robots.ts` convention, deliberately:
 * that convention wants a structured object, and what a leader edits in
 * Lookups & Admin is the actual text of the file. Serving the text they wrote
 * means what they see in the editor is byte-for-byte what a crawler gets.
 *
 * A DB failure degrades to the built-in default rather than 500ing — an
 * absent robots.txt is a worse outcome than a slightly stale one, and
 * loadSeoSettings() already swallows read errors into an empty map (which
 * resolves to the default).
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const origin = siteUrl();
  const settings = await loadSeoSettings(createAdminClient());
  const body = buildRobotsTxt(resolveSeo(settings, 'seo.robots_txt'), `${origin.replace(/\/+$/, '')}/sitemap.xml`);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Crawlers re-read robots.txt often; an hour keeps an edit from taking a
      // day to land without making this a hot path.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}
