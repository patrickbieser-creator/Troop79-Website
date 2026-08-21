'use client';

/**
 * Rename/merge an Activity label (Patrick, 2026-08-19: "let's discuss a
 * feature that allows me to edit an activity and rename... with a cascade
 * of that new name into all matching transactions" + "two activities could
 * be merged into one"). One feature covers both — activity_label is plain
 * free text (no lookup table, see Plans/Troop-Finances.md's 2026-08-18
 * decision, which this doesn't reopen), so a rename is a bulk UPDATE and a
 * merge is the identical UPDATE where the target happens to already be in
 * use. Two-step: preview the affected row count, then apply — same
 * discipline as the original historical import's dry-run-before-commit.
 *
 * Plain content now (2026-08-20) — used to be its own <details> disclosure;
 * report-actions.tsx's Actions ▾ dropdown opens it in a shared <dialog>
 * instead (D-156 shape), so this component no longer manages its own
 * show/hide.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { RenameActivityPreview } from '../actions';
import parentStyles from '../finance.module.css';
import styles from './report.module.css';
import { Notice } from '../../_components/notice';

export function RenameActivityPanel({
  activityLabels,
  previewRenameActivity,
  renameActivity
}: {
  activityLabels: string[];
  previewRenameActivity: (sourceLabel: string) => Promise<RenameActivityPreview>;
  renameActivity: (sourceLabel: string, targetLabel: string) => Promise<{ ok: boolean; error?: string; affectedCount?: number }>;
}) {
  const [pending, start] = useTransition();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  function resetAfterChange() {
    setPreviewCount(null);
    setError(null);
    setDone(null);
  }

  function preview() {
    if (!source) return;
    start(async () => {
      setError(null);
      setDone(null);
      try {
        const { affectedCount } = await previewRenameActivity(source);
        setPreviewCount(affectedCount);
      } catch {
        setError('Could not preview this rename.');
      }
    });
  }

  function apply() {
    start(async () => {
      setError(null);
      const res = await renameActivity(source, target);
      if (!res.ok) {
        setError(res.error ?? 'Could not rename/merge this activity.');
        return;
      }
      setDone(`Updated ${res.affectedCount ?? 0} transaction${res.affectedCount === 1 ? '' : 's'}.`);
      setPreviewCount(null);
      setSource('');
      setTarget('');
      router.refresh();
    });
  }

  return (
    <div className={styles.renamePanel}>
      <label>
        Rename this activity
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            resetAfterChange();
          }}
        >
          <option value="">— pick an activity —</option>
          {activityLabels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <input
          type="text"
          list="rename-activity-target-labels"
          placeholder="New name, or an existing one to merge into"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            resetAfterChange();
          }}
        />
        <datalist id="rename-activity-target-labels">
          {activityLabels.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      </label>

      {error && <Notice>{error}</Notice>}
      {done && <p>{done}</p>}

      {previewCount === null ? (
        <button
          type="button"
          className={parentStyles.pagerBtn}
          disabled={pending || !source || !target}
          onClick={preview}
        >
          Preview
        </button>
      ) : (
        <>
          <p>
            This will update <strong>{previewCount}</strong> transaction{previewCount === 1 ? '' : 's'} — including
            voided ones — from &ldquo;{source}&rdquo; to &ldquo;{target}&rdquo;.
          </p>
          <button type="button" className={parentStyles.pagerBtn} disabled={pending} onClick={apply}>
            Apply
          </button>{' '}
          <button
            type="button"
            className={parentStyles.pagerBtn}
            disabled={pending}
            onClick={() => setPreviewCount(null)}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
