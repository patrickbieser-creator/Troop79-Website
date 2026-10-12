import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { SITE_PAGE_COLUMNS, type SitePage } from '@/lib/site-pages-tree';

export type { SitePage } from '@/lib/site-pages-tree';

/**
 * Content-managed pages (Plans/Content-Managed-Pages.md): the public read of one page by path.
 *
 * Shaped like lib/site-settings.ts. `unstable_cache` keeps a page across requests under the `site-pages` tag;
 * the Pages admin's saves call `updateTag('site-pages')` AND `revalidatePath(path)`, so an edit shows within a
 * request or two. The hourly fallback covers an edit made outside the app (prod psql). `cache()` dedupes
 * within one request — generateMetadata and the page both ask. PUBLISHED rows only: a draft is invisible here
 * (visitors who can write news reach it through loadSitePagePreview instead).
 *
 * The cached value is the row or null — JSON, which is all Next serialises.
 */
const cachedPage = unstable_cache(
  async (path: string): Promise<SitePage | null> => {
    const { data } = await createAdminClient()
      .from('site_pages')
      .select(SITE_PAGE_COLUMNS)
      .eq('path', path)
      .eq('status', 'published')
      .maybeSingle();
    return (data as SitePage | null) ?? null;
  },
  ['site-page'],
  { tags: ['site-pages'], revalidate: 3600 }
);

export const loadSitePage = cache(async (path: string): Promise<SitePage | null> => cachedPage(path));

/** Any status, uncached — for the leader-only draft preview. */
export async function loadSitePagePreview(path: string): Promise<SitePage | null> {
  const { data } = await createAdminClient().from('site_pages').select(SITE_PAGE_COLUMNS).eq('path', path).maybeSingle();
  return (data as SitePage | null) ?? null;
}
