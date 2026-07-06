'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { SessionRole } from '@/lib/leader-session';
import type { ArticleType, ArticleStatus } from '@/lib/supabase/types';
import type { ArticleRowVM } from './page';
import { publishArticle, archiveArticle, unarchiveArticle, deleteArticle, setFeatured } from './actions';
import styles from './articles.module.css';

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

const TYPE_LABEL: Record<ArticleType, string> = {
  news: 'News',
  event: 'Event',
  recognition: 'Recognition'
};
const TYPE_CLASS: Record<ArticleType, string> = {
  news: styles.pillNews,
  event: styles.pillEvent,
  recognition: styles.pillRecognition
};
const STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: 'Draft',
  published: 'Published'
};

function urlWith(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return `/admin/news/articles${qs ? `?${qs}` : ''}`;
}

interface Props {
  rows: ArticleRowVM[];
  sp: SearchParams;
  sort: SortKey;
  dir: 'asc' | 'desc';
  sessionRole: SessionRole;
  sessionName: string;
}

export function ArticlesTable({ rows, sp, sort, dir, sessionRole, sessionName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isLeader = sessionRole === 'leader';

  const sortLink = (key: SortKey, label: string) => {
    const isActive = sort === key;
    const nextDir = isActive && dir === 'desc' ? 'asc' : 'desc';
    return (
      <th key={key}>
        <Link href={urlWith(sp, { sort: key, dir: nextDir, page: '1' })}>{label}</Link>
      </th>
    );
  };

  function runAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        window.alert(res.error ?? 'That action failed.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {sortLink('title', 'Title')}
            {sortLink('type', 'Type')}
            {sortLink('status', 'Status')}
            {sortLink('author', 'Author')}
            {sortLink('date', 'Date')}
            <th>Tags</th>
            <th>Featured</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className={styles.empty}>
                {sp.q || sp.type || sp.status ? 'No articles match the current filters.' : 'No articles yet.'}
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const canEdit = isLeader || r.author_name === sessionName;
              return (
                <tr key={r.id} className={r.archived_at ? styles.archivedRow : ''}>
                  <td className={styles.titleCell}>
                    {canEdit ? (
                      <Link href={`/admin/news/articles/${r.id}`}>{r.title}</Link>
                    ) : (
                      r.title
                    )}
                  </td>
                  <td className={styles.nowrap}>
                    <span className={`${styles.pill} ${TYPE_CLASS[r.type]}`}>{TYPE_LABEL[r.type]}</span>
                  </td>
                  <td className={styles.nowrap}>
                    <span className={`${styles.pill} ${r.status === 'published' ? styles.pillPublished : styles.pillDraft}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                    {r.archived_at && <span className={`${styles.pill} ${styles.pillArchived}`}> Archived</span>}
                  </td>
                  <td className={styles.nowrap}>{r.author_name}</td>
                  <td className={styles.nowrap}>
                    {(r.published_at ?? r.created_at).slice(0, 10)}
                  </td>
                  <td className={styles.tagList}>{r.tagNames.join(', ') || '—'}</td>
                  <td className={styles.nowrap}>
                    {isLeader ? (
                      <input
                        type="checkbox"
                        checked={r.featured}
                        disabled={isPending}
                        aria-label={`Feature ${r.title}`}
                        onChange={(e) =>
                          runAction(() => setFeatured(r.id, e.target.checked, r.featured_order ?? 0))
                        }
                      />
                    ) : r.featured ? (
                      'Yes'
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.actionsCell}>
                    {isLeader && r.status === 'draft' && !r.archived_at && (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                        disabled={isPending}
                        onClick={() => runAction(() => publishArticle(r.id))}
                      >
                        Publish
                      </button>
                    )}
                    {isLeader && !r.archived_at && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={isPending}
                        onClick={() => runAction(() => archiveArticle(r.id))}
                      >
                        Archive
                      </button>
                    )}
                    {isLeader && r.archived_at && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={isPending}
                        onClick={() => runAction(() => unarchiveArticle(r.id))}
                      >
                        Unarchive
                      </button>
                    )}
                    {isLeader && (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                        disabled={isPending}
                        onClick={() => {
                          if (window.confirm(`Permanently delete "${r.title}"? This cannot be undone.`)) {
                            runAction(() => deleteArticle(r.id));
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
