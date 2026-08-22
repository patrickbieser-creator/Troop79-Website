import type { MetadataRoute } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { siteUrl } from '@/lib/site-url';
import { buildSitemap, loadSeoSettings, resolveSeo, seoFlagOn, type SitemapInput } from '@/lib/seo';

/**
 * /sitemap.xml — generated from live content (Patrick, 2026-08-22).
 *
 * Next's file convention: this module IS the route. What goes in it is decided
 * by lib/seo.ts's buildSitemap(), which is pure and tested — this file only
 * fetches rows. In particular the PII rule lives there, not here: individual
 * scout pages are advertised only when a leader turns on the setting in
 * Lookups & Admin, and NEVER_SITEMAPPED paths cannot be added at all.
 *
 * force-dynamic for the same reason /advancement carries it:
 * with no Dynamic API in the module Next would prerender it once at build and
 * a new article or event would be missing from the sitemap until the next
 * deploy — the exact failure this feature exists to prevent. Revalidation is
 * cheap: it is a handful of indexed reads.
 *
 * Reads paginate through fetchAllRows(). articles and calendar_entries are
 * both past PostgREST's 1000-row default cap territory as history grows, and
 * a silently truncated sitemap is invisible — it just quietly stops listing
 * the older half of the site.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const supabase = createAdminClient();

  const [settings, articles, events, categories, meritBadges, ranks, scouts] = await Promise.all([
    loadSeoSettings(supabase),
    fetchAllRows<{ slug: string; updated_at: string | null }>((from, to) =>
      supabase.from('articles_public').select('slug, updated_at').range(from, to)
    ),
    // Every PUBLISHED entry, including on_calendar=false ones: those are the
    // news-shaped external opportunities, and they still have an /events page.
    fetchAllRows<{ id: number; updated_at: string | null }>((from, to) =>
      supabase.from('calendar_entries').select('id, updated_at').eq('status', 'published').range(from, to)
    ),
    fetchAllRows<{ slug: string }>((from, to) =>
      supabase.from('calendar_categories').select('slug').range(from, to)
    ),
    fetchAllRows<{ id: string }>((from, to) => supabase.from('merit_badges').select('id').range(from, to)),
    fetchAllRows<{ id: string }>((from, to) => supabase.from('ranks').select('id').range(from, to)),
    fetchAllRows<{ id: string }>((from, to) =>
      supabase.from('scouts').select('id').eq('active', true).range(from, to)
    )
  ]);

  const input: SitemapInput = {
    origin,
    articles: articles ?? [],
    events: events ?? [],
    categories: (categories ?? []).filter((c) => !!c.slug),
    meritBadges: meritBadges ?? [],
    libraryRanks: (ranks ?? []).map((r) => ({ path: `/library/rank/${r.id}` })),
    indexScoutPages: seoFlagOn(resolveSeo(settings, 'seo.index_scout_pages')),
    scouts: scouts ?? []
  };

  return buildSitemap(input).map((e) => ({
    url: e.url,
    lastModified: e.lastModified ? new Date(e.lastModified) : undefined,
    changeFrequency: e.changeFrequency,
    priority: e.priority
  }));
}
