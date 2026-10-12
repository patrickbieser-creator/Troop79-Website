import type { Metadata } from 'next';
import { renderSitePage, sitePageMetadata } from '../_components/site-page';

/**
 * /about renders from its `site_pages` row (Plans/Content-Managed-Pages.md) — edited at /admin/news/pages, no JSX
 * fallback: a missing or draft row is a 404. ISR like the other public pages; the Pages admin's save expires the
 * `site-pages` tag and this path, so an edit shows within seconds.
 */
export const revalidate = 1800;

export function generateMetadata(): Promise<Metadata> {
  return sitePageMetadata('/about');
}

export default async function Page() {
  return renderSitePage('/about');
}
