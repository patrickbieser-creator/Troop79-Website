/**
 * /admin/news/articles — Articles table view.
 *
 * Server Component. Filter/sort/page state lives in the URL (bookmarkable),
 * same convention as advancement/ledger/page.tsx.
 *
 * Query params:
 *   q          — search text across title, excerpt
 *   type        — news|event|recognition
 *   status      — draft|published
 *   archived=1  — the Archived TAB: shows archived posts INSTEAD of current
 *                 ones. This used to be a "Show archived" checkbox that mixed
 *                 the two together, which meant there was no way to look at
 *                 just the archive.
 *   sort        — title|type|status|author|date
 *   dir         — asc|desc
 *   page        — 1-based page number (25 rows per page)
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import type { Article, ArticleType, ArticleStatus } from '@/lib/supabase/types';
import { ArticlesTabs } from './articles-tabs';
import { AddButton } from '../../_components/add-button';
import { PageTitle } from '../../_components/page-title';
import { ArticlesToolbar } from './articles-toolbar';
import { ArticlesTable } from './articles-table';
import { FrontPageOrder, type FrontPageItem } from './front-page-order';
import { loadPromotedEntries } from '@/lib/home-feed';
import styles from './articles.module.css';

const PAGE_SIZE = 25;

type SortKey = 'title' | 'type' | 'status' | 'author' | 'date';

interface SearchParams {
  q?: string;
  type?: string;
  status?: string;
  archived?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

const SORT_TO_COLUMN: Record<SortKey, string> = {
  title: 'title',
  type: 'type',
  status: 'status',
  author: 'author_name',
  date: 'published_at'
};

function parseSearch(sp: SearchParams) {
  const sortRaw = (sp.sort ?? 'date') as SortKey;
  const sort: SortKey = (Object.keys(SORT_TO_COLUMN) as SortKey[]).includes(sortRaw) ? sortRaw : 'date';
  const dir: 'asc' | 'desc' = sp.dir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  return {
    q: (sp.q ?? '').trim(),
    type: (sp.type ?? '').trim() as ArticleType | '',
    status: (sp.status ?? '').trim() as ArticleStatus | '',
    archived: sp.archived === '1',
    sort,
    dir,
    page
  };
}

export interface ArticleRowVM extends Article {
  tagNames: string[];
}

async function loadArticles(parsed: ReturnType<typeof parseSearch>) {
  const supabase = createAdminClient();

  let q = supabase
    .from('articles')
    .select('*, article_categories(category_label)', { count: 'exact' });

  // Exclusive, not additive: the Archived tab shows archived posts only.
  q = parsed.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  if (parsed.type) q = q.eq('type', parsed.type);
  if (parsed.status) q = q.eq('status', parsed.status);
  if (parsed.q) {
    const pat = `%${parsed.q}%`;
    q = q.or(`title.ilike.${pat},excerpt.ilike.${pat}`);
  }
  q = q.order(SORT_TO_COLUMN[parsed.sort], { ascending: parsed.dir === 'asc', nullsFirst: false });

  const from = (parsed.page - 1) * PAGE_SIZE;
  q = q.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await q;
  if (error) return { rows: [] as ArticleRowVM[], total: 0 };

  // Categories from the ONE taxonomy (2026-08-21) — still surfaced as
  // `tagNames` so the row view-model and table don't churn.
  type RawRow = Article & { article_categories: { category_label: string }[] };
  const rows: ArticleRowVM[] = ((data ?? []) as RawRow[]).map((r) => ({
    ...r,
    tagNames: (r.article_categories ?? []).map((ac) => ac.category_label)
  }));
  return { rows, total: count ?? 0 };
}

/**
 * Row counts for both tabs, under the CURRENT search and status filters — so
 * "Archived 2" after a search means two matches in the archive, not two archived
 * posts overall. Same rule the Calendar's tab counts follow.
 *
 * Two head-only count queries; no rows come back.
 */
/**
 * Stories submitted from /news/submit and not yet dealt with.
 *
 * Deliberately NOT filtered by the current search or tab, unlike the tab
 * counts: this is a "something is waiting for you" signal, and a signal that
 * disappears when you happen to be searching for something else is not a
 * signal. Same reasoning as the dashboard's pending change-requests notice.
 */
async function countPending(): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('archived_at', null);
  return count ?? 0;
}

