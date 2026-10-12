'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import { movePage } from './actions';
import styles from './pages.module.css';

export interface PageRowVM {
  id: number;
  parent_id: number | null;
  slug: string;
  path: string;
  title: string;
  status: 'draft' | 'published';
}

export interface PageNode {
  row: PageRowVM;
  depth: number;
  /** First / last among its siblings — the arrow that can't move it is greyed. */
  first: boolean;
  last: boolean;
}

const DEPTH_CLASS = ['', styles.depth1, styles.depth2, styles.depth3];

/**
 * The Pages tree as DataTable·Compact (composes): title indented under its parent, address, status Badge,
 * reorder-within-a-parent arrows, one quiet Edit. "+ Page" is the one quiet add row below the list.
 */
export function PagesTable({ nodes }: { nodes: PageNode[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ id: number; msg: string } | null>(null);

  function move(id: number, direction: 'up' | 'down') {
    setErr(null);
    start(async () => {
      const res = await movePage(id, direction);
      if (!res.ok) {
        setErr({ id, msg: res.error ?? 'Could not move that page.' });
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Page</th>
              <th>Address</th>
              <th>Status</th>
              <th>Order</th>
              <th className={styles.actionsCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No pages yet. Add one below.
                </td>
              </tr>
            ) : (
              nodes.map(({ row, depth, first, last }) => (
                <tr key={row.id}>
                  <td className={`${styles.titleCell} ${DEPTH_CLASS[Math.min(depth, 3)]}`}>
                    <Link href={`/admin/news/pages/${row.id}`}>{row.title}</Link>
                    {err?.id === row.id && (
                      <div className={styles.rowError}>
                        <Notice>{err.msg}</Notice>
                      </div>
                    )}
                  </td>
                  <td className={`${styles.nowrap} ${styles.address}`}>{row.path}</td>
                  <td className={styles.nowrap}>
                    <Badge variant={row.status === 'published' ? 'success' : 'warning'}>
                      {row.status === 'published' ? 'Published' : 'Draft'}
                    </Badge>
                  </td>
                  <td className={styles.nowrap}>
                    <span className={styles.order}>
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={pending || first}
                        aria-label={`Move ${row.title} up`}
                        title={first ? 'Already first among its siblings' : 'Move up'}
                        onClick={() => move(row.id, 'up')}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={pending || last}
                        aria-label={`Move ${row.title} down`}
                        title={last ? 'Already last among its siblings' : 'Move down'}
                        onClick={() => move(row.id, 'down')}
                      >
                        ↓
                      </Button>
                    </span>
                  </td>
                  <td className={styles.actionsCell}>
                    <Button variant="quiet" size="sm" href={`/admin/news/pages/${row.id}`} title="Open this page in the editor">
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className={styles.addRow}>
        <Button variant="quiet" href="/admin/news/pages/new">
          + Page
        </Button>
      </div>
    </>
  );
}
