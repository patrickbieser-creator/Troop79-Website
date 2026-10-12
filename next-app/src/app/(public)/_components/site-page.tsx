import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { actorHas, resolveAdminActor } from '@/lib/admin-actor';
import { loadSitePage, loadSitePagePreview, type SitePage } from '@/lib/site-pages';
import { PageContent } from '@/lib/article-body/PageContent';
import { Notice } from '@/app/_components/notice';
import shell from '@/app/_components/news-cards.module.css';

/**
 * One managed page, as the public sees it (Plans/Content-Managed-Pages.md): the site's section-header bar over
 * the headline / lede / body / sidebar, all from a `site_pages` row. /join, /about and the catch-all share it.
 */

/**
 * Public lookup first; if it misses and the visitor can write news (the Pages admin's own capability), fall
 * back to the any-status row so "Preview (unpublished)" works — the news/[slug] pattern. Anyone else gets the
 * same 404 a guessed address always got. The cookie read happens only on a miss, so a published page stays
 * cacheable.
 */
export async function loadPageForVisitor(path: string): Promise<{ page: SitePage | null; preview: boolean }> {
  const page = await loadSitePage(path);
  if (page) return { page, preview: false };
  if (!actorHas(await resolveAdminActor(), 'news.write')) return { page: null, preview: false };
  return { page: await loadSitePagePreview(path), preview: true };
}

export async function sitePageMetadata(path: string): Promise<Metadata> {
  const { page, preview } = await loadPageForVisitor(path);
  if (!page) return {};
  // The title is the section label ("Join Troop 79"); add the site name only when it isn't already there.
  const title = page.title.includes('Troop 79') ? page.title : `${page.title} — Troop 79`;
  return {
    title,
    description: page.meta_description || undefined,
    ...(preview ? { robots: { index: false, follow: false } } : {})
  };
}

/** The page for `path` as JSX, or a 404. Called by the three public routes (an async function, not a component, so tests can await it). */
export async function renderSitePage(path: string) {
  const { page, preview } = await loadPageForVisitor(path);
  if (!page) notFound();
  return (
    <>
      {preview && (
        <Notice tone="info">
          Preview — this page is <strong>{page.status}</strong> and not visible to the public.
        </Notice>
      )}
      <div className={shell.sectionHeader}>
        <span className={shell.sectionLabel}>{page.title}</span>
        <span className={shell.sectionDate}>Milwaukee, Wisconsin</span>
      </div>
      <main className={shell.mainContent}>
        <PageContent headline={page.headline} lede={page.lede} bodyMd={page.body_md} sidebarMd={page.sidebar_md} />
      </main>
    </>
  );
}
