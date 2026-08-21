'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ArticleStatus } from '@/lib/supabase/types';
import type { ArticleRowVM } from './page';
import {
  publishArticle,
  archiveArticle,
  unarchiveArticle,
  deleteArticle,
  cloneArticle,
  setFeatured
} from './actions';
import styles from './articles.module.css';
import { Badge } from '../../_components/badge';

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

const STATUS_LABEL: Record<ArticleStatus, string> = {
  pending: 'Submitted',
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
  sessionName: string;
}

export function ArticlesTable({ rows, sp, sort, dir, sessionName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  // Everyone who reaches this screen holds news.write; the scout tier that
  // this once distinguished was retired in Phase C (2026-08-16).
  const isLeader = true;

  const sortLink = (key: SortKey, label: string) => {
    const isActive = sort === key;
    const nextDir = isActive && dir === 'desc' ? 'asc' : 'desc';
    return (
      <th key={key}>
        <Link href={urlWith(sp, { sort: key, dir: nextDir, page: '1' })}>{label}</Link>
      </th>
    );
  };

  /**
   * Failures render inline on the offending row, the way the Calendar list
   * reports them — a window.alert makes you dismiss a modal before you can see
   * which row it was about, and it disappears the moment you do.
   */
  function runAction(id: number, action: () => Promise<{ ok: boolean; error?: string }>) {
    setRowErr(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setRowErr({ id, msg: res.error ?? 'That action failed.' });
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
              <td colSpan={7} className={styles.empty}>
                {sp.q || sp.type || sp.status
                  ? 'No posts match the current filters.'
                  : sp.archived === '1'
                    ? 'Nothing archived yet. Archiving hides a post from the public site without deleting it.'
                    : 'No posts yet.'}
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
                    {rowErr?.id === r.id && <div className={styles.rowError}>{rowErr.msg}</div>}
                  </td>
                  <td className={styles.nowrap}>
                    <Badge
                      variant={
                        r.status === 'published'
                          ? 'success'
                          : r.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {STATUS_LABEL[r.status]}
                    </Badge>
                    {r.archived_at && (
                      <>
                        {' '}
                        <Badge variant="muted">Archived</Badge>
                      </>
                    )}
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
                          runAction(r.id, () => setFeatured(r.id, e.target.checked, r.featured_order ?? 0))
                        }
                      />
                    ) : r.featured ? (
                      'Yes'
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.actionsCell}>
                    {/* An explicit Edit, matching the Calendar's row actions.
                        The title is still a link — both screens now offer the
                        same two ways in rather than one each. */}
                    {canEdit && (
                      <Link href={`/admin/news/articles/${r.id}`} className={styles.actionBtn}>
                        Edit
                      </Link>
                    )}
                    {/* Clone, matching the Calendar's row actions. The copy is
                        always a draft, so it is offered on published and
                        archived posts alike — those are the ones most worth
                        starting from. */}
                    {canEdit && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={isPending}
                        title="Copy this post as a new draft"
                        onClick={() => runAction(r.id, () => cloneArticle(r.id))}
                      >
                        Clone
                      </button>
                    )}
                    {isLeader && r.status !== 'published' && !r.archived_at && (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                        disabled={isPending}
                        onClick={() => runAction(r.id, () => publishArticle(r.id))}
                      >
                        Publish
                      </button>
                    )}
                    {isLeader && !r.archived_at && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={isPending}
                        onClick={() => runAction(r.id, () => archiveArticle(r.id))}
                      >
                        Archive
                      </button>
                    )}
                    {isLeader && r.archived_at && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={isPending}
                        onClick={() => runAction(r.id, () => unarchiveArticle(r.id))}
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
                            runAction(r.id, () => deleteArticle(r.id));
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
