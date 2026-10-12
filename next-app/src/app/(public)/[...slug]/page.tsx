import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { renderSitePage, sitePageMetadata } from '../_components/site-page';

/**
 * Every other content-managed page (Plans/Content-Managed-Pages.md): any published `site_pages` row whose path
 * isn't a code route. Next resolves the specific routes (/events, /news/…, /join, /about…) first, so this only
 * ever sees addresses nothing else claims — and the Pages admin refuses a top-level slug that names a code
 * route (lib/site-pages-tree isReservedTopLevelSlug), so a page can never be created that this would shadow.
 * ISR like the other public pages; a save expires the `site-pages` tag and the page's own path.
 */
export const revalidate = 1800;

/** Path segments are slugs (a-z, 0-9, hyphen); anything else can't be a row, so skip the database. */
function pathOf(slug: string[]): string | null {
  return slug.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) ? `/${slug.join('/')}` : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const path = pathOf((await params).slug);
  return path ? sitePageMetadata(path) : {};
}

export default async function SitePage({ params }: { params: Promise<{ slug: string[] }> }) {
  const path = pathOf((await params).slug);
  if (!path) notFound();
  return renderSitePage(path);
}
