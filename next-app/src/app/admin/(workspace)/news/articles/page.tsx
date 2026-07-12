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
 *   archived=1  — include archived articles (hidden by default)
 *   sort        — title|type|status|author|date
 *   dir         — asc|desc
 *   page        — 1-based page number (25 rows per page)
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import type { Article, ArticleType, ArticleStatus } from '@/lib/supabase/types';
import { ArticlesToolbar } from './articles-toolbar';
import { ArticlesTable } from './articles-table';
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
    .select('*, article_tags(tags(id, name))', { count: 'exact' });

  if (!parsed.archived) q = q.is('archived_at', null);
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

  type RawRow = Article & { article_tags: { tags: { id: number; name: string } | null }[] };
  const rows: ArticleRowVM[] = ((data ?? []) as RawRow[]).map((r) => ({
    ...r,
    tagNames: (r.article_tags ?? []).map((at) => at.tags?.name).filter((n): n is string => !!n)
  }));
  return { rows, total: count ?? 0 };
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
  const [{ rows, total }, jar] = await Promise.all([loadArticles(parsed), cookies()]);
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (parsed.page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(parsed.page * PAGE_SIZE, total);

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>Articles</h1>
          <p>
            News, Events, and Recognition posts for the public site. Scouts draft;
            leaders review and publish. <strong>Archive</strong> hides a post from
            the public site without deleting it.
          </p>
        </div>
        <Link href="/admin/news/articles/new" className={styles.newBtn}>
          + New Article
        </Link>
      </div>

      <ArticlesToolbar
        q={parsed.q}
        type={parsed.type}
        status={parsed.status}
        archived={parsed.archived}
        sort={parsed.sort}
        dir={parsed.dir}
      />

      <ArticlesTable
        rows={rows}
        sp={raw}
        sort={parsed.sort}
        dir={parsed.dir}
        sessionRole={session?.role ?? 'scout'}
        sessionName={session?.leader ?? ''}
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
