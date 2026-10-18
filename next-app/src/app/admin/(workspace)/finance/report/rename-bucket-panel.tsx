'use client';

/**
 * Rename or merge a bucket (Patrick, 2026-08-19: "edit an activity and rename... with a cascade of that new
 * name into all matching transactions" + "two activities could be merged into one"; on buckets since
 * 2026-10-17, Plans/Buckets-Lookup.md). One feature covers both: a rename changes the bucket's name and its
 * rows follow; when the new name already belongs to another bucket, applying merges into it — rows and
 * calendar entries move, and the old bucket goes (merge_buckets, one transaction). Two-step: preview the
 * affected row count and whether it merges, then apply.
 *
 * report-actions.tsx's Actions ▾ dropdown opens it in a shared <dialog> (D-156 shape).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { RenameBucketPreview } from '../bucket-actions';
import type { Bucket } from '@/lib/buckets';
import styles from './report.module.css';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';

export function RenameBucketPanel({
  buckets,
  previewRename,
  rename
}: {
  buckets: readonly Bucket[];
  previewRename: (bucketId: number, newName: string) => Promise<RenameBucketPreview>;
  rename: (bucketId: number, newName: string) => Promise<{ ok: boolean; error?: string; affectedCount?: number; merged?: boolean }>;
}) {
  const [pending, start] = useTransition();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<RenameBucketPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();
  const sourceName = buckets.find((b) => String(b.id) === source)?.name ?? '';

  function resetAfterChange() {
    setPreview(null);
    setError(null);
    setDone(null);
  }

  function runPreview() {
    if (!source || !target.trim()) return;
    start(async () => {
      setError(null);
      setDone(null);
      try {
        setPreview(await previewRename(Number(source), target));
      } catch {
        setError('Could not preview this rename.');
      }
    });
  }

  function apply() {
    start(async () => {
      setError(null);
      const res = await rename(Number(source), target);
      if (!res.ok) {
        setError(res.error ?? 'Could not rename/merge this bucket.');
        return;
      }
      const n = res.affectedCount ?? 0;
      setDone(`${res.merged ? 'Merged' : 'Renamed'} — ${n} transaction${n === 1 ? '' : 's'}.`);
      setPreview(null);
      setSource('');
      setTarget('');
      router.refresh();
    });
  }

  return (
    <div className={styles.renamePanel}>
      <label className="adminLabel">
        Rename this bucket
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            resetAfterChange();
          }}
        >
          <option value="">— pick a bucket —</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="adminLabel">
        To
        <input
          type="text"
          list="rename-bucket-target-names"
          placeholder="New name, or an existing one to merge into"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            resetAfterChange();
          }}
        />
        <datalist id="rename-bucket-target-names">
          {buckets.map((b) => (
            <option key={b.id} value={b.name} />
          ))}
        </datalist>
      </label>

      {error && <Notice>{error}</Notice>}
      {done && <p>{done}</p>}

      {preview === null ? (
        <Button variant="secondary" disabled={pending || !source || !target.trim()} onClick={runPreview}>
          Preview
        </Button>
      ) : (
        <>
          {preview.mergesInto ? (
            <p>
              This will merge <strong>{preview.affectedCount}</strong> transaction{preview.affectedCount === 1 ? '' : 's'} —
              including voided ones — from &ldquo;{sourceName}&rdquo; into the existing bucket &ldquo;{preview.mergesInto.name}
              &rdquo;, move its calendar events with them, and remove &ldquo;{sourceName}&rdquo;.
            </p>
          ) : (
            <p>
              This will rename &ldquo;{sourceName}&rdquo; to &ldquo;{target.trim()}&rdquo;. Its{' '}
              <strong>{preview.affectedCount}</strong> transaction{preview.affectedCount === 1 ? '' : 's'} — including
              voided ones — follow.
            </p>
          )}
          <Button variant="secondary" disabled={pending} onClick={apply}>
            Apply
          </Button>{' '}
          <Button variant="secondary" disabled={pending} onClick={() => setPreview(null)}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