async function loadTabCounts(parsed: ReturnType<typeof parseSearch>) {
  const supabase = createAdminClient();

  const build = (archived: boolean) => {
    let q = supabase.from('articles').select('id', { count: 'exact', head: true });
    q = archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
    if (parsed.type) q = q.eq('type', parsed.type);
    if (parsed.status) q = q.eq('status', parsed.status);
    if (parsed.q) {
      const pat = `%${parsed.q}%`;
      q = q.or(`title.ilike.${pat},excerpt.ilike.${pat}`);
    }
    return q;
  };

  const [current, archived] = await Promise.all([build(false), build(true)]);
  return { current: current.count ?? 0, archived: archived.count ?? 0 };
}

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/news/articles${qs ? `?${qs}` : ''}`;
}

export default async function ArticlesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = parseSearch(raw);
  // This page previously had no guard of its own — it leaned on the proxy and
  // then read the leader cookie for a display name. Both are now the actor
  // (Phase C, 2026-08-16).
  const [{ rows, total }, tabCounts, actor, pendingCount, frontPage] = await Promise.all([
    loadArticles(parsed),
    loadTabCounts(parsed),
    requireCapability('news.write'),
    countPending(),
    loadFrontPage()
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (parsed.page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(parsed.page * PAGE_SIZE, total);

  return (
    <>
      <PageTitle
        title="News"
        sub={
          <>
            Announcements, opportunities, and stories for the public site &mdash; anything worth
            publishing that isn&rsquo;t a troop calendar event (those promote themselves from the
            Calendar). Scouts draft; leaders review and publish. <strong>Archive</strong> hides a
            post from the public site without deleting it.
          </>
        }
      />

      {pendingCount > 0 && parsed.status !== 'pending' && (
        <div className={styles.pendingNotice}>
          <strong>
            {pendingCount} {pendingCount === 1 ? 'story' : 'stories'} submitted for review
          </strong>{' '}
          &mdash; sent in from the family side of the site. Open one to edit it, then Publish.{' '}
          <Link href={urlWith(raw, { status: 'pending', archived: '', page: '' })}>
            Review {pendingCount === 1 ? 'it' : 'them'} →
          </Link>
        </div>
      )}

      <div className={styles.tabsRow}>
        <ArticlesTabs
          archived={parsed.archived}
          currentCount={tabCounts.current}
          archivedCount={tabCounts.archived}
          // Switching tabs keeps search and status but drops the page number —
          // page 3 of Current is rarely page 3 of Archived.
          hrefFor={(archived) => urlWith(raw, { archived: archived ? '1' : '', page: '' })}
        />
        {/* Shared AddButton (Phase A, 2026-08-21) — D-159: green, far right,
            always visible; "Add" is the most-clicked action here, so it's a
            direct link, not an extra click through an Actions ▾. */}
        <AddButton href="/admin/news/articles/new">+ Add News</AddButton>
      </div>

      {!parsed.archived && <FrontPageOrder ordered={frontPage.ordered} available={frontPage.available} />}

      <ArticlesToolbar
        q={parsed.q}
        type={parsed.type}
        status={parsed.status}
        sort={parsed.sort}
        dir={parsed.dir}
      />

      <ArticlesTable
        rows={rows}
        sp={raw}
        sort={parsed.sort}
        dir={parsed.dir}
        sessionName={actor.label}
      />

      <div className={styles.pager}>
        <Link
          href={urlWith(raw, { page: String(parsed.page - 1) })}
          className={`${styles.pagerBtn} ${parsed.page <= 1 ? styles.pagerBtnDisabled : ''}`}
          aria-disabled={parsed.page <= 1}
        >
          ← Previous
        </Link>
        <Link
          href={urlWith(raw, { page: String(parsed.page + 1) })}
          className={`${styles.pagerBtn} ${parsed.page >= totalPages ? styles.pagerBtnDisabled : ''}`}
          aria-disabled={parsed.page >= totalPages}
        >
          Next →
        </Link>
        <span>
          Showing {pageStart}–{pageEnd} of {total} · page {parsed.page} / {totalPages}
        </span>
      </div>
    </>
  );
}

/**
 * The front-page panel's data: everything currently featured (articles +
 * promoted events) in featured_order, plus the candidates a leader can add —
 * the newest published articles and every in-window promoted event.
 */
type FrontPageCandidate = FrontPageItem & { featured: boolean; order: number | null };

async function loadFrontPage(): Promise<{ ordered: FrontPageItem[]; available: FrontPageItem[] }> {
  const supabase = createAdminClient();
  const [{ data: arts }, promoted] = await Promise.all([
    supabase
      .from('articles_public')
      .select('id, title, featured, featured_order, published_at')
      .order('published_at', { ascending: false })
      .limit(40),
    loadPromotedEntries()
  ]);
  const articleItems: FrontPageCandidate[] = ((arts ?? []) as {
    id: number;
    title: string;
    featured: boolean;
    featured_order: number | null;
  }[]).map((a) => ({
    key: `a${a.id}`,
    kind: 'article' as const,
    id: a.id,
    label: `${a.title} · news`,
    featured: a.featured,
    order: a.featured_order
  }));
  const eventItems: FrontPageCandidate[] = promoted.map((e) => ({
    key: `e${e.id}`,
    kind: 'event' as const,
    id: e.id,
    label: `${e.title} · event ${e.entry_date}`,
    featured: e.featured,
    order: e.featured_order ?? null
  }));
  const all = [...articleItems, ...eventItems];
  const strip = (c: FrontPageCandidate): FrontPageItem => ({ key: c.key, kind: c.kind, id: c.id, label: c.label });
  const ordered = all
    .filter((i) => i.featured)
    .sort((x, y) => (x.order ?? 9999) - (y.order ?? 9999))
    .map(strip);
  const available = all.filter((i) => !i.featured).map(strip);
  return { ordered, available };
}
