'use client';

/**
 * Bucket Report › Buckets (Patrick, 2026-10-18: "Where is the admin for managing buckets?") — every bucket,
 * empty ones too, with the events that point at it, how many transactions it holds and when it was last used.
 * Per row, one ⋯-style Actions menu: Rename or merge… (the report's RenameBucketPanel, that bucket picked) and,
 * only for a bucket nothing uses, Delete… behind a danger confirm. Making a bucket stays in the pickers
 * ("+ New bucket…", two confirmations). Plans/Buckets-Lookup.md.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { canDeleteBucket, type BucketUsage } from '@/lib/buckets';
import type { RenameBucketPreview } from '../bucket-actions';
import { RenameBucketPanel } from './rename-bucket-panel';
import { ActionsMenu } from '../../_components/actions-menu';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import { fmtDate } from '@/lib/format-date';
import parentStyles from '../finance.module.css';
import styles from './report.module.css';

type Open = { kind: 'rename' | 'delete'; bucket: BucketUsage } | null;

export function BucketManager({
  buckets,
  previewRename,
  rename,
  deleteBucket
}: {
  buckets: BucketUsage[];
  previewRename: (bucketId: number, newName: string) => Promise<RenameBucketPreview>;
  rename: (bucketId: number, newName: string) => Promise<{ ok: boolean; error?: string; affectedCount?: number; merged?: boolean }>;
  deleteBucket: (bucketId: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const sorted = [...buckets].sort((a, b) => a.name.localeCompare(b.name));

  function confirmDelete(b: BucketUsage) {
    setError(null);
    start(async () => {
      const res = await deleteBucket(b.id);
      if (!res.ok) {
        setError(res.error ?? 'Could not delete the bucket.');
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  return (
    <>
      <table className={styles.bucketTable}>
        <thead>
          <tr>
            <th scope="col">Bucket</th>
            <th scope="col">Events</th>
            <th scope="col" className={styles.bucketNum}>
              Transactions
            </th>
            <th scope="col">Last used</th>
            <th scope="col" className={styles.bucketActions}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => (
            <tr key={b.id}>
              <th scope="row">{b.name}</th>
              <td>
                {b.events.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ', '}
                    <Link href={`/admin/calendar/${e.id}`}>{e.title}</Link>
                  </span>
                ))}
              </td>
              <td className={styles.bucketNum}>{b.rowCount}</td>
              <td>{b.lastUsed ? fmtDate(b.lastUsed) : ''}</td>
              <td className={styles.bucketActions}>
                <ActionsMenu
                  ariaLabel={`Actions — ${b.name}`}
                  options={[
                    { value: 'rename', label: 'Rename or merge…' },
                    ...(canDeleteBucket(b) ? [{ value: 'delete', label: 'Delete…' }] : [])
                  ]}
                  onAction={(v) => {
                    setError(null);
                    setOpen({ kind: v === 'delete' ? 'delete' : 'rename', bucket: b });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog ref={dialogRef} className={parentStyles.actionModal} danger={open?.kind === 'delete'} onClose={() => setOpen(null)}>
        {open?.kind === 'rename' && (
          <>
            <DialogHeader title="Rename or merge a bucket" />
            <DialogBody>
              <RenameBucketPanel key={open.bucket.id} buckets={buckets} previewRename={previewRename} rename={rename} initialSourceId={open.bucket.id} />
            </DialogBody>
            <DialogActions>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
        {open?.kind === 'delete' && (
          <>
            <DialogHeader title={`Delete the bucket “${open.bucket.name}”?`} />
            <DialogBody>
              <p>It holds no transactions and no event points at it. It leaves every bucket picker. This can&rsquo;t be undone.</p>
              {error && (
                <p className={styles.bucketError} role="alert">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogActions>
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button variant="dangerSolid" disabled={pending} onClick={() => confirmDelete(open.bucket)}>
                Delete “{open.bucket.name}”
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
